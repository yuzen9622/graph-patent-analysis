import { describe, expect, it } from "vitest";
import { conceptTimeLines, nodeTooltipLines } from "@/lib/node-tooltip";
import type { GraphNode } from "@/types/graph";

function concept(extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "concept:區塊鏈",
    label: "區塊鏈",
    type: "concept",
    color: "#000",
    size: 20,
    frequency: 9,
    ...extra,
  } as GraphNode;
}

function applicant(extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "applicant:國泰",
    label: "國泰金融控股股份有限公司",
    type: "applicant",
    color: "#000",
    size: 20,
    patent_count: 12,
    ...extra,
  } as GraphNode;
}

describe("nodeTooltipLines — 單位不得被誤讀（意圖・決策 9）", () => {
  it("概念在「家」單位下把家數放最前面，且兩種計量都標單位", () => {
    const [line] = nodeTooltipLines(
      concept({ applicant_count: 3 }),
      "applicant",
    );
    expect(line).toBe("概念：區塊鏈（3 家機構／9 篇專利）");
  });

  it("概念在「篇」單位下把篇數放最前面，仍同時列出家數", () => {
    const [line] = nodeTooltipLines(concept({ applicant_count: 3 }), "patent");
    expect(line).toBe("概念：區塊鏈（9 篇專利／3 家機構）");
  });

  it("「家」單位下不得只出現「篇」而讓 3 家被讀成 3 篇", () => {
    const [line] = nodeTooltipLines(
      concept({ applicant_count: 3 }),
      "applicant",
    );
    expect(line).toContain("3 家機構");
    expect(line).not.toMatch(/（3 篇/);
  });

  it("舊圖沒有 applicant_count 時只列篇數，不假造家數", () => {
    const [line] = nodeTooltipLines(concept(), "applicant");
    expect(line).toBe("概念：區塊鏈（9 篇專利）");
    expect(line).not.toContain("家");
  });

  it("機構節點在機構網路視圖顯示涉足概念數（該視圖的節點大小語意）", () => {
    const [line] = nodeTooltipLines(applicant({ concept_count: 5 }));
    expect(line).toBe(
      "申請人：國泰金融控股股份有限公司（涉足 5 個技術概念／12 篇專利）",
    );
  });

  it("機構節點在其他視圖只顯示篇數，且用「篇」不用「件」", () => {
    const [line] = nodeTooltipLines(applicant());
    expect(line).toBe("申請人：國泰金融控股股份有限公司（12 篇專利）");
  });

  it("概念時間統計三行都出現，缺值的欄位不佔行", () => {
    const lines = nodeTooltipLines(
      concept({
        applicant_count: 3,
        first_year: 2010,
        median_year: 2015.5,
        last_year: 2021,
      }),
      "applicant",
    );
    expect(lines.slice(1)).toEqual([
      "首次出現：2010 年",
      "中位年：2015.5 年",
      "最近出現：2021 年",
    ]);
    expect(conceptTimeLines(concept({ first_year: 2010 }))).toEqual([
      "首次出現：2010 年",
    ]);
    expect(conceptTimeLines(concept())).toEqual([]);
  });

  it("專利節點顯示標題與申請日", () => {
    expect(
      nodeTooltipLines({
        id: "patent:1",
        label: "P1",
        type: "patent",
        color: "#000",
        size: 18,
        title: "一種區塊鏈交易方法",
        filing_date: "2018-03-04",
      } as GraphNode),
    ).toEqual(["一種區塊鏈交易方法", "申請日：2018-03-04"]);
  });
});
