import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { patentInputForRequest, patentToolInput } from "@/lib/patent-search/ai-tool";
import { validateSearchPlan } from "@/lib/patent-search/contracts";
import { POST } from "@/app/api/patent-search/route";
import { FINTECH_PROMPT } from "@/lib/patent-search/suggestions";

vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), streamText: vi.fn() }));
vi.mock("@/lib/llm/providers", () => ({ getEnvApiKey: () => "fixture", getModel: () => ({}) }));
vi.mock("@/lib/patent-search/http", async original => ({ ...await original<typeof import("@/lib/patent-search/http")>(), researchUser: async () => ({id: "owner"}) }));
vi.mock("@/lib/db/patent-search", async original => ({ ...await original<typeof import("@/lib/db/patent-search")>(), reserveResearchProposal: async () => {} }));

function streamed(result: object) {
  return {
    ...result,
    fullStream: (async function* () {
      if ("text" in result && typeof result.text === "string") {
        yield { type: "text-delta", text: result.text };
      }
    })(),
  };
}

const job = { id: "fixture-job" };
const invalid = { staticToolCalls: [], staticToolResults: [], toolCalls: [{invalid: true, input: {}}], content: [] };
const success = { staticToolCalls: [{}], staticToolResults: [{output: job}], toolCalls: [{}], content: [] };
async function submitEvents(prompt: string) {
  const response = await POST(new Request("http://localhost/api/patent-search", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({mode: "guided", prompt})}));
  return (await response.text()).trim().split("\n").map(line => JSON.parse(line));
}

async function submit(prompt: string) {
  return (await submitEvents(prompt)).at(-1);
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
  it("rejects the recorded applicant placeholder and honors an explicit all-applicant scope", () => {
    const prompt = "近五年 你幫我想關鍵字 保險與金融 所有申請人";
    const placeholder = "請提供保險或金融機構名稱（如：富邦人壽、國泰人壽等）";
    const plan = { steps: ["查詢近五年的專利"], keywords: ["金融", "保險"], match: "any", applicants: [],
      ipc: [], dateField: "filing", dateFrom: "2021-11-22", dateTo: "2026-11-22", sort: "relevance", limit: null };
    const input = { title: "保金專利分析", summary: "不限申請人", applicantGroup: "all", intent: "plan", plan };
    const schema = patentInputForRequest(prompt);
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, applicantGroup: "domesticBanks" }).success).toBe(false);
    expect(schema.safeParse({ ...input, plan: { ...plan, applicants: ["國泰人壽"] } }).success).toBe(false);
    const specified = { ...input, applicantGroup: "specified", plan: { ...plan, applicants: [placeholder] } };
    expect(schema.safeParse(specified).success).toBe(false);
    expect(patentInputForRequest("請執行").safeParse(specified).success).toBe(false);
    expect(patentInputForRequest("只查國泰人壽").safeParse({ ...specified, plan: { ...plan, applicants: ["國泰人壽"] } }).success).toBe(true);
  });
  it("sends the suggested request to the planner", async () => {
    vi.mocked(streamText).mockReturnValueOnce(streamed(success) as never);
    expect(await submit(FINTECH_PROMPT)).toEqual({type:"proposal", job});
    expect(streamText).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(streamText).mock.calls[0][0].prompt)).request).toBe(FINTECH_PROMPT);
  });
  it("lets the planner ask for missing information without dispatching a search", async () => {
    const text = "你想查詢哪一家機構的專利？";
    vi.mocked(streamText).mockReturnValueOnce(streamed({...invalid, toolCalls: [], text}) as never);
    expect(await submit("研究特定申請人")).toEqual({type:"reply", text});
    expect(streamText).toHaveBeenCalledOnce();
  });
  const leakedPlan = JSON.stringify({ applicantGroup: "specified", intent: "plan", plan: { applicants: [""] } });
  it("requests a real tool call when Gemini writes its arguments in chat", async () => {
    vi.mocked(streamText).mockReturnValueOnce(streamed({...invalid, toolCalls: [], text: leakedPlan}) as never)
      .mockReturnValueOnce(streamed(success) as never);
    expect(await submit("所有申請人")).toEqual({type: "proposal", job});
    expect(vi.mocked(streamText).mock.calls[1][0].toolChoice).toEqual({type: "tool", toolName: "searchPatents"});
  });
  it("keeps tool arguments out of chat even if the repair returns fenced JSON", async () => {
    vi.mocked(streamText).mockImplementation(() => streamed({...invalid, toolCalls: [], text: "```json\n" + leakedPlan + "\n```"}) as never);
    const events = await submitEvents("所有申請人");
    expect(events.at(-1)).toMatchObject({type: "error"});
    expect(JSON.stringify(events.filter(event => event.type === "text"))).not.toMatch(/applicantGroup|intent|applicants/);
    expect(streamText).toHaveBeenCalledTimes(2);
  });
  it("repairs invalid model arguments before dispatch", async () => {
    vi.mocked(streamText).mockReturnValueOnce(streamed(invalid) as never).mockReturnValueOnce(streamed(success) as never);
    expect(await submit("只查支付技術")).toEqual({type:"proposal", job});
    expect(streamText).toHaveBeenCalledTimes(2);
  });
  it("does not replay a dispatched tool when execution fails", async () => {
    vi.mocked(streamText).mockReturnValueOnce(streamed({...success,staticToolResults:[],content:[{type:"tool-error",error:new Error("fixture")}]}) as never);
    expect(await submit("只查支付技術")).toMatchObject({type:"error"});
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});
