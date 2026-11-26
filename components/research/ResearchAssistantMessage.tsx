"use client";

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { BookOpen, Download, ExternalLink, FileSpreadsheet, PanelRightOpen, RefreshCw, ScanSearch } from "lucide-react";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useResearchController } from "./research-context";
import { jobStatus } from "./ResearchDetails";
import { ResearchSteps } from "./ResearchSteps";
import styles from "./research.module.css";

export function ResearchAssistantMessage() {
  const controller = useResearchController();
  const id = useAuiState((state) => state.message.id);
  const message = controller.messages.find((item) => item.id === id);
  if (!message) return null;
  const job = message.job;
  return <MessagePrimitive.Root className={styles.answer}>
    {job ? <Trace>
      {job.plan.steps && <section className="text-sm">
        <h3 className="font-medium">AI 研究計畫</h3>
        <ResearchSteps steps={job.plan.steps} />
      </section>}
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={job.status === "failed" ? "error" : undefined}>
            <TraceIcon><ScanSearch /></TraceIcon>
            <TraceTitle>TwIP Search</TraceTitle>
            <span className="text-xs">{jobStatus[job.status]}</span>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="text-sm">
          {job.summary}
          <Button className="mt-2 flex" size="sm" variant="outline" onClick={() => controller.inspectJob(job.id)}>
            <PanelRightOpen />查看這次研究
          </Button>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {job.matchedCount !== null && <p className="text-sm leading-6">
        找到 {job.matchedCount.toLocaleString("zh-TW")} 筆候選專利，已取得 {job.retrievedCount.toLocaleString("zh-TW")} 筆。
      </p>}
      {job.sources.length > 0 && <TraceCollapsible>
        <TraceCollapsibleTrigger><TraceLine><TraceIcon><BookOpen /></TraceIcon><TraceTitle>官方來源（{job.sources.length}）</TraceTitle></TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ol className={styles.sources}>{job.sources.map((source, index) => <li key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer"><span>[{index + 1}]</span>{source.title}<ExternalLink size={12} aria-hidden /></a>
          </li>)}</ol>
        </TraceCollapsibleContent>
      </TraceCollapsible>}
    </Trace> : message.phase === "planning" && !message.text ? <Trace><TraceLine status="running"><TraceIcon><ScanSearch /></TraceIcon><TraceTitle>正在規劃檢索條件</TraceTitle></TraceLine></Trace> : message.phase !== "error" && message.text && <MessagePrimitive.Parts components={{ Text: MarkdownText }} />}
    {job?.warnings.length ? <ul className={styles.warnings}>{job.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
    {(message.error || job?.error) && <p className={styles.error} role="alert">{message.error ?? job?.error}</p>}
    {message.phase === "error" && message.retryPrompt && <Button variant="outline" onClick={() => void controller.propose(message.retryPrompt!, message.contextPlan)} disabled={controller.planning || controller.active}><RefreshCw size={15} aria-hidden />重新規劃</Button>}
    {job?.artifact && <Card className="border border-foreground/10 ring-0"><CardContent className={styles.artifact}>
      <FileSpreadsheet size={24} aria-hidden /><div><strong>{job.artifact.filename}</strong><p>{job.artifact.rowCount} 筆專利 · {job.status === "partial" ? "部分結果" : "已驗證 Excel 格式"} · 保留 24 小時</p></div>
      <div className={styles.artifactActions}><Button onClick={() => void controller.downloadArtifact(job)}><Download size={15} aria-hidden />下載 Excel</Button><Button variant="outline" onClick={() => void controller.importArtifact(job)} disabled={controller.importing}>匯入分析</Button></div>
    </CardContent></Card>}
    {job && (job.status === "completed" || job.status === "partial") && !job.artifact && job.retrievedCount > 0 && <p className={styles.error}>下載檔案已到期，請重新建立研究。</p>}
  </MessagePrimitive.Root>;
}
