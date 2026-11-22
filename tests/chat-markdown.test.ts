import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";

function renderReply(content: string) {
  function Chat() {
    const runtime = useExternalStoreRuntime({
      messages: [{ id: "answer", role: "assistant" as const, content }],
      convertMessage: (message) => message,
      onNew: async () => {},
    });
    return h(AssistantRuntimeProvider, { runtime, children: h(ThreadPrimitive.Messages, {
      children: () => h(MessagePrimitive.Parts, { components: { Text: MarkdownText } }),
    }) });
  }
  return renderToStaticMarkup(h(Chat));
}

test("renders block and inline Markdown in an assistant message", () => {
  const html = renderReply([
    "摘要\n====", "結果\n----", "###### 附錄", "> > 引言", "1. **目的**\n   - _分類_",
    "段落  \n換行", "---", "    4 < 5", "`<span>`", "\\*原文\\* &copy; AT&T",
    "[首頁](/home)", "<https://example.org>", "<mail@example.org>",
    "![附圖](/fig.png)", "![圖說][fig]", "[fig]: /ref.png",
    "| 欄 |\n| --- |\n| 值 |", "- [x] ~~已完成~~", "~~~ts\nconst count = 1\n~~~",
  ].join("\n\n"));
  for (const tag of ["h1", "h2", "h6", "blockquote", "ol", "ul", "strong", "em", "br",
    "hr", "pre", "code", "table", "td", "del"]) {
    expect(html).toMatch(new RegExp(`<${tag}\\b`));
  }
  for (const output of ["4 &lt; 5", "&lt;span&gt;", "*原文* © AT&amp;T", 'href="/home"',
    'href="https://example.org"', 'href="mailto:mail@example.org"', 'src="/fig.png"',
    'src="/ref.png"', 'type="checkbox"', "const count = 1"]) expect(html).toContain(output);
});

test("handles spaced reference labels while preserving literal and unresolved text", () => {
  const html = renderReply([
    "[**官方**] [ID]、![流程圖] [圖]、[id] []", "`[原文] [id]`、[無] [未定義]",
    "[id]: /source '資料來源'", "[圖]: /diagram.png",
  ].join("\n\n"));
  expect(html.match(/href="\/source"/g)).toHaveLength(2);
  expect(html).toContain('title="資料來源"');
  expect(html).toMatch(/<strong[^>]*>官方<\/strong>/);
  expect(html).toContain('src="/diagram.png"');
  expect(html).toContain("[原文] [id]");
  expect(html).toContain("[無] [未定義]");
});

test("renders formatting HTML and strips active content", () => {
  const html = renderReply([
    "<cite>*來源*</cite> <span>內文</span>",
    "<table><tr><td>*保留原文*</td></tr></table>",
    '<img src="/fig.png" width="80" onerror="invalid()">',
    '<script>discardScript()</script>', '<a href="javascript:invalid()">連結</a>',
  ].join("\n\n"));
  expect(html).toContain("<cite><em>來源</em></cite>");
  expect(html).toContain("<span>內文</span>");
  expect(html).toMatch(/<td[^>]*>\*保留原文\*<\/td>/);
  expect(html).toContain('width="80"');
  expect(html).not.toMatch(/<script|discardScript|onerror|javascript:/i);
});

test("keeps footnote links and backlinks connected after HTML sanitization", () => {
  const html = renderReply("說明[^1]\n\n[^1]: 資料來源");
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)];
  expect(anchors).toHaveLength(2);
  for (const [, target] of anchors) expect(html).toContain(`id="${target}"`);
});
