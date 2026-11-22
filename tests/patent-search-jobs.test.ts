import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDisposableDb, pointPoolAt, type DisposableDb } from "./db-migrations-helpers";
import { migrate, query } from "@/lib/db/client";
import { approveResearchJob, cancelResearchJob, checkpointResearchJob, claimResearchJob, createResearchJob, listResearchJobs, expireResearchArtifacts, finishResearchJob, getResearchArtifact, getResearchJob, heartbeatResearchJob, reserveResearchProposal } from "@/lib/db/patent-search";
import { chatForResearchJob, listChats, readChat, startTurn, failTurn } from "@/lib/db/research-chats";
import { latestResearchJob, type SearchPlan } from "@/lib/patent-search/contracts";

const databaseUrl = process.env.TEST_RESEARCH_DATABASE_URL;
const plan: SearchPlan = { keywords: ["金融"], match: "all", applicants: [], dateField: "filing", dateFrom: null, dateTo: null, ipc: [], sort: "relevance", limit: 20 };
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!databaseUrl)("research jobs against isolated PostgreSQL", () => {
  let disposable: DisposableDb;
  const original = process.env.DATABASE_URL;
  beforeAll(async () => {
    disposable = await createDisposableDb(databaseUrl!);
    pointPoolAt(disposable.url);
    await migrate();
    await query("INSERT INTO users(id,username,password_hash,password_salt) VALUES($1,'owner','unused-test-hash','unused'),($2,'other','unused-test-hash','unused')", [owner, other]);
  });
  beforeEach(async () => { await query("TRUNCATE patent_search_jobs,patent_search_events,patent_search_proposals RESTART IDENTITY CASCADE"); });
  afterAll(async () => {
    await disposable?.drop();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("restores a multi-turn conversation with its original AI title and enforces ownership", async () => {
    const chatId = crypto.randomUUID();
    const id = crypto.randomUUID();
    await startTurn(owner, chatId, id, "臺灣電池回收");
    const job = await createResearchJob(owner, "臺灣電池回收", "檢索策略", plan, { chatId, id, title: "電池回收技術" });
    const followup = crypto.randomUUID();
    expect(await startTurn(owner, chatId, followup, "只看近五年", plan)).toMatchObject({ first_prompt: "臺灣電池回收" });
    await createResearchJob(owner, "只看近五年", "已更新範圍", plan, { chatId, id: followup, title: "其他名稱" });
    const failed = crypto.randomUUID();
    await startTurn(owner, chatId, failed, "改為近十年", plan);
    await failTurn(chatId, failed, "模型暫時無法連線");
    const chat = await readChat(owner, chatId);
    expect(chat.title).toBe("電池回收技術");
    expect(chat.messages.map(message => message.text)).toEqual(["臺灣電池回收", "檢索策略", "只看近五年", "已更新範圍", "改為近十年", ""]);
    expect(chat.messages[1]).toMatchObject({ job: { id: job.id } });
    expect(chat.messages[5]).toMatchObject({ phase: "error", contextPlan: plan });
    expect(await listChats(other)).toEqual([]);
    await expect(readChat(other, chatId)).rejects.toMatchObject({ status: 404 });
    await expect(startTurn(other, chatId, crypto.randomUUID(), "讀取")).rejects.toMatchObject({ status: 404 });
  });

  it("reopens linked and standalone jobs in one persistent research session", async () => {
    const job = await createResearchJob(owner, "原始研究", "原始結果", plan);
    await expect(chatForResearchJob(other, job.id)).rejects.toMatchObject({ status: 404 });
    const [chatId, same] = await Promise.all([chatForResearchJob(owner, job.id), chatForResearchJob(owner, job.id)]);
    expect(chatId).toBe(same);
    const turn = crypto.randomUUID();
    expect(await startTurn(owner, chatId, turn, "為什麼缺少摘要？")).toMatchObject({
      first_prompt: "原始研究", history: [{ prompt: "原始研究", response: "原始結果" }],
    });
    await createResearchJob(owner, "為什麼缺少摘要？", "後續研究", plan, { chatId, id: turn, title: "原始研究" });
    expect(await chatForResearchJob(owner, job.id)).toBe(chatId);
    expect(await listResearchJobs(owner)).toEqual([]);
    expect((await readChat(owner, chatId)).messages.map(m => m.text)).toEqual(["原始研究", "原始結果", "為什麼缺少摘要？", "後續研究"]);
  });

  it("keeps plans inert until explicit approval and isolates owners", async () => {
    const job = await createResearchJob(owner, "金融", "測試用研究條件", plan);
    expect(job.status).toBe("awaiting_approval");
    expect(await claimResearchJob()).toBeNull();
    await expect(getResearchJob(job.id, other)).rejects.toMatchObject({ status: 404 });
    await expect(approveResearchJob(job.id, other, job.revision, plan)).rejects.toMatchObject({ status: 404 });
    await expect(approveResearchJob(job.id, owner, job.revision + 1, plan)).rejects.toMatchObject({ status: 409 });
    expect((await getResearchJob(job.id, owner)).status).toBe("awaiting_approval");
  });

  it("permits exactly one concurrent approval and binds the approved plan", async () => {
    const job = await createResearchJob(owner, "金融", "測試", plan);
    const changed = { ...plan, limit: 3 };
    const attempts = await Promise.allSettled([approveResearchJob(job.id, owner, 1, changed), approveResearchJob(job.id, owner, 1, plan)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const approved = attempts.find((result) => result.status === "fulfilled");
    expect(approved?.status === "fulfilled" && (await getResearchJob(job.id, owner)).plan).toEqual(approved?.status === "fulfilled" && approved.value.plan);
    expect((await getResearchJob(job.id, owner)).revision).toBe(2);
  });

  it("serializes official-source jobs and fences writes after cancellation", async () => {
    const first = await createResearchJob(owner, "金融", "測試", plan);
    const second = await createResearchJob(other, "金融", "測試", plan);
    await approveResearchJob(first.id, owner, 1, plan);
    await approveResearchJob(second.id, other, 1, plan);
    const claim = await claimResearchJob();
    expect(claim?.id).toBe(first.id);
    expect(await claimResearchJob()).toBeNull();
    await cancelResearchJob(first.id, owner);
    expect(await heartbeatResearchJob(first.id, claim!.lease_token)).toBe(false);
    expect(await checkpointResearchJob(first.id, claim!.lease_token, "retrieve", [], 1, "stale")).toBe(false);
    expect(await finishResearchJob(first.id, claim!.lease_token, { status: "completed", records: [], warnings: [], error: null })).toBe(false);
    expect((await getResearchJob(first.id, owner)).status).toBe("cancelled");
    expect((await claimResearchJob())?.id).toBe(second.id);
  });

  it("reclaims expired leases and rejects the old worker token", async () => {
    const job = await createResearchJob(owner, "金融", "測試", plan);
    await approveResearchJob(job.id, owner, 1, plan);
    const first = await claimResearchJob();
    await query("UPDATE patent_search_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
    const second = await claimResearchJob();
    expect(second?.id).toBe(job.id);
    expect(second?.lease_token).not.toBe(first?.lease_token);
    expect(await heartbeatResearchJob(job.id, first!.lease_token)).toBe(false);
    expect(await heartbeatResearchJob(job.id, second!.lease_token)).toBe(true);
    await query("UPDATE patent_search_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
    expect(await claimResearchJob()).toBeNull();
    expect((await getResearchJob(job.id, owner)).status).toBe("failed");
  });

  it("restricts artifact ownership and expiration independently of the page", async () => {
    const job = await createResearchJob(owner, "金融", "測試", plan);
    await approveResearchJob(job.id, owner, 1, plan);
    const claim = await claimResearchJob();
    const bytes = new Uint8Array([80, 75, 3, 4]);
    await finishResearchJob(job.id, claim!.lease_token, { status: "completed", records: [], warnings: [], error: null, bytes, rowCount: 1 });
    expect((await getResearchArtifact(job.id, owner)).artifact_bytes).toEqual(Buffer.from(bytes));
    await expect(getResearchArtifact(job.id, other)).rejects.toMatchObject({ status: 404 });
    await query("UPDATE patent_search_jobs SET artifact_expires_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    await expect(getResearchArtifact(job.id, owner)).rejects.toMatchObject({ status: 404 });
    await expireResearchArtifacts();
    expect((await getResearchJob(job.id, owner)).artifact).toBeNull();
  });

  it("does not let delayed reads undo approval or terminal state", async () => {
    const draft = await createResearchJob(owner, "金融", "測試", plan);
    const queued = await approveResearchJob(draft.id, owner, draft.revision, plan);
    await claimResearchJob();
    const running = await getResearchJob(draft.id, owner);
    const cancelled = await cancelResearchJob(draft.id, owner);
    expect(running.revision).toBeGreaterThan(queued.revision);
    expect(cancelled.revision).toBeGreaterThan(running.revision);
    expect(latestResearchJob(queued, draft)).toBe(queued);
    expect(latestResearchJob(running, queued)).toBe(running);
    expect(latestResearchJob(cancelled, running)).toBe(cancelled);
  });

  it("rate-limits model proposals before making external calls", async () => {
    await Promise.all(Array.from({ length: 20 }, () => reserveResearchProposal(owner)));
    await expect(reserveResearchProposal(owner)).rejects.toMatchObject({ status: 429 });
    await expect(reserveResearchProposal(other)).resolves.toBeUndefined();
  });
});
