import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "./client";
import { retrievalScope, validateSearchPlan, type PatentSourceRecord, type ResearchJob, type ResearchStage, type ResearchStatus, type SearchPlan } from "../patent-search/contracts";

export class ResearchError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

interface JobRow {
  id: string; owner_id: string; prompt: string; summary: string; plan: SearchPlan; revision: number;
  status: ResearchStatus; stage: ResearchStage | null; records: PatentSourceRecord[]; matched_count: number | null;
  warnings: string[]; error: string | null; artifact_available: boolean; artifact_rows: number | null;
  artifact_expires_at: Date | null; created_at: Date; updated_at: Date; lease_token: string | null; attempts: number;
}

const COLUMNS = "id, owner_id, prompt, summary, plan, revision, status, stage, records, matched_count, warnings, error, artifact_bytes IS NOT NULL AS artifact_available, artifact_rows, artifact_expires_at, created_at, updated_at, lease_token, attempts";

async function appendEvent(client: PoolClient, id: string, stage: ResearchStage | null, message: string) {
  await client.query("INSERT INTO patent_search_events(job_id,stage,message) VALUES($1,$2,$3)", [id, stage, message]);
}

function view(row: JobRow, activities: ResearchJob["activities"]): ResearchJob {
  return {
    id: row.id, revision: row.revision, prompt: row.prompt, summary: row.summary, plan: row.plan,
    status: row.status, stage: row.stage, sources: row.records.map((record) => ({ id: record.id, title: record.title, url: record.sourceUrl })),
    matchedCount: row.matched_count, retrievedCount: row.records.length, activities, warnings: row.warnings, error: row.error,
    artifact: row.artifact_available && row.artifact_expires_at && row.artifact_expires_at.getTime() > Date.now()
      ? { filename: `patents-${row.id.slice(0, 8)}.xlsx`, rowCount: row.artifact_rows ?? 0, expiresAt: row.artifact_expires_at.toISOString() } : null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

export async function getResearchJob(id: string, ownerId: string): Promise<ResearchJob> {
  const row = await queryOne<JobRow>(`SELECT ${COLUMNS} FROM patent_search_jobs WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
  if (!row) throw new ResearchError("找不到這份研究任務。", 404);
  const events = await query<{ id: string; stage: ResearchStage | null; message: string; created_at: Date }>(
    "SELECT id::text,stage,message,created_at FROM patent_search_events WHERE job_id=$1 ORDER BY id", [id]);
  return view(row, events.map((event) => ({ id: event.id, stage: event.stage, message: event.message, at: event.created_at.toISOString() })));
}

export async function listResearchJobs(ownerId: string) {
  return query<{ id: string; title: string | null; pinned: boolean; summary: string; keywords: string[]; status: ResearchStatus; created_at: Date }>(
    "SELECT id,title,pinned,summary,plan->'keywords' AS keywords,status,created_at FROM patent_search_jobs j WHERE owner_id=$1 AND NOT EXISTS (SELECT 1 FROM research_chat_turns t WHERE t.job_id=j.id) ORDER BY pinned DESC,created_at DESC LIMIT 20", [ownerId]);
}

export async function reserveResearchProposal(ownerId: string) {
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`patent-proposal:${ownerId}`]);
    const result = await client.query("SELECT id FROM patent_search_proposals WHERE owner_id=$1 AND created_at > now()-interval '1 hour'", [ownerId]);
    if (result.rows.length >= 20) throw new ResearchError("每小時最多規劃 20 次研究，請稍後再試。", 429);
    await client.query("INSERT INTO patent_search_proposals(owner_id) VALUES($1)", [ownerId]);
  });
}

export async function createResearchJob(ownerId: string, prompt: string, summary: string, input: SearchPlan, turn?: { chatId: string; id: string; title: string }, run = false) {
  const plan = validateSearchPlan(input);
  const id = randomUUID();
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`patent-search:${ownerId}`]);
    const recent = await client.query("SELECT id FROM patent_search_jobs WHERE owner_id=$1 AND created_at > now()-interval '1 hour'", [ownerId]);
    if (recent.rows.length >= 20) throw new ResearchError("每小時最多建立 20 份研究，請稍後再試。", 429);
    if (run) {
      const active = await client.query("SELECT id FROM patent_search_jobs WHERE owner_id=$1 AND status IN ('queued','running')", [ownerId]);
      if (active.rowCount) throw new ResearchError("已有一份研究正在執行，請等待完成或先停止。", 409);
    }
    await client.query("INSERT INTO patent_search_jobs(id,owner_id,prompt,summary,plan,status) VALUES($1,$2,$3,$4,$5,$6)", [id, ownerId, prompt, summary, JSON.stringify(plan), run ? "queued" : "awaiting_approval"]);
    if (turn) {
      const saved = await client.query(
        `UPDATE research_chat_turns t SET response=$4,job_id=$5 FROM research_chats c
         WHERE t.chat_id=c.id AND c.owner_id=$1 AND c.id=$2 AND t.id=$3`,
        [ownerId, turn.chatId, turn.id, summary, id]);
      if (!saved.rowCount) throw new ResearchError("找不到這個對話。", 404);
      await client.query("UPDATE research_chats SET title=coalesce(title,$2) WHERE id=$1", [turn.chatId, turn.title]);
    }
    await appendEvent(client, id, null, run ? "已依研究需求排入智慧局專利檢索。" : "搜尋條件已準備好，等待確認。");
  });
  return getResearchJob(id, ownerId);
}

export async function approveResearchJob(id: string, ownerId: string, revision: number, input: SearchPlan) {
  const plan = validateSearchPlan(input);
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`patent-search:${ownerId}`]);
    const selected = await client.query<JobRow>(`SELECT ${COLUMNS} FROM patent_search_jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, ownerId]);
    const row = selected.rows[0];
    if (!row) throw new ResearchError("找不到這份研究任務。", 404);
    if (row.status !== "awaiting_approval" || row.revision !== revision) throw new ResearchError("這份條件已經更新或執行，請重新載入。", 409);
    const active = await client.query("SELECT id FROM patent_search_jobs WHERE owner_id=$1 AND status IN ('queued','running')", [ownerId]);
    if (active.rows.length) throw new ResearchError("已有一份研究正在執行，請等待完成或先停止。", 409);
    await client.query("UPDATE patent_search_jobs SET plan=$2,revision=revision+1,status='queued',updated_at=now() WHERE id=$1", [id, JSON.stringify(plan)]);
    await appendEvent(client, id, null, `已確認搜尋條件，依官方關聯度排序，${retrievalScope(plan.limit)}。`);
  });
  return getResearchJob(id, ownerId);
}

