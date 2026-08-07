import { describe, expect, it } from "vitest";
import {
  institutionTypeOf,
  selectGraphView,
} from "../lib/graph-view";
import type { GraphData } from "../types/graph";

const methodology = {
  concept_frequency_metric: "unique_patent_count",
  cooccurrence_metric: "unique_patent_support",
  concept_size_formula: "clamp(10 + 6 * sqrt(frequency), 10, 52)",
  applicant_size_formula: "clamp(18 + 5 * sqrt(patent_count), 18, 52)",
  patent_size: 18,
  community_algorithm: "louvain",
  community_edge_weight: "support_count",
  community_resolution: 1,
  community_random_walk: false,
  layout_distance_interpretation: "visual_only",
  prompt_version: "test",
  model_provider: "test",
  model_id: "test",
  cooccurrence_data: "native",
  semantic_provenance: "complete",
} as const;

const bank = "中國信託商業銀行股份有限公司";
const insu = "富邦人壽保險股份有限公司";
const uni = "國立臺灣大學";

function fixture(edges: GraphData["edges"]) {
  return {
    schema_version: 3,
    nodes: [
      { id: `applicant:${bank}`, type: "applicant" as const, label: bank, color: "#00f", size: 30, patent_count: 2 },
      { id: `applicant:${insu}`, type: "applicant" as const, label: insu, color: "#00f", size: 30, patent_count: 1 },
      { id: `applicant:${uni}`, type: "applicant" as const, label: uni, color: "#00f", size: 30, patent_count: 1 },
      { id: "patent:P1", type: "patent" as const, label: "P1", color: "#f90", size: 18, year: 2020 },
      { id: "patent:P2", type: "patent" as const, label: "P2", color: "#f90", size: 18, year: 2021 },
      { id: "patent:P3", type: "patent" as const, label: "P3", color: "#f90", size: 18, year: 2021 },
      { id: "patent:P4", type: "patent" as const, label: "P4", color: "#f90", size: 18, year: 2022 },
      { id: "concept:區塊鏈", type: "concept" as const, label: "區塊鏈", color: "#0f0", size: 18, frequency: 2, community_id: 0 },
      { id: "concept:智能客服", type: "concept" as const, label: "智能客服", color: "#0f0", size: 18, frequency: 2, community_id: 0 },
      { id: "concept:行動支付", type: "concept" as const, label: "行動支付", color: "#0f0", size: 18, frequency: 2, community_id: 1 },
      { id: "concept:保險理賠", type: "concept" as const, label: "保險理賠", color: "#0f0", size: 18, frequency: 1, community_id: 1 },
      { id: "concept:生物辨識", type: "concept" as const, label: "生物辨識", color: "#0f0", size: 18, frequency: 1, community_id: 2 },
    ],
    edges,
    communities: [
      { id: 0, name: "群 0", color: "#0f0", node_count: 2 },
      { id: 1, name: "群 1", color: "#0f0", node_count: 2 },
      { id: 2, name: "群 2", color: "#0f0", node_count: 1 },
    ],
    stats: {
      applicant_count: 3,
      patent_count: 4,
      concept_count: 5,
      community_count: 3,
      year_range: [2020, 2022],
    },
    ai_report: "",
    generated_at: "2026-01-01T00:00:00.000Z",
    methodology,
  } as GraphData;
}

const S = (from: string, to: string) => ({
  id: `s:${from}:${to}`,
  from,
  to,
  relation: "申請了",
  kind: "structural" as const,
});
const C = (from: string, to: string) => ({
  id: `c:${from}:${to}`,
  from,
  to,
  relation: "包含",
  kind: "structural" as const,
});

// bank: P1,P2 → {區塊鏈,智能客服,行動支付}
// insu: P3    → {行動支付,保險理賠}
// uni:  P4    → {區塊鏈,智能客服,生物辨識}
const structuralEdges = [
  S(`applicant:${bank}`, "patent:P1"),
  S(`applicant:${bank}`, "patent:P2"),
  S(`applicant:${insu}`, "patent:P3"),
  S(`applicant:${uni}`, "patent:P4"),
  C("patent:P1", "concept:區塊鏈"),
  C("patent:P1", "concept:智能客服"),
  C("patent:P2", "concept:行動支付"),
  C("patent:P3", "concept:行動支付"),
  C("patent:P3", "concept:保險理賠"),
  C("patent:P4", "concept:區塊鏈"),
  C("patent:P4", "concept:智能客服"),
  C("patent:P4", "concept:生物辨識"),
];

describe("機構節點圖 (institution view)", () => {
  it("節點＝機構、邊＝兩家共享的概念；銀行×大學共享 2 個、銀行×保險共享 1 個", () => {
    const view = selectGraphView(fixture(structuralEdges), {
      mode: "institution",
      showSemantic: false,
      minSupport: 1,
      yearRange: [2020, 2022],
    });
    expect(view.nodes.every((n) => n.type === "applicant")).toBe(true);
    expect(view.nodes.map((n) => n.label).sort()).toEqual([bank, insu, uni].sort());

    const bankUni = view.edges.find(
      (e) => e.from.includes(bank) && e.to.includes(uni),
    );
    expect(bankUni?.support_count).toBe(2);
    expect(bankUni?.shared_concepts).toEqual(["區塊鏈", "智能客服"]);

    const bankInsu = view.edges.find((e) => e.from.includes(bank) && e.to.includes(insu));
    expect(bankInsu?.support_count).toBe(1);
    expect(bankInsu?.shared_concepts).toEqual(["行動支付"]);
    // 大學與保險無共享 → 無邊
    expect(view.edges.some((e) => e.from.includes(uni) && e.to.includes(insu))).toBe(false);
  });

  it("minSupport 過濾掉共享概念不足的機構（門檻 2 只留銀行—大學）", () => {
    const view = selectGraphView(fixture(structuralEdges), {
      mode: "institution",
      showSemantic: false,
      minSupport: 2,
      yearRange: [2020, 2022],
    });
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0].support_count).toBe(2);
    expect(view.nodes.map((n) => n.label).sort()).toEqual([bank, uni].sort());
  });

  it("機構節點依機構類型著色，大學與銀行、保險用不同顏色", () => {
    const view = selectGraphView(fixture(structuralEdges), {
      mode: "institution", showSemantic: false, minSupport: 1, yearRange: [2020, 2022],
    });
    const bankNode = view.nodes.find((n) => n.label === bank)!;
    const insuNode = view.nodes.find((n) => n.label === insu)!;
    const uniNode = view.nodes.find((n) => n.label === uni)!;
    expect(bankNode.org_type).toBe("銀行");
    expect(insuNode.org_type).toBe("保險");
    expect(uniNode.org_type).toBe("大學");
    expect(bankNode.color).not.toBe(uniNode.color);
    expect(bankNode.color).not.toBe(insuNode.color);
    expect(bankNode.concept_count).toBe(3);
    expect(uniNode.size).toBeGreaterThan(insuNode.size!);
  });

  it("機構類型純量分類（institutionTypeOf）", () => {
    expect(institutionTypeOf("中國信託商業銀行股份有限公司")).toBe("銀行");
    expect(institutionTypeOf("富邦人壽保險股份有限公司")).toBe("保險");
    expect(institutionTypeOf("國立臺灣大學")).toBe("大學");
    expect(institutionTypeOf("國泰金融控股股份有限公司")).toBe("金控");
    expect(institutionTypeOf("王小明")).toBe("個人");
  });
});