import { buildPatentWorkbook } from "./export-xlsx";
import { retrieveTwipPatents } from "./twip";
import { claimResearchJob, heartbeatResearchJob, checkpointResearchJob, finishResearchJob, recordWorkerHeartbeat } from "../db/patent-search";
import { retrievalScope, type PatentSourceRecord } from "./contracts";

export async function runNextResearchJob(shutdownSignal: AbortSignal) {
  const job = await claimResearchJob();
  if (!job) return false;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, shutdownSignal]);
  const records = new Map<string, PatentSourceRecord>(job.records.map((record) => [record.id, record]));
  let matchedCount = job.matched_count;
  const warnings: string[] = [];
  let failure: string | null = null;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void Promise.all([heartbeatResearchJob(job.id, job.lease_token), recordWorkerHeartbeat()])
      .then(([owned]) => { if (!owned) controller.abort(); })
      .catch(() => controller.abort())
      .finally(() => { heartbeatBusy = false; });
  }, 10_000);

  try {
    try {
      const result = await retrieveTwipPatents(job.plan, {
        signal,
        onBatch: async (batch, total) => {
          matchedCount = total;
          for (const record of batch) records.set(record.id, record);
          const owned = await checkpointResearchJob(job.id, job.lease_token, "retrieve", [...records.values()], total,
            batch.length ? `已取得 ${records.size} 筆官方資料與來源連結。` : `找到 ${total.toLocaleString("zh-TW")} 筆候選結果，${retrievalScope(job.plan.limit)}。`);
          if (!owned) { controller.abort(); signal.throwIfAborted(); }
        },
      });
      matchedCount = result.total;
    } catch (error) {
      if (controller.signal.aborted || shutdownSignal.aborted) return true;
      failure = signal.aborted ? "研究取得資料逾時，已保留取得的結果。" : error instanceof Error ? error.message : "無法完成官方專利資料取得。";
      warnings.push(failure);
    }

    const collected = [...records.values()].slice(0, job.plan.limit ?? undefined);
    if (!collected.length) {
      if (!failure) warnings.push(matchedCount === 0 ? "沒有符合條件的專利，請調整搜尋範圍。" : "官方結果沒有可匯出的資料。");
      await finishResearchJob(job.id, job.lease_token, { status: failure ? "failed" : "completed", records: [], warnings, error: failure });
      return true;
    }
    if (!(await checkpointResearchJob(job.id, job.lease_token, "export", collected, matchedCount, "正在驗證欄位並製作相容的 Excel。"))) return true;
    try {
      const workbook = await buildPatentWorkbook(collected, job.plan);
      warnings.push(...workbook.warnings, ...workbook.excluded.map((record) => `${record.id}：${record.reason}`));
      if (job.plan.limit !== null && matchedCount !== null && matchedCount > job.plan.limit) warnings.push(`官方有 ${matchedCount} 筆結果，本次只取得核准範圍內最多 ${job.plan.limit} 筆，不是完整資料集。`);
      if (matchedCount !== null && collected.length < Math.min(matchedCount, job.plan.limit ?? matchedCount)) warnings.push(`官方候選結果中，本次實際取得符合條件的專利 ${collected.length} 筆。`);
      const incomplete = Boolean(failure) || workbook.excluded.length > 0;
      await finishResearchJob(job.id, job.lease_token, { status: incomplete ? "partial" : "completed", records: workbook.included, warnings, error: failure, bytes: workbook.bytes, rowCount: workbook.included.length });
    } catch (error) {
      await finishResearchJob(job.id, job.lease_token, { status: "failed", records: collected, warnings, error: error instanceof Error ? error.message : "無法建立 Excel。" });
    }
    return true;
  } finally {
    clearInterval(heartbeat);
  }
}
