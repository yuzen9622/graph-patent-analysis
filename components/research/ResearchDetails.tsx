"use client";

import { useState } from "react";
import { Square } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Trace, TraceLine, TraceTitle, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent } from "@/components/ui/trace";
import { isJobActive, retrievalScope, type ResearchJob } from "@/lib/patent-search/contracts";
import { draftFromPlan, fieldError, planFromDraft, SearchFields } from "./SearchFields";
import { useResearchController } from "./research-context";
import styles from "./research.module.css";

export const jobStatus = {
  awaiting_approval: "待確認", queued: "排隊中", running: "檢索中", completed: "已完成",
  partial: "部分完成", cancelled: "已取消", failed: "失敗",
} satisfies Record<ResearchJob["status"], string>;

export function ResearchDetails({ job, narrow, open, onOpenChange }: {
  job: ResearchJob;
  narrow: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const controller = useResearchController();
  const [draft, setDraft] = useState(() => draftFromPlan(job.plan));
  const [error, setError] = useState("");
  const editable = job.status === "awaiting_approval";
  const busy = Boolean(controller.pendingAction);
  const operationError = controller.messages.find(message => message.job?.id === job.id)?.error;
  const { plan } = job;
  const rows = [
    ["關鍵字", plan.keywords.join(plan.match === "all" ? " AND " : " OR ")],
    ["申請人", plan.applicants.join("、")], ["IPC", plan.ipc.join("、")],
    [plan.dateField === "filing" ? "申請日" : "公開／公告日", [plan.dateFrom ?? "不限", plan.dateTo ?? "不限"].join(" 至 ")],
    ["取得筆數", retrievalScope(plan.limit)],
  ].filter(([, value]) => value);
  function approve() {
    try {
      const changed = JSON.stringify(draft) !== JSON.stringify(draftFromPlan(plan));
      const approvedPlan = changed ? planFromDraft(draft) : plan;
      setError("");
      void controller.act(job, "approve", approvedPlan);
    } catch (error) {
      setError(fieldError(error));
    }
  }
  const recentActivities = job.activities.slice(-3);
  const earlierActivities = job.activities.slice(0, -3);
  const body = <div className={styles.panelBody}>
    <section><div className={styles.sectionTitle}><h3>專利檢索範圍</h3><span>{jobStatus[job.status]}</span></div>
      <p className={styles.scopeSummary}>{job.summary}</p>
      <Trace><TraceCollapsible><TraceCollapsibleTrigger><TraceLine><TraceTitle>{editable ? "調整檢索條件" : "檢視檢索條件"}</TraceTitle></TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{editable ? <SearchFields draft={draft} onChange={setDraft} disabled={busy} /> :
          <dl className={styles.scopeRows}>{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
        </TraceCollapsibleContent>
      </TraceCollapsible></Trace>
      {editable && <div className={styles.panelActions}>
        <Button disabled={busy || controller.service?.workerAvailable === false} onClick={approve}>確認並開始檢索</Button>
        <Button disabled={busy} variant="ghost" onClick={() => void controller.act(job, "cancel")}>取消</Button>
      </div>}
      {(error || operationError) && <p role="alert" className={styles.error}>{error || operationError}</p>}
    </section>
    {plan.steps && <section><h3>AI 研究計畫</h3>
      <ol className="list-decimal space-y-1 pl-5">{plan.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    </section>}
    <section><div className={styles.sectionTitle}><h3>研究進度</h3></div>
      {job.matchedCount !== null && <dl className={styles.counts}>
        <div><dt>候選專利</dt><dd>{job.matchedCount.toLocaleString("zh-TW")}</dd></div>
        <div><dt>已取得</dt><dd>{job.retrievedCount.toLocaleString("zh-TW")}</dd></div>
      </dl>}
      {recentActivities.length > 0 ? <ol className={styles.events} aria-live="polite">
        {recentActivities.map(event => <li key={event.id}>{event.message}</li>)}
      </ol> : <p className={styles.scopeSummary}>{jobStatus[job.status]}</p>}
      {earlierActivities.length > 0 && <Trace><TraceCollapsible><TraceCollapsibleTrigger><TraceLine><TraceTitle>先前的執行紀錄（{earlierActivities.length}）</TraceTitle></TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent><ol className="grid gap-2 text-xs">{earlierActivities.map(event => <li key={event.id}>{event.message}</li>)}</ol></TraceCollapsibleContent>
      </TraceCollapsible></Trace>}
      {isJobActive(job.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void controller.act(job, "cancel")}><Square />停止研究</Button>}
    </section>
  </div>;
  if (narrow) return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className={styles.drawer}><SheetTitle className={styles.panelTitle}>研究詳情</SheetTitle>{body}</SheetContent>
  </Sheet>;
  return <aside className={styles.inspector} aria-label="研究詳情"><h2 className={styles.panelTitle}>研究詳情</h2>{body}</aside>;
}
