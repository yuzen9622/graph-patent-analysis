import { setTimeout as delay } from "node:timers/promises";
import { getPool, migrate } from "../lib/db/client";
import { expireResearchArtifacts, recordWorkerHeartbeat } from "../lib/db/patent-search";
import { runNextResearchJob } from "../lib/patent-search/runner";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("研究 worker 需要 DATABASE_URL。");
  await migrate();
  console.log("[research-worker] ready");
  let lastCleanup = 0;
  while (!shutdown.signal.aborted) {
    try {
      await recordWorkerHeartbeat();
      if (Date.now() - lastCleanup > 60_000) { await expireResearchArtifacts(); lastCleanup = Date.now(); }
      const worked = await runNextResearchJob(shutdown.signal);
      await delay(worked ? 1200 : 2000, undefined, { signal: shutdown.signal });
    } catch {
      if (shutdown.signal.aborted) break;
      console.error("[research-worker] 工作執行中斷，稍後重新檢查任務。");
      await delay(5000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "研究 worker 啟動失敗。");
  process.exitCode = 1;
}).finally(async () => { if (process.env.DATABASE_URL) await getPool().end(); });
