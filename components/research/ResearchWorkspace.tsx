"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { AssistantRuntimeProvider, useAui } from "@assistant-ui/react";
import { PanelRightOpen, FileSpreadsheet, Search, SlidersHorizontal, RefreshCw, Landmark, CreditCard, Building2, Network, Fingerprint, ScanSearch, ArrowRight, ChartNoAxesColumnIncreasing, Files } from "lucide-react";

import { useWorkspaceUser } from "@/components/UserMenu";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardHeader, CardContent, CardDescription } from "@/components/ui/card";
import type { ResearchController } from "./use-research";
import { ResearchContext, useResearchController } from "./research-context";
import { ResearchAssistantMessage } from "./ResearchAssistantMessage";
import { draftFromPlan, fieldError, planFromDraft, SearchFields } from "./SearchFields";
import { ResearchDetails } from "./ResearchDetails";
import styles from "./research.module.css";

import { FINTECH_PROMPT } from "@/lib/patent-search/suggestions";

const SUGGESTIONS = [
  { title: "金融科技", icons: [Landmark, CreditCard, ChartNoAxesColumnIncreasing], detail: "近五年的支付、保險與銀行專利", prompt: FINTECH_PROMPT },
  { title: "依申請人查專利", icons: [Building2, Files, Network], detail: "依申請人名稱與日期範圍檢索", prompt: "我想研究特定申請人的臺灣專利，請協助我設定申請人與日期範圍。" },
  { title: "金融詐欺偵測", icons: [Fingerprint, ScanSearch, Files], detail: "查詢與詐欺偵測相關的臺灣專利", prompt: "我想找與金融詐欺偵測有關的臺灣專利，請協助建立檢索條件。" },
];

function ResearchWelcome() {
  const controller = useResearchController();
  const user = useWorkspaceUser();
  return <header className={styles.welcome}>
    <p>{user ? user.display_name || user.username : "專利研究助理"}</p>
    <h1>{controller.restoring ? "正在載入研究…" : "臺灣專利檢索"}</h1>
  </header>;
}

function ResearchSuggestions() {
  const aui = useAui();
  const heading = useId();
  return <section aria-labelledby={heading} className={styles.recommendations}>
    <h2 id={heading} className="text-sm text-muted-foreground">檢索範例</h2>
    <div className={styles.suggestions}>
      {SUGGESTIONS.map(({ title, detail, prompt, icons: [Start, Middle, End] }) => (
        <Card key={title} size="sm" className="relative">
          <CardHeader>
            <div className={styles.diagram} aria-hidden="true">
              <Start /><ArrowRight size={12} /><Middle /><ArrowRight size={12} /><End />
            </div>
          </CardHeader>
          <CardContent className="grid gap-1">
            <Button variant="link" className="justify-self-start px-0" onClick={event => {
              aui.composer.setText(prompt);
              event.currentTarget.closest('[role="tabpanel"]')?.querySelector<HTMLTextAreaElement>(".aui-composer-root textarea")?.focus();
            }}>
              {title}<span className="absolute inset-0" aria-hidden />
            </Button>
            <CardDescription>{detail}</CardDescription>
          </CardContent>
        </Card>
      ))}
    </div>
  </section>;
}

