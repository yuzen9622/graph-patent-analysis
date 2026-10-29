import { describe, expect, it } from "vitest";
import { selectGraphView, type GraphViewOptions } from "../lib/graph-view";
import type { GraphMode } from "../types/graph";
import type { BankOwnership } from "../lib/bank-ownership";
import { applicants, ownershipGraph } from "./fixtures/bank-ownership";

const options = (mode: GraphMode, ownership?: BankOwnership[]): GraphViewOptions => ({
  mode, showSemantic: false, minSupport: 1, yearRange: [2020, 2022], ownership,
});

for (const mode of ["concept", "context", "institution"] as const) {
  describe(`${mode}: 國營／民營篩選`, () => {
    it("預設與兩者皆選維持原檢視", () => {
      expect(selectGraphView(ownershipGraph, options(mode, ["public", "private"])))
        .toEqual(selectGraphView(ownershipGraph, options(mode)));
    });
    it.each([
      ["public", applicants.slice(0, 2), "國營技術", "民營技術"],
      ["private", applicants.slice(2), "民營技術", "國營技術"],
    ] as const)("只選 %s 時重算子集且不洩漏共同申請的另一類機構", (kind, names, included, excluded) => {
      const view = selectGraphView(ownershipGraph, options(mode, [kind]));
      expect(view.stats.patent_count).toBe(3);
      if (mode === "concept") {
        expect(view.nodes.find(n => n.label === included)).toBeDefined();
        expect(view.nodes.some(n => n.label === excluded)).toBe(false);
        expect(view.edges.find(e => e.id === "co:shared")?.support_count).toBe(3);
        expect(view.edges.find(e => e.id === "co:shared")?.support_applicants).toBe(2);
        expect(view.stats.applicant_count).toBe(2);
      } else {
        expect(view.nodes.filter(n => n.type === "applicant").map(n => n.label).sort()).toEqual([...names].sort());
      }
      const ids = new Set(view.nodes.map(n => n.id));
      expect(view.edges.every(e => ids.has(e.from) && ids.has(e.to))).toBe(true);
    });
    it("兩者皆不勾選顯示空結果，不回退為全選", () => {
      const view = selectGraphView(ownershipGraph, options(mode, []));
      expect(view.nodes).toEqual([]);
      expect(view.edges).toEqual([]);
      expect(view.stats.patent_count).toBe(0);
    });
    it("與來源、年份及 IPC 取交集", () => {
      const view = selectGraphView(ownershipGraph, {
        ...options(mode, ["public"]), sourceFiles: ["A.xlsx"], yearRange: [2020, 2021],
        ipcLevel: 3, ipcFilter: ["G06Q"],
      });
      expect(view.stats.patent_count).toBe(1);
    });
  });
}

it.each<BankOwnership>(["public", "private"])("%s 的家單位門檻只計入所選機構", kind => {
  const view = selectGraphView(ownershipGraph, {
    ...options("concept", [kind]), unit: "applicant", minSupport: 2,
  });
  expect(view.edges.find(edge => edge.id === "co:shared")?.support_applicants).toBe(2);
  const stricter = selectGraphView(ownershipGraph, {
    ...options("concept", [kind]), unit: "applicant", minSupport: 3,
  });
  expect(stricter.edges).toEqual([]);
});

it("不同國營民營子集具有不同 scope，且不修改原圖", () => {
  const original = structuredClone(ownershipGraph);
  const publicView = selectGraphView(ownershipGraph, options("concept", ["public"]));
  const privateView = selectGraphView(ownershipGraph, options("concept", ["private"]));
  expect(publicView.scopeId).not.toBe(privateView.scopeId);
  expect(ownershipGraph).toEqual(original);
});
