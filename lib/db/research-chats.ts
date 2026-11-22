import { query, queryOne, withTransaction } from "./client";
import { getResearchJob, ResearchError } from "./patent-search";
import type { SearchPlan } from "../patent-search/contracts";

export function listChats(owner: string) {
  return query<{ id: string; title: string | null; pinned: boolean; preview: string; updated_at: Date }>(
    "SELECT id,title,pinned,updated_at,left(first_prompt,60) AS preview FROM research_chats WHERE owner_id=$1 ORDER BY pinned DESC,updated_at DESC,id", [owner]);
}

// Older links identify a retrieval job. Resolve the owning conversation before accepting input.
export function chatForResearchJob(owner: string, jobId: string) {
  return withTransaction(async client => {
    const job = await client.query(
      "SELECT prompt,summary,title,pinned,created_at FROM patent_search_jobs WHERE owner_id=$1 AND id=$2 FOR UPDATE", [owner, jobId]);
    if (!job.rowCount) throw new ResearchError("找不到這份研究任務。", 404);
    const existing = await client.query<{ chat_id: string }>(
      "SELECT t.chat_id FROM research_chat_turns t JOIN research_chats c ON c.id=t.chat_id WHERE t.job_id=$1 AND c.owner_id=$2", [jobId, owner]);
    if (existing.rowCount) return existing.rows[0].chat_id;
    const { prompt, summary, title, pinned, created_at } = job.rows[0];
    const chatId = crypto.randomUUID();
    await client.query("INSERT INTO research_chats(id,owner_id,first_prompt,title,pinned,updated_at) VALUES($1,$2,$3,$4,$5,$6)",
      [chatId, owner, prompt, title, pinned, created_at]);
    await client.query("INSERT INTO research_chat_turns(id,chat_id,prompt,response,job_id,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [crypto.randomUUID(), chatId, prompt, summary, jobId, created_at]);
    return chatId;
  });
}

export function startTurn(owner: string, chatId: string, turnId: string, prompt: string, context?: SearchPlan) {
  return withTransaction(async client => {
    const chat = await client.query<{ first_prompt: string; title: string | null }>(
      `INSERT INTO research_chats(id,owner_id,first_prompt) VALUES($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET updated_at=now() WHERE research_chats.owner_id=excluded.owner_id
       RETURNING first_prompt,title`, [chatId,owner,prompt]);
    if (!chat.rowCount) throw new ResearchError("找不到這個對話。", 404);
    await client.query("INSERT INTO research_chat_turns(id,chat_id,prompt,context_plan) VALUES($1,$2,$3,$4)", [turnId,chatId,prompt,context]);
    const previous = await client.query<{ prompt: string; response: string }>(
      "SELECT prompt,response FROM research_chat_turns WHERE chat_id=$1 AND response IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 10", [chatId]);
    return { ...chat.rows[0], history: previous.rows.reverse() };
  });
}

export function finishReply(chatId: string, turnId: string, reply: string) {
  return query("UPDATE research_chat_turns SET response=$3 WHERE chat_id=$1 AND id=$2", [chatId, turnId, reply]);
}

export function failTurn(chatId: string, turnId: string, error: string) {
  return query("UPDATE research_chat_turns SET error=$3 WHERE chat_id=$1 AND id=$2 AND response IS NULL",
    [chatId, turnId, error]);
}

export async function readChat(owner: string, id: string) {
  const chat = await queryOne<{ title: string | null }>("SELECT title FROM research_chats WHERE id=$1 AND owner_id=$2", [id,owner]);
  if (!chat) throw new ResearchError("找不到這個對話。", 404);
  const turns = await query<{ id: string; prompt: string; context_plan: SearchPlan | null; response: string | null; error: string | null; job_id: string | null; stale: boolean }>(
    "SELECT *,created_at < now()-interval '2 minutes' AS stale FROM research_chat_turns WHERE chat_id=$1 ORDER BY created_at,id", [id]);
  const messages = await Promise.all(turns.map(async turn => {
    const error = turn.error ?? (!turn.response && turn.stale ? "搜尋規劃中斷，請重新規劃。" : undefined);
    return [
      { id: 'request-'+turn.id, role: "user", text: turn.prompt, chunks: [], phase: "ready" },
      { id: turn.id, role: "assistant", text: turn.response ?? "", chunks: turn.response ? [turn.response] : [],
        phase: error ? "error" : turn.response ? "ready" : "planning", retryPrompt: turn.prompt, contextPlan: turn.context_plan, error,
        job: turn.job_id ? await getResearchJob(turn.job_id,owner) : undefined }
    ];
  }));
  return { title: chat.title, messages: messages.flat() };
}
