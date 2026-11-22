import { APICallError, generateText, RetryError } from "ai";
import { z } from "zod";
import { createResearchJob, listResearchJobs, reserveResearchProposal, ResearchError, workerAvailable } from "@/lib/db/patent-search";
import { finishReply, failTurn, listChats, startTurn } from "@/lib/db/research-chats";
import { getEnvApiKey, getModel } from "@/lib/llm/providers";
import { patentCrawlerTool, patentToolInput } from "@/lib/patent-search/ai-tool";
import { searchPlanSchema, validateSearchPlan, type ProposalEvent } from "@/lib/patent-search/contracts";
import { researchBody, researchResponseError, researchUser } from "@/lib/patent-search/http";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("guided"), prompt: z.string().trim().min(1).max(2000), chatId: z.string().uuid().optional(), contextPlan: searchPlanSchema.optional() }).strict(),
  z.object({ mode: z.literal("structured"), chatId: z.string().uuid().optional(), plan: searchPlanSchema }).strict(),
]);

export async function GET() {
  try {
    const user = await researchUser();
    const [available, jobs, chats] = await Promise.all([workerAvailable(), listResearchJobs(user.id), listChats(user.id)]);
    return Response.json({ workerAvailable: available, modelAvailable: Boolean(getEnvApiKey("gemini")), jobs, chats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchResponseError(error); }
}

export async function POST(request: Request) {
  let turn: { chatId: string; id: string } | undefined;
  try {
    const user = await researchUser(request);
    const body = requestSchema.parse(await researchBody(request));
    if (body.mode === "structured") {
      const plan = validateSearchPlan(body.plan);
      await reserveResearchProposal(user.id);
      const prompt = "結構化專利搜尋";
      if (body.chatId) {
        const id = crypto.randomUUID();
        await startTurn(user.id, body.chatId, id, prompt, plan);
        turn = { chatId: body.chatId, id };
      }
      const job = await createResearchJob(user.id, prompt, "已依你填寫的欄位建立搜尋條件。確認後才會向 TwIP Search 取得資料。", plan, turn && { ...turn, title: plan.keywords.join("、") || prompt });
      return Response.json({ job }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const contextPlan = body.contextPlan ? validateSearchPlan(body.contextPlan) : undefined;
    await reserveResearchProposal(user.id);
    const turnId = crypto.randomUUID();
    const chat = body.chatId ? await startTurn(user.id, body.chatId, turnId, body.prompt, contextPlan) : null;
    if (body.chatId) turn = { chatId: body.chatId, id: turnId };
    const apiKey = getEnvApiKey("gemini");
    if (!apiKey) throw new ResearchError("尚未設定搜尋規劃模型；你仍可使用結構化條件建立研究。", 503);
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(90_000)]);
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: ProposalEvent) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
        try {
          send({ type: "status", message: "正在整理研究範圍與搜尋條件。" });
          const tools = { searchPatents: patentCrawlerTool(user.id, body.prompt, signal, turn) };
          const generate = (correction?: string) => generateText({
            model: getModel("gemini", apiKey),
            tools,
            abortSignal: signal, maxOutputTokens: 4000, maxRetries: 1,
            system: `你是臺灣專利研究助理。根據使用者目標、先前對話及工具能力自行安排研究。缺少必要資訊時直接用文字提問；一般討論可以直接回答。條件足夠時呼叫 searchPatents，提供可由工具執行的查詢與對應步驟，不要聲稱已取得結果。今天是 ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" })}。使用繁體中文摘要描述查詢策略，切勿預告結果。本次追問指定的範圍優先於舊條件。domesticBanks 涵蓋所有本國銀行，只有要求整個群組才可使用。名錄未提供所有權或業務分類。若使用者限定其中一類且未提供可確認的機構名稱，先詢問機構名單；若「私銀」等用語有多種解讀，先確認是民營銀行、私人銀行業務或其他對象。不可猜名單、默用部分範例或沿用舊的全體名錄。只指定機構與年代時 keywords=[]，不可自行添加金融關鍵字。年份區間用 YYYY-01-01 起算，「現在」用今天。「銀行技術」是主題，只有明確限定申請人為本國銀行時使用 domesticBanks。關鍵字最多 8 組。日期未指定用 null。未指定筆數或要求全部時 limit=null，只有明確指定筆數才填該正整數，sort=relevance。沿用使用者未修改的條件。只要求規劃時 intent=plan，索取資料時 intent=retrieve。依 firstQuestion 命名對話。`,
            prompt: JSON.stringify({ firstQuestion: chat?.first_prompt ?? body.prompt, conversation: chat?.history, request: body.prompt, previousPlan: contextPlan, correction }),
          });
          let result = await generate();
          const invalidFields = (call: (typeof result.toolCalls)[number] | undefined) => {
            const parsed = patentToolInput.safeParse(call?.input);
            return parsed.success ? [] : parsed.error.issues.map(issue => issue.path.join(".")).filter(Boolean);
          };
          // Only retry planning if the SDK never dispatched a valid tool call.
          if (!result.staticToolCalls.length && (result.toolCalls.length || !result.text?.trim())) {
            const fields = invalidFields(result.toolCalls[0]);
            result = await generate(`請依工具格式重新產生一次 searchPatents 呼叫。請檢查欄位 ${fields.join("、")}。`);
          }
          if (!result.toolCalls.length && result.text?.trim()) {
            const reply = result.text.trim();
            if (turn) await finishReply(turn.chatId, turn.id, reply);
            send({ type: "reply", text: reply });
            return;
          }
          const job = result.staticToolResults[0]?.output;
          if (!job) {
            if (!result.staticToolCalls.length) {
              const fields = invalidFields(result.toolCalls[0]);
              throw new ResearchError(`Gemini 未產生有效的搜尋條件${fields.length ? "，請檢查 " + fields.join("、") : ""}。`, 422);
            }
            const failure = result.content.find(part => part.type === "tool-error");
            if (failure?.type === "tool-error") throw failure.error;
            throw new ResearchError("搜尋工具沒有傳回任務，請重新規劃。", 502);
          }
          send({ type: "proposal", job });
        } catch (caught) {
          const error = RetryError.isInstance(caught) ? caught.lastError : caught;
          console.error("[patent-search] planning failed", { type: error instanceof Error ? error.name : "unknown", status: APICallError.isInstance(error) ? error.statusCode : undefined });
          const message = error instanceof z.ZodError ? error.issues[0]?.message ?? "請檢查搜尋條件。"
            : error instanceof ResearchError ? error.message
            : APICallError.isInstance(error) && error.statusCode === 429 ? "Gemini 使用額度或頻率已達上限。請稍後重試，或使用結構化條件。"
            : APICallError.isInstance(error) && [401, 403].includes(error.statusCode ?? 0) ? "Gemini 未授權這次請求，請管理者檢查模型金鑰與權限。"
            : signal.aborted ? "搜尋規劃已中斷或逾時，請重新規劃。"
            : APICallError.isInstance(error) ? `Gemini 服務暫時無法完成請求（HTTP ${error.statusCode ?? "未知"}）。請稍後重試。`
            : "無法完成 AI 搜尋規劃。請稍後重試，或直接填寫結構化條件。";
          if (turn) await failTurn(turn.chatId, turn.id, message);
          if (!closed) send({ type: "error", message });
        } finally {
          if (!closed) { closed = true; controller.close(); }
        }
      },
      cancel() { closed = true; cancellation.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (turn) await failTurn(turn.chatId, turn.id, error instanceof ResearchError ? error.message : "搜尋規劃失敗。");
    return researchResponseError(error);
  }
}