const narrowViewport = "(max-width: 68rem)";
function subscribeViewport(callback: () => void) {
  const query = window.matchMedia(narrowViewport);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export default function ResearchWorkspace({ onImport, controller }: {
  onImport: () => void;
  controller: ResearchController;
}) {
  const [structuredOpen, setStructuredOpen] = useState(false);
  const [draft, setDraft] = useState(draftFromPlan);
  const [error, setError] = useState<string | null>(null);
  const narrow = useSyncExternalStore(subscribeViewport, () => window.matchMedia(narrowViewport).matches, () => false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selection, setSelection] = useState<{ id: string; latest?: string }>();
  const jobs = controller.messages.flatMap(message => message.job ? [message.job] : []);
  const latest = jobs.at(-1);
  const job = (selection && selection.latest === latest?.id && jobs.find(item => item.id === selection.id)) || latest;
  function inspectJob(id: string) {
    setSelection({ id, latest: latest?.id });
    if (narrow) setSheetOpen(true);
  }
  const busy = controller.planning || controller.active || controller.importing || controller.restoring || Boolean(controller.pendingAction);
  const availability = controller.serviceError ?? (controller.service ? !controller.service.workerAvailable ? "資料擷取服務尚未啟動。可先規劃條件，或匯入既有 Excel。" : !controller.service.modelAvailable ? "尚未設定 AI 檢索模型。請選「手動設定條件」。" : null : "正在檢查研究服務…");

  return (
    <ResearchContext.Provider value={{ ...controller, inspectJob }}>
      <div className={job && !narrow ? styles.split : styles.single}>
      <div className={`${styles.workspace} ${controller.messages.length ? styles.conversation : ""}`}>
        {controller.messages.length > 0 && <h1 className="sr-only">專利研究</h1>}
        {job && narrow && <div className={styles.panelLauncher}><Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}><PanelRightOpen />{job.status === "awaiting_approval" ? "確認檢索範圍" : "研究詳情"}</Button></div>}
        <AssistantRuntimeProvider runtime={controller.runtime}>
          <TooltipProvider>
            <div className={styles.thread}><Thread autoFocus={false} components={{ Welcome: ResearchWelcome, AssistantMessage: ResearchAssistantMessage }} /></div>
          </TooltipProvider>
          <div className={styles.bottom}>
            <div className={styles.toolStrip}>
              <span className="text-xs text-muted-foreground">專利檢索 · TwIP Search</span>
              <Button size="sm" variant="ghost" onClick={() => { setStructuredOpen(true); setError(null); }} disabled={busy}><SlidersHorizontal />手動設定條件</Button>
            </div>
            {!controller.messages.length && !controller.restoring && <ResearchSuggestions />}
            <div className={styles.details}>
              {!controller.messages.length && <section aria-label="研究工具" className="grid gap-3">
                <h2 className="text-sm text-muted-foreground">研究工具</h2>
                <Card size="sm"><CardContent className="grid gap-3">
                  <div className="flex items-center gap-3"><FileSpreadsheet aria-hidden size={18} /><span className="flex-1 text-sm">已有專利資料</span><Button variant="outline" size="sm" onClick={onImport}>匯入 Excel</Button></div>
                  {availability && <div className={styles.availability}><Search size={16} aria-hidden /><p className="flex-1">{availability}</p><Button variant="ghost" size="icon-sm" onClick={() => void controller.refreshService()} aria-label="重新檢查研究服務"><RefreshCw /></Button></div>}
                </CardContent></Card>
              </section>}
              {!!controller.messages.length && availability && <div className={styles.availability}><Search size={15} aria-hidden /><p>{availability}</p><Button variant="ghost" size="icon-sm" onClick={() => void controller.refreshService()} aria-label="重新檢查研究服務"><RefreshCw /></Button></div>}
              {controller.connectionError && <p className={styles.error} role="alert">{controller.connectionError}</p>}
              <p className={styles.privacy}>研究需求與上一次的檢索條件會傳送至 Google Gemini。Excel 附件僅用於匯入分析，不會傳給搜尋規劃模型。</p>

            </div>
          </div>
        </AssistantRuntimeProvider>
        <Dialog open={structuredOpen} onOpenChange={setStructuredOpen}>
          <DialogContent className={styles.formDialog}>
            <DialogTitle>專利檢索條件</DialogTitle>
            <DialogDescription>填好後可先核對條件，確認後才會向 TwIP Search 查詢。</DialogDescription>
            <form onSubmit={async (event) => {
              event.preventDefault();
              try { setError(null); await controller.structured(planFromDraft(draft)); setStructuredOpen(false); }
              catch (error) { setError(fieldError(error)); }
            }}>
              <SearchFields draft={draft} onChange={setDraft} disabled={busy} />
              {error && <p className={styles.error} role="alert">{error}</p>}
              <DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setStructuredOpen(false)}>返回研究</Button><Button type="submit" disabled={busy || !controller.service}>{controller.pendingAction === "structured" ? "建立中…" : "建立檢索條件"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
        {job && <ResearchDetails key={job.id} job={job} narrow={narrow} open={sheetOpen} onOpenChange={setSheetOpen} />}
      </div>
    </ResearchContext.Provider>
  );
}
