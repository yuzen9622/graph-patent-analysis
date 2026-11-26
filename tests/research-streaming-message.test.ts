import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ResearchAssistantMessage } from "@/components/research/ResearchAssistantMessage";

// Server rendering does not run the animation frames used by text smoothing.
vi.mock("@assistant-ui/react-markdown", async original => {
  const actual = await original<typeof import("@assistant-ui/react-markdown")>();
  return { ...actual, MarkdownTextPrimitive: (props: Parameters<typeof actual.MarkdownTextPrimitive>[0]) =>
    h(actual.MarkdownTextPrimitive, { ...props, smooth: false }) };
});

const state = vi.hoisted(() => ({ text: "", phase: "planning" }));
vi.mock("@/components/research/research-context", () => ({
  useResearchController: () => ({ messages: [{ id: "answer", ...state }] }),
}));

function Chat() {
  const runtime = useExternalStoreRuntime({
    messages: [{ id: "answer", role: "assistant" as const, content: state.text, status: { type: "running" as const } }],
    convertMessage: message => message,
    isRunning: true,
    onNew: async () => {},
  });
  return h(AssistantRuntimeProvider, { runtime, children: h(ThreadPrimitive.Messages, {
    children: () => h(ResearchAssistantMessage),
  }) });
}

it("renders streamed Markdown while planning instead of hiding it behind the loading state", () => {
  state.text = "";
  expect(renderToStaticMarkup(h(Chat))).toContain("正在規劃檢索條件");
  state.text = "正在比較**專利範圍**";
  const html = renderToStaticMarkup(h(Chat));
  expect(html).toContain("正在比較");
  expect(html).toMatch(/<strong[^>]*>專利範圍<\/strong>/);
  expect(html).not.toContain("正在規劃檢索條件");
});
