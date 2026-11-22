import { tool } from "ai";
import { z } from "zod";
import { createResearchJob, ResearchError, workerAvailable } from "../db/patent-search";
import { proposalSchema, researchStepsSchema, searchPlanSchema, validateSearchPlan } from "./contracts";
import { BANK_DIRECTORY, resolveDomesticBanks } from "./domestic-banks";

export const patentToolInput = proposalSchema.extend({
  plan: searchPlanSchema.extend({ steps: researchStepsSchema.describe("依這次需求自行拆分的具體研究步驟，依執行順序排列。簡單需求可以只有一步。") }),
  title: z.string().trim().min(1).max(60),
  applicantGroup: z.enum(["specified", "domesticBanks"]).describe("domesticBanks 只能取得全部本國銀行總機構，無法依所有權或業務篩選。指定機構名稱時使用 specified。"),
  intent: z.enum(["retrieve", "plan"]).describe("要求專利資料選 retrieve，只要求建立或討論條件選 plan"),
});

export function patentCrawlerTool(owner: string, request: string, signal: AbortSignal, turn?: { chatId: string; id: string }) {
  let called = false;
  return tool({
    description: "依條件向智慧局 TwIP Search 取得專利與研究 Excel。可先查中央銀行本國銀行總機構名錄，再以申請人交集檢索。",
    inputSchema: patentToolInput,
    execute: async (input) => {
      if (called) throw new ResearchError("每次提問只能建立一份研究。", 400);
      called = true;
      return executePatentSearch(input, owner, request, signal, turn);
    },
  });
}

export async function executePatentSearch(
  { plan: input, title, summary, applicantGroup, intent }: z.infer<typeof patentToolInput>,
  owner: string, request: string, signal: AbortSignal, turn?: { chatId: string; id: string },
) {
  const plan = { ...input };
  if (applicantGroup === "domesticBanks") {
    try { plan.applicants = await resolveDomesticBanks(signal); }
    catch { throw new ResearchError("無法取得中央銀行本國銀行總機構名錄，請稍後重試。", 503); }
    plan.exactApplicants = true;
    summary += `\n申請人範圍採中央銀行名錄所列的 ${plan.applicants.length} 家本國銀行總機構（含全國農業金庫，排除郵政儲匯部門）。來源 ${BANK_DIRECTORY}`;
  }
  validateSearchPlan(plan);
  const run = intent === "retrieve" && await workerAvailable();
  if (!run && intent === "retrieve") summary += "\n資料擷取 worker 尚未啟動，已保留條件供啟動後執行。";
  signal.throwIfAborted();
  return createResearchJob(owner, request, summary, plan, turn && { ...turn, title }, run);
}
