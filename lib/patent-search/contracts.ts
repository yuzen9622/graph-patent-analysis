import { z } from "zod";

export const SOURCE_HOME = "https://cloud.tipo.gov.tw/s690/twipsearch/#/";

const term = z.string().trim().min(1).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期請使用 YYYY-MM-DD").nullable();

export const researchStepsSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(20);

export const searchPlanSchema = z.object({
  steps: researchStepsSchema.optional(),
  keywords: z.array(term).max(8),
  match: z.enum(["all", "any"]),
  applicants: z.array(term).max(100),
  exactApplicants: z.boolean().optional(),
  dateField: z.enum(["filing", "publication"]),
  dateFrom: date,
  dateTo: date,
  ipc: z.array(z.string().trim().regex(/^[A-HY]\d{2}[A-Z]?(?:\d{1,4}(?:\/\d{1,6})?)?$/i, "IPC 格式不正確")).max(8),
  sort: z.literal("relevance"),
  limit: z.number().int().positive().nullable().default(null).describe("未指定筆數或要求全部時填 null；指定筆數時填正整數"),
}).strict();

export type SearchPlan = z.infer<typeof searchPlanSchema>;

export function retrievalScope(limit: SearchPlan["limit"]) {
  return limit === null ? "取得全部符合條件的專利" : `最多取得 ${limit} 筆`;
}

export const proposalSchema = z.object({
  summary: z.string().min(1).max(2000).describe("給使用者的繁體中文搜尋策略摘要，說明條件與限制，不包含內部推理或捏造的搜尋結果"),
  plan: searchPlanSchema,
});

export function validateSearchPlan(input: unknown): SearchPlan {
  const plan = searchPlanSchema.parse(input);
  if (!plan.keywords.length && !plan.applicants.length && !plan.ipc.length && !plan.dateFrom && !plan.dateTo)
    throw new z.ZodError([{ code: "custom", path: ["keywords"], message: "請至少提供主題、申請人、IPC 或日期範圍之一。" }]);
  for (const value of [plan.dateFrom, plan.dateTo]) {
    if (value && (Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      throw new z.ZodError([{ code: "custom", path: ["dateFrom"], message: "日期不存在，請重新設定搜尋日期。" }]);
    }
  }
  if (plan.dateFrom && plan.dateTo && plan.dateFrom > plan.dateTo) throw new z.ZodError([{ code: "custom", path: ["dateTo"], message: "起始日期不可晚於結束日期。" }]);
  return plan;
}

export const sourceRecordSchema = z.object({
  id: z.string().min(1).max(300),
  title: z.string(),
  titleEn: z.string(),
  abstract: z.string(),
  applicants: z.array(z.string()),
  applicationNumber: z.string(),
  filingDate: z.string(),
  publicationNumber: z.string(),
  publicationDate: z.string(),
  bibliography: z.object({
    certificate: z.string(), issue: z.string(), ipc: z.array(z.string()), design: z.string(),
    owners: z.array(z.string()), inventors: z.array(z.string()), agents: z.array(z.string()),
    priority: z.string(), references: z.array(z.string()), status: z.string(),
    citedCount: z.number().int().nonnegative().nullable(), kind: z.string(),
  }).optional(),
  sourceUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cloud.tipo.gov.tw" && url.pathname.startsWith("/s690/");
  }, "來源必須是 TwIP Search 官方網址"),
  retrievedAt: z.string().datetime(),
}).strict();

export type PatentSourceRecord = z.infer<typeof sourceRecordSchema>;
export type ResearchStatus = "awaiting_approval" | "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type ResearchStage = "search" | "retrieve" | "export";

export const researchJobSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  prompt: z.string(),
  summary: z.string(),
  plan: searchPlanSchema,
  status: z.enum(["awaiting_approval", "queued", "running", "completed", "partial", "failed", "cancelled"]),
  stage: z.enum(["search", "retrieve", "export"]).nullable(),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: sourceRecordSchema.shape.sourceUrl })),
  matchedCount: z.number().int().nonnegative().nullable(),
  retrievedCount: z.number().int().nonnegative(),
  activities: z.array(z.object({ id: z.string(), stage: z.enum(["search", "retrieve", "export"]).nullable(), message: z.string(), at: z.string().datetime() })),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  artifact: z.object({ filename: z.string(), rowCount: z.number().int().nonnegative(), expiresAt: z.string().datetime() }).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResearchJob = z.infer<typeof researchJobSchema>;

export const proposalEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({ type: z.literal("reply"), text: z.string().min(1) }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("proposal"), job: researchJobSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ProposalEvent = z.infer<typeof proposalEventSchema>;

export function latestResearchJob(current: ResearchJob, incoming: ResearchJob): ResearchJob {
  if (current.id !== incoming.id) throw new Error("不能合併不同研究任務的狀態。");
  return incoming.revision > current.revision ? incoming : current;
}

export function isJobActive(status: ResearchStatus) {
  return status === "queued" || status === "running";
}
