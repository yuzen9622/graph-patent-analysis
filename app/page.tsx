"use client";

import { useState, useId, useEffect } from "react";
import { BarChart2, Loader2, ArrowRight, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UploadZone from "@/components/UploadZone";
import ModelSelector from "@/components/ModelSelector";
import ProgressPanel from "@/components/ProgressPanel";
import AnalysisHistorySidebar from "@/components/AnalysisHistorySidebar";
import { addHistoryEntry } from "@/lib/analysis-history";
import type { PatentRow } from "@/types/graph";
import type { FieldMapping } from "@/lib/excel-parser";
import type { ProviderType } from "@/lib/llm/providers";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";
const STORAGE_KEYS = {
  API_KEY: "patent_analysis_api_key",
  PROVIDER: "patent_analysis_provider",
};

function Step({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-sm transition-colors duration-200 ${active ? "text-foreground" : "text-muted-foreground"}`}
    >
      <span
        className={[
          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-200",
          done
            ? "bg-success text-white shadow-sm shadow-success/40"
            : active
              ? "bg-primary text-primary-foreground shadow-sm shadow-blue-400/50"
              : "bg-black/5 dark:bg-white/5 text-foreground border border-border/10",
        ].join(" ")}
      >
        {n}
      </span>
      <span className="font-medium whitespace-nowrap">{label}</span>
    </div>
  );
}

export default function HomePage() {
  const [patents, setPatents] = useState<PatentRow[]>([]);
  const [_mappings, setMappings] = useState<FieldMapping[]>([]);
  const [filename, setFilename] = useState<string>("");
  const [provider, setProvider] = useState<ProviderType>("nvidia");
  const [apiKey, setApiKey] = useState("");
  const [sampleSize, setSampleSize] = useState(50);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"upload" | "analyzing">("upload");
  const [jobId, setJobId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sampleInputId = useId();

  // Load from localStorage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
    const savedProvider = localStorage.getItem(STORAGE_KEYS.PROVIDER);
    if (savedKey) setApiKey(savedKey);
    if (savedProvider) setProvider(savedProvider as ProviderType);
  }, []);

  // Save to localStorage when changed
  useEffect(() => {
    if (apiKey) localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (provider) localStorage.setItem(STORAGE_KEYS.PROVIDER, provider);
  }, [provider]);

  const effectiveSample =
    patents.length > 0 ? Math.min(sampleSize, patents.length) : sampleSize;
  const sampleHint =
    patents.length > 0
      ? `將分析 ${effectiveSample} / 總計 ${patents.length} 筆`
      : null;
  const canStart = patents.length > 0 && (USE_MOCK || apiKey.trim().length > 0);

  function handleParsed(
    rows: PatentRow[],
    mappings: FieldMapping[],
    fname: string,
  ) {
    setPatents(rows);
    setMappings(mappings);
    setFilename(fname);
    setUploadError(null);
    setSubmitError(null);
  }

  function handleUploadError(msg: string) {
    setUploadError(msg);
    setPatents([]);
    setFilename("");
    setSubmitError(null);
  }

  async function handleStart() {
    if (patents.length === 0) {
      setSubmitError("請先上傳 .xlsx 檔案。");
      return;
    }
    if (!USE_MOCK && !apiKey.trim()) {
      setSubmitError("請輸入 API Key 後再開始分析。");
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    const sampled = patents.slice(0, Math.min(sampleSize, patents.length));

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (!USE_MOCK) headers["X-LLM-Api-Key"] = apiKey.trim();

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          sample_size: sampleSize,
          patents: sampled,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { message?: string }).message ?? `伺服器錯誤 ${res.status}`,
        );
      }

      const data = (await res.json()) as { job_id: string };

      addHistoryEntry({
        id: data.job_id,
        filename: filename || "patents.xlsx",
        timestamp: new Date().toISOString(),
        status: "analyzing",
        patentCount: sampled.length,
      });

      setJobId(data.job_id);
      setPhase("analyzing");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "啟動分析失敗，請重試。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background primary-foreground flex flex-col relative overflow-hidden">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-white/[0.08] px-6 py-3.5 flex items-center gap-3 shrink-0 h-14 bg-background/80 backdrop-blur-xl">
        <BarChart2 size={20} className="text-success" aria-hidden />
        <div>
          <h1 className="font-serif text-base font-bold leading-tight primary-foreground">
            王老師專利知識圖譜分析平台
          </h1>
          <p className="text-[0.65rem] primary-foreground mt-0.5 font-mono tracking-wide">
            Patent Knowledge Graph Analysis
          </p>
        </div>
        {USE_MOCK && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-warning bg-wartext-warning/10 border border-wartext-warning/20 px-2.5 py-1 rounded-full backdrop-blur-sm">
            <FlaskConical size={12} aria-hidden />
            Mock 模式
          </span>
        )}
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* History sidebar — hidden on mobile */}
        <div className="hidden md:flex shrink-0">
          <AnalysisHistorySidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />
        </div>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto" aria-label="上傳與設定">
          {/* ── Analyzing phase ── */}
          {phase === "analyzing" && jobId ? (
            <div className="flex items-center justify-center min-h-full px-4 py-16">
              <ProgressPanel jobId={jobId} />
            </div>
          ) : (
            /* ── Upload phase ── */
            <div className="flex flex-col items-center justify-center min-h-full px-4 py-10">
              {/* Step indicator */}
              <div className="flex items-center gap-5 mb-8 flex-wrap justify-center w-full max-w-2xl">
                <Step
                  n={1}
                  label="上傳 Excel"
                  active={patents.length === 0}
                  done={patents.length > 0}
                />
                <span className="text-border text-sm select-none" aria-hidden>
                  →
                </span>
                <Step
                  n={2}
                  label="選擇模型"
                  active={patents.length > 0 && !canStart}
                  done={canStart}
                />
                <span className="text-border text-sm select-none" aria-hidden>
                  →
                </span>
                <Step n={3} label="開始分析" active={canStart} />
              </div>

              {/* Wizard cards */}
              <div className="w-full max-w-2xl space-y-4">
                {/* Upload card */}
                <section
                  className="glass rounded-2xl p-6"
                  aria-label="檔案上傳"
                >
                  <h2 className="text-xs font-semibold text-primary/70 uppercase tracking-widest mb-4">
                    01 · 上傳 Excel 檔案
                  </h2>
                  <UploadZone
                    onParsed={handleParsed}
                    onError={handleUploadError}
                  />
                </section>

                {/* Settings card */}
                <section
                  className="glass rounded-2xl p-6 space-y-5"
                  aria-label="分析設定"
                >
                  <h2 className="text-xs font-semibold text-primary/70 uppercase tracking-widest">
                    02 · 分析設定
                  </h2>

                  <ModelSelector
                    provider={provider}
                    apiKey={apiKey}
                    onProviderChange={setProvider}
                    onApiKeyChange={setApiKey}
                  />

                  {/* Sample size */}
                  <div className="flex items-end gap-4 pt-4 border-t border-white/[0.06]">
                    <div className="flex flex-col gap-1.5">
                      <Label
                        htmlFor={sampleInputId}
                        className="text-xs font-semibold text-primary/70 uppercase tracking-widest"
                      >
                        抽樣筆數
                      </Label>
                      <Input
                        id={sampleInputId}
                        type="number"
                        min={1}
                        max={2000}
                        value={sampleSize}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v))
                            setSampleSize(Math.min(2000, Math.max(1, v)));
                        }}
                        className="h-9 w-28 border-border bg-background focus-visible:ring-primary text-sm backdrop-blur-sm"
                      />
                    </div>
                    {sampleHint && (
                      <p
                        className="text-xs text-muted-foreground pb-2"
                        aria-live="polite"
                      >
                        {sampleHint}
                      </p>
                    )}
                  </div>
                </section>

                {/* Error alerts */}
                {(uploadError || submitError) && (
                  <Alert
                    variant="destructive"
                    className="border-error/30 bg-error/8 text-error backdrop-blur-sm"
                  >
                    <AlertDescription>
                      {submitError ?? uploadError}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Start button */}
                <div className="flex justify-center pt-2 pb-6">
                  <Button
                    size="lg"
                    onClick={() => {
                      void handleStart();
                    }}
                    disabled={submitting || !canStart}
                    className="min-w-48 bg-primary text-primary-foreground font-semibold text-base cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 gap-2 shadow-lg shadow-success/20 hover:shadow-success/30 rounded-xl"
                  >
                    {submitting ? (
                      <>
                        <Loader2
                          size={18}
                          className="animate-spin"
                          aria-hidden
                        />
                        啟動中…
                      </>
                    ) : (
                      <>
                        開始分析
                        <ArrowRight size={18} aria-hidden />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.06] px-6 py-3 text-center shrink-0 bg-background/60 backdrop-blur-xl">
        <p className="text-xs text-border">
          支援 NVIDIA NIM · Google Gemini · OpenAI &nbsp;·&nbsp;
          本機部署，資料不離開您的電腦
        </p>
      </footer>
    </div>
  );
}
