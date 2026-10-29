import { describe, expect, it } from "vitest";
import { parseViewQuery, toViewQueryString, type ViewState } from "../lib/view-url";
import { parseExportOptions, buildExportViews } from "../lib/export-html";
import type { BankOwnership } from "../lib/bank-ownership";
import { ownershipGraph } from "./fixtures/bank-ownership";
import { commonFilterSummary } from "../lib/compare-export";

const state: ViewState = {
  mode: "concept", showSemantic: false, colorMode: "community", minSupport: 1, yearRange: [2020, 2022],
};

describe("經營類型 URL 與離線匯出", () => {
  it.each<BankOwnership[]>([["public"], ["private"], []])("保留選取 %j", (...ownership) => {
    const query = toViewQueryString({ ...state, ownership });
    expect(parseViewQuery(query).ownership).toEqual(ownership);
    const options = parseExportOptions(new URLSearchParams(query), ownershipGraph);
    expect(options.ownership).toEqual(ownership);
    const views = buildExportViews(ownershipGraph, options);
    for (const view of Object.values(views)) expect(view.stats.patent_count).toBe(ownership.length === 0 ? 0 : 3);
  });
  it("比較摘要只在有篩選時註明經營類型", () => {
    const input = { ...state, unit: "patent" as const, edgeWeight: "jaccard" as const };
    expect(commonFilterSummary({ ...input, ownership: ["public"] })).toContain("經營類型：國營");
    expect(commonFilterSummary({ ...input, ownership: ["private"] })).toContain("經營類型：民營");
    expect(commonFilterSummary({ ...input, ownership: [] })).toContain("經營類型：未選取");
    expect(commonFilterSummary({ ...input, ownership: ["public", "private"] })).toEqual(commonFilterSummary(input));
  });
  it("全選不增加網址參數，舊連結保留預設", () => {
    expect(toViewQueryString({ ...state, ownership: ["public", "private"] })).toBe(toViewQueryString(state));
    expect(parseViewQuery("").ownership).toBeUndefined();
  });
  it("忽略不認識的值並去除重複", () => {
    expect(parseViewQuery("ownership=public&ownership=public").ownership).toEqual(["public"]);
    expect(parseViewQuery("ownership=invalid").ownership).toBeUndefined();
    expect(parseViewQuery("ownership=public&ownership=invalid").ownership).toBeUndefined();
  });
});
