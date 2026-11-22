import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { patentToolInput } from "@/lib/patent-search/ai-tool";
import { validateSearchPlan } from "@/lib/patent-search/contracts";
import { POST } from "@/app/api/patent-search/route";
import { FINTECH_PROMPT } from "@/lib/patent-search/suggestions";

vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), generateText: vi.fn() }));
vi.mock("@/lib/llm/providers", () => ({ getEnvApiKey: () => "fixture", getModel: () => ({}) }));
vi.mock("@/lib/patent-search/http", async original => ({ ...await original<typeof import("@/lib/patent-search/http")>(), researchUser: async () => ({id: "owner"}) }));
vi.mock("@/lib/db/patent-search", async original => ({ ...await original<typeof import("@/lib/db/patent-search")>(), reserveResearchProposal: async () => {} }));

const job = { id: "fixture-job" };
const invalid = { staticToolCalls: [], staticToolResults: [], toolCalls: [{invalid: true, input: {}}], content: [] };
const success = { staticToolCalls: [{}], staticToolResults: [{output: job}], toolCalls: [{}], content: [] };
async function submit(prompt: string) {
  const response = await POST(new Request("http://localhost/api/patent-search", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({mode: "guided", prompt})}));
  return (await response.text()).trim().split("\n").map(line => JSON.parse(line)).at(-1);
}

describe("research planning", () => {
  beforeEach(() => vi.resetAllMocks());
  it("requires the AI to supply its steps and preserves their order when saving the plan", () => {
    const plan = { keywords: ["電池"], match: "any", applicants: [], ipc: [], dateField: "filing",
      dateFrom: null, dateTo: null, sort: "relevance", limit: null };
    const proposal = { plan, title: "電池專利", summary: "依指定主題檢索。", intent: "plan", applicantGroup: "specified" };
    expect(validateSearchPlan(plan)).toEqual(plan);
    expect(patentToolInput.safeParse(proposal).success).toBe(false);
    for (const steps of [["查詢電池專利"], ["比對名稱與摘要", "整理對應的官方來源"]]) {
      const input = patentToolInput.parse({ ...proposal, plan: { ...plan, steps } });
      expect(validateSearchPlan(input.plan).steps).toEqual(steps);
    }
  });
  it("sends the suggested request to the planner", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(success as never);
    expect(await submit(FINTECH_PROMPT)).toEqual({type:"proposal", job});
    expect(generateText).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(generateText).mock.calls[0][0].prompt)).request).toBe(FINTECH_PROMPT);
  });
  it("lets the planner ask for missing information without dispatching a search", async () => {
    const text = "你想查詢哪一家機構的專利？";
    vi.mocked(generateText).mockResolvedValueOnce({...invalid, toolCalls: [], text} as never);
    expect(await submit("研究特定申請人")).toEqual({type:"reply", text});
    expect(generateText).toHaveBeenCalledOnce();
  });
  it("repairs invalid model arguments before dispatch", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(invalid as never).mockResolvedValueOnce(success as never);
    expect(await submit("只查支付技術")).toEqual({type:"proposal", job});
    expect(generateText).toHaveBeenCalledTimes(2);
  });
  it("does not replay a dispatched tool when execution fails", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({...success,staticToolResults:[],content:[{type:"tool-error",error:new Error("fixture")}]} as never);
    expect(await submit("只查支付技術")).toMatchObject({type:"error"});
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
