import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchFields, draftFromPlan, planFromDraft } from "@/components/research/SearchFields";
import { AnalysisActivity } from "@/components/workspace/AnalysisActivity";

function render(status: "running" | "done" | "error" | "cancelled", done = 0, total = 0) {
  return renderToStaticMarkup(createElement(AnalysisActivity, {
    status, done, total,
    batches: done > 0 ? [{ batchIndex: 0, titles: ["金融專利測試資料"] }] : [],
  }));
}

describe("analysis activity presentation", () => {
  it("does not invent a percentage or completed batch before the server reports progress", () => {
    const markup = render("running");
    expect(markup).toContain("等待伺服器回報進度");
    expect(markup).not.toContain("金融專利測試資料");
    expect(markup).not.toContain("100%");
  });

  it("renders the reported batch and actual counts", () => {
    const markup = render("running", 2, 5);
    expect(markup).toContain("2 / 5 筆");
    expect(markup).toContain("金融專利測試資料");
    expect(markup).toContain("批次 1 · 1 筆");
  });

  it.each(["cancelled", "error"] as const)("does not report all tasks complete when %s", (status) => {
    const markup = render(status, 2, 5);
    expect(markup).toContain("已停止");
    expect(markup).not.toContain("已完成 2 / 2 個步驟");
  });

  it("reports completion only for a completed job", () => {
    const markup = render("done", 5, 5);
    expect(markup).toContain("已完成 2 / 2 個步驟");
  });
});

describe("structured patent retrieval", () => {
  it("starts with all results, accepts explicit limits and preserves saved limits", () => {
    const draft = { ...draftFromPlan(), keywords: "金融" };
    expect(planFromDraft(draft).limit).toBeNull();
    const markup = renderToStaticMarkup(createElement(SearchFields, { draft, onChange: () => {} }));
    const field = markup.match(/<input[^>]+type="number"[^>]*>/)?.[0];
    expect(field).toContain('placeholder="全部"');
    expect(field).not.toContain(' max=');
    for (const limit of ["20", "1001"]) {
      const plan = planFromDraft({ ...draft, limit });
      expect(plan.limit).toBe(Number(limit));
      expect(draftFromPlan(plan).limit).toBe(limit);
    }
  });
});
