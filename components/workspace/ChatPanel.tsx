"use client";

import { useEffect, useState, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import ui from "@/app/import.module.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UploadZone, { type ParsedUpload, type UploadZoneHandle } from "@/components/UploadZone";

import type { WorkspaceSection } from "@/components/workspace/WorkspaceShell";
import { useResearch, type useResearchService } from "@/components/research/use-research";
import ResearchWorkspace from "@/components/research/ResearchWorkspace";

import { notifyHistoryChanged } from "@/lib/analysis-history";
import { defaultSampleSize, formatUploadLabel } from "@/lib/analyze-limits";
import { planPatentSample, samplePatents } from "@/lib/sample-patents";
import type { PatentRow } from "@/types/graph";
import type { DataQualityWarnings } from "@/lib/excel-parser";
import type { ProviderType } from "@/lib/llm/providers";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";
const PROVIDER: ProviderType = "gemini";


export function ChatPanel({ tabKey, href, section, shared, updateChatLocation, onSection, onTitle }: {
  tabKey: string;
  href: string;
  section: WorkspaceSection;
  shared: ReturnType<typeof useResearchService>;
  updateChatLocation: (href: string) => void;
  onSection: (section: WorkspaceSection) => void;
  onTitle: (key: string, title: string) => void;
}) {
  const router = useRouter();
  const location = new URL(href, "https://workspace.local");
  const chatId = location.pathname.startsWith("/c/") ? location.pathname.slice(3) : null;
  const researchId = location.searchParams.get("researchId");
  const headingId = useId();
  const [patents, setPatents] = useState<PatentRow[]>([]);
  const [filenames, setFilenames] = useState<string[]>([]);
  const [uploadIds, setUploadIds] = useState<string[]>([]);
  const [citations, setCitations] = useState<Array<{ from: string; to: string }>>([]);
  const [warnings, setWarnings] = useState<DataQualityWarnings | null>(null);
  const [sampleSize, setSampleSize] = useState(1);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const uploadRequestRef = useRef(0);
  const uploadZoneRef = useRef<UploadZoneHandle>(null);
  const sampleInputId = useId();

  const sampleSourceCount = Math.max(1, planPatentSample({ patents, filenames, sampleSize: 1 }).allocations.length);
  const maxPerFileSample = Math.max(1, patents.length);
  const effectiveSample = patents.length > 0 ? Math.min(sampleSize, patents.length, maxPerFileSample) : sampleSize;
  const samplePlan = planPatentSample({ patents, filenames, sampleSize: effectiveSample });
  const maxCombinedSample = effectiveSample * sampleSourceCount;
  const sampleHint = patents.length > 0
    ? filenames.length > 1
      ? `每檔最多 ${effectiveSample} 筆，將分析 ${samplePlan.target} / 總計 ${patents.length} 筆（${formatUploadLabel(filenames)}）`
      : `將分析 ${samplePlan.target} / 總計 ${patents.length} 筆`
    : null;
  const sampleAllocationHint = patents.length > 0 && filenames.length > 1
    ? `每個來源檔各自獨立抽樣，最多合計 ${maxCombinedSample} 筆；預計各檔分配：${samplePlan.allocations.map(({ sourceFile, allocated }) => `${sourceFile ?? "未標記來源"} ${allocated} 筆`).join("、")}（合計 ${samplePlan.target} 筆）`
    : null;
  const canStart = patents.length > 0;

  function clearUploadedData() {
    setPatents([]);
    setFilenames([]);
    setUploadIds([]);
    setCitations([]);
    setWarnings(null);
    setSampleSize(1);
  }

  function handleClearUpload() {
    uploadRequestRef.current += 1;
    clearUploadedData();
    setUploadError(null);
    setSubmitError(null);
  }

  function handleParsed(upload: ParsedUpload) {
    const requestId = ++uploadRequestRef.current;
    setPatents(upload.patents);
    setFilenames(upload.filenames);
    setCitations(upload.citations);
    setWarnings(upload.warnings);
    setUploadError(null);
    setSubmitError(null);
    setSampleSize(defaultSampleSize(upload.dedupedCount));

    // Archive failure must not block analysis; ignore responses for replaced files.
    setUploadIds([]);
    const form = new FormData();
    for (const file of upload.files) form.append("file", file);
    void fetch("/api/uploads", { method: "POST", body: form })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { upload_ids?: string[]; upload_id?: string } | null) => {
        if (uploadRequestRef.current !== requestId) return;
        if (body?.upload_ids?.length) setUploadIds(body.upload_ids);
        else if (body?.upload_id) setUploadIds([body.upload_id]);
      })
      .catch(() => {});
  }

  function handleUploadError(msg: string) {
    uploadRequestRef.current += 1;
    clearUploadedData();
    setUploadError(msg);
    setSubmitError(null);
  }

  async function handleStart() {
    setSubmitError(null);
    setSubmitting(true);
    const { patents: sampled } = samplePatents({ patents, filenames, sampleSize: effectiveSample });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: PROVIDER,
          sample_size: sampleSize,
          patents: sampled,
          upload_ids: uploadIds,
          filenames: filenames.length > 0 ? filenames : ["patents.xlsx"],
          citations,
          warnings,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(data.error ?? data.message ?? `伺服器錯誤 ${res.status}`);
      }
      const data = (await res.json()) as { job_id: string };
      notifyHistoryChanged();
      toast.success(`分析已啟動，正在處理 ${sampled.length} 筆專利`);
      router.replace(`/?jobId=${encodeURIComponent(data.job_id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "啟動分析失敗，請重試。";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function importResearchFiles(files: File[]) {
    if (!uploadZoneRef.current) throw new Error("匯入區尚未準備完成，請稍後重試。");
    onSection("import");
    await uploadZoneRef.current.importFiles(files);
  }

  const research = useResearch({
    shared, chatId,
    onSelectChat: id => updateChatLocation(`/c/${encodeURIComponent(id)}`),
    initialJobId: researchId,
    onSelectJob: (id) => updateChatLocation(id ? `/?researchId=${encodeURIComponent(id)}` : "/"),
    onImportFiles: importResearchFiles,
  });

  const title = research.title || research.messages.find(message => message.role === "user")?.text;
  useEffect(() => { if (title) onTitle(tabKey, title); }, [tabKey, title, onTitle]);
  return <>
        <div hidden={section !== "research"} className="h-full"><ResearchWorkspace controller={research} onImport={() => onSection("import")} /></div>
        <div hidden={section !== "import"} className={ui.page}>
          <div className={ui.grid}>
            <section className="min-w-0" aria-labelledby={headingId}>
              <h1 id={headingId} className="mb-3 text-lg font-semibold">匯入專利檔案</h1>
              <UploadZone ref={uploadZoneRef} onParsed={handleParsed} onError={handleUploadError} onClear={handleClearUpload} />
            </section>
            <Card className={ui.settings}>
              <CardHeader><CardTitle><h2>分析設定</h2></CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={sampleInputId}>每檔抽樣筆數</Label>
                  <Input id={sampleInputId} type="number" min={1} max={maxPerFileSample} disabled={!canStart} value={sampleSize} className="w-24"
                    onChange={(event) => { const value = parseInt(event.target.value, 10); if (!isNaN(value)) setSampleSize(Math.min(maxPerFileSample, Math.max(1, value))); }} />
                </div>
                <div className="grid gap-2 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                  <p>{sampleHint ?? "匯入檔案後，可調整每個檔案要分析的筆數。"}</p>
                  {sampleAllocationHint && <p>{sampleAllocationHint}</p>}
                </div>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                <p className="text-xs leading-relaxed text-muted-foreground">{USE_MOCK ? "目前使用 Mock 模式。" : "開始分析後，所選專利內容會傳送至 Google Gemini。"}原始檔案儲存在此系統。</p>
                {(uploadError || submitError) && <Alert variant="destructive"><AlertDescription>{submitError ?? uploadError}</AlertDescription></Alert>}
                <Button onClick={() => void handleStart()} disabled={submitting || !canStart}>
                  {submitting ? <><Loader2 className="animate-spin" aria-hidden />啟動中…</> : <>開始分析<ArrowRight aria-hidden /></>}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
  </>;
}