export async function cancelResearchJob(id: string, ownerId: string) {
  await withTransaction(async (client) => {
    const result = await client.query("UPDATE patent_search_jobs SET status='cancelled',revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('awaiting_approval','queued','running') RETURNING id", [id, ownerId]);
    if (result.rows.length) await appendEvent(client, id, null, "使用者已停止研究；不再啟動後續擷取。");
  });
  return getResearchJob(id, ownerId);
}

export async function getResearchArtifact(id: string, ownerId: string) {
  const row = await queryOne<{ artifact_bytes: Buffer; artifact_rows: number }>(
    "SELECT artifact_bytes,artifact_rows FROM patent_search_jobs WHERE id=$1 AND owner_id=$2 AND artifact_bytes IS NOT NULL AND artifact_expires_at > now()", [id, ownerId]);
  if (!row) throw new ResearchError("檔案不存在或已到期，請重新執行研究。", 404);
  return row;
}

export async function recordWorkerHeartbeat() {
  await query("INSERT INTO patent_search_worker(id,seen_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET seen_at=now()");
}

export async function workerAvailable() {
  const row = await queryOne<{ available: boolean }>("SELECT seen_at > now()-interval '45 seconds' AS available FROM patent_search_worker WHERE id=1");
  return row?.available ?? false;
}

export async function claimResearchJob() {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('patent-search-source-worker'))");
    await client.query("UPDATE patent_search_jobs SET status='failed',revision=revision+1,error='研究工作多次中斷，請重新建立任務。',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until < now() AND attempts >= 2");
    const busy = await client.query("SELECT id FROM patent_search_jobs WHERE status='running' AND lease_until > now() LIMIT 1");
    if (busy.rows.length) return null;
    const candidate = await client.query<JobRow>(`SELECT ${COLUMNS} FROM patent_search_jobs WHERE status='queued' OR (status='running' AND lease_until < now() AND attempts < 2) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = candidate.rows[0];
    if (!row) return null;
    const token = randomUUID();
    await client.query("UPDATE patent_search_jobs SET status='running',revision=revision+1,stage='search',lease_token=$2,lease_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() WHERE id=$1", [row.id, token]);
    await appendEvent(client, row.id, "search", row.attempts ? "接續中斷的研究，既有來源資料將保留。" : "開始透過 TwIP Search 搜尋官方專利資料。");
    return { ...row, lease_token: token };
  });
}

export async function heartbeatResearchJob(id: string, token: string) {
  const result = await query("UPDATE patent_search_jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id", [id, token]);
  return result.length > 0;
}

export async function checkpointResearchJob(id: string, token: string, stage: ResearchStage, records: PatentSourceRecord[], matchedCount: number | null, message: string) {
  return withTransaction(async (client) => {
    const result = await client.query("UPDATE patent_search_jobs SET stage=$3,revision=revision+1,records=$4,matched_count=$5,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id", [id, token, stage, JSON.stringify(records), matchedCount]);
    if (!result.rows.length) return false;
    await appendEvent(client, id, stage, message);
    return true;
  });
}

export async function finishResearchJob(id: string, token: string, result: { status: "completed" | "partial" | "failed"; records: PatentSourceRecord[]; warnings: string[]; error: string | null; bytes?: Uint8Array; rowCount?: number }) {
  return withTransaction(async (client) => {
    const updated = await client.query("UPDATE patent_search_jobs SET status=$3,revision=revision+1,records=$4,warnings=$5,error=$6,artifact_bytes=$7,artifact_rows=$8,artifact_expires_at=CASE WHEN $7::bytea IS NOT NULL THEN now()+interval '24 hours' ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id", [id, token, result.status, JSON.stringify(result.records), JSON.stringify(result.warnings), result.error, result.bytes ? Buffer.from(result.bytes) : null, result.rowCount ?? null]);
    if (!updated.rows.length) return false;
    await appendEvent(client, id, "export", result.bytes ? `Excel 已建立，共 ${result.rowCount} 筆${result.status === "partial" ? "；此為部分結果" : ""}。` : result.error ?? "研究已結束，沒有可下載的資料。");
    return true;
  });
}

export async function expireResearchArtifacts() {
  await query("DELETE FROM patent_search_proposals WHERE created_at < now()-interval '1 day'");
  await query("UPDATE patent_search_jobs SET artifact_bytes=NULL,revision=revision+1,updated_at=now() WHERE artifact_expires_at < now() AND artifact_bytes IS NOT NULL");
  await query("DELETE FROM patent_search_jobs WHERE created_at < now()-interval '7 days' AND status NOT IN ('queued','running')");
}
