import { beforeEach, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
type LanguageModelV3StreamPart = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never;
import { POST } from "@/app/api/patent-search/route";

let model: MockLanguageModelV3;
vi.mock("@/lib/llm/providers", () => ({ getEnvApiKey: () => "fixture", getModel: () => model }));
vi.mock("@/lib/patent-search/http", async original => ({ ...await original<typeof import("@/lib/patent-search/http")>(), researchUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/db/patent-search", async original => ({ ...await original<typeof import("@/lib/db/patent-search")>(), reserveResearchProposal: async () => {} }));

beforeEach(() => vi.clearAllMocks());

async function start() {
  const upstream = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>();
  const writer = upstream.writable.getWriter();
  model = new MockLanguageModelV3({ doStream: async () => ({ stream: upstream.readable }) });
  const cancellation = new AbortController();
  const response = await POST(new Request("http://localhost/api/patent-search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "guided", prompt: "說明專利研究" }), signal: cancellation.signal,
  }));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const read = async () => {
    const chunk = await reader.read();
    return chunk.done ? null : JSON.parse(decoder.decode(chunk.value).trim());
  };
  expect(await read()).toMatchObject({ type: "status" });
  await writer.write({ type: "stream-start", warnings: [] });
  await writer.write({ type: "text-start", id: "answer" });
  return { writer, reader, read, cancellation, response };
}

async function finish(writer: WritableStreamDefaultWriter<LanguageModelV3StreamPart>) {
  await writer.write({ type: "text-end", id: "answer" });
  await writer.write({ type: "finish", finishReason: { unified: "stop", raw: "STOP" }, usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 2, text: 2, reasoning: 0 },
  } });
  await writer.close();
}

it("delivers incremental text before the real SDK's model stream finishes", async () => {
  const { writer, read, response } = await start();
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  await writer.write({ type: "text-delta", id: "answer", delta: "專利" });
  expect(await read()).toEqual({ type: "text", text: "專利" });
  await writer.write({ type: "text-delta", id: "answer", delta: "研究" });
  expect(await read()).toEqual({ type: "text", text: "專利研究" });
  await finish(writer);
  expect(await read()).toEqual({ type: "reply", text: "專利研究" });
  expect(await read()).toBeNull();
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(model.doStreamCalls).toHaveLength(1);
});

it("reports a mid-stream provider error without completing a partial reply", async () => {
  const { writer, read } = await start();
  await writer.write({ type: "text-delta", id: "answer", delta: "部分內容" });
  expect(await read()).toMatchObject({ type: "text" });
  await writer.write({ type: "error", error: new Error("provider unavailable") });
  await writer.close();
  expect(await read()).toMatchObject({ type: "error" });
  expect(await read()).toBeNull();
});

it("propagates response cancellation to the model", async () => {
  const { writer, reader } = await start();
  await writer.write({ type: "text-delta", id: "answer", delta: "部分內容" });
  await reader.cancel();
  expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
  await writer.close();
});

it("does not mark an aborted request as a complete reply", async () => {
  const { writer, read, cancellation } = await start();
  cancellation.abort();
  await writer.close();
  expect(await read()).toMatchObject({ type: "error" });
  expect(await read()).toBeNull();
});
