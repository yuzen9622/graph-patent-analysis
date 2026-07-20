import { describe, expect, it } from "vitest";
import { selectGraphView } from "../lib/graph-view";
import type { GraphData } from "../types/graph";

const graph: GraphData = {
  schema_version: 2,
  nodes: [
    { id: "applicant:X", type: "applicant", label: "X", color: "#00f", size: 30, patent_count: 2 },
    { id: "patent:P1", type: "patent", label: "P1", color: "#f90", size: 18, year: 2020 },
    { id: "patent:P2", type: "patent", label: "P2", color: "#f90", size: 18, year: 2021 },
    { id: "concept:A", type: "concept", label: "A", color: "#0f0", size: 18, frequency: 2, community_id: 0 },
    { id: "concept:B", type: "concept", label: "B", color: "#0f0", size: 16, frequency: 1, community_id: 0 },
    { id: "concept:C", type: "concept", label: "C", color: "#f0f", size: 16, frequency: 1, community_id: 1 },
  ],
  edges: [
    { id: "a1", from: "applicant:X", to: "patent:P1", relation: "申請了", kind: "structural" },
    { id: "a2", from: "applicant:X", to: "patent:P2", relation: "申請了", kind: "structural" },
    { id: "p1a", from: "patent:P1", to: "concept:A", relation: "包含", kind: "structural" },
    { id: "p1b", from: "patent:P1", to: "concept:B", relation: "包含", kind: "structural" },
    { id: "p2a", from: "patent:P2", to: "concept:A", relation: "包含", kind: "structural" },
    { id: "p2c", from: "patent:P2", to: "concept:C", relation: "包含", kind: "structural" },
    { id: "co1", from: "concept:A", to: "concept:B", relation: "共同出現", kind: "cooccurrence", support_count: 1, jaccard: 0.5 },
    { id: "co2", from: "concept:A", to: "concept:C", relation: "共同出現", kind: "cooccurrence", support_count: 2, jaccard: 0.8 },
    { id: "sem", from: "concept:A", to: "concept:C", relation: "支援", kind: "semantic" },
  ],
  communities: [
    { id: 0, name: "群 0", color: "#0f0", node_count: 2 },
    { id: 1, name: "群 1", color: "#f0f", node_count: 1 },
  ],
  stats: { applicant_count: 1, patent_count: 2, concept_count: 3, community_count: 2, year_range: [2020, 2021] },
  ai_report: "",
  generated_at: "2026-01-01T00:00:00.000Z",
  methodology: {
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
  },
};

describe("selectGraphView", () => {
  it("概念網路只呈現概念，並依 support 門檻與 LLM 開關選邊", () => {
    const withoutSemantic = selectGraphView(graph, {
      mode: "concept", showSemantic: false, minSupport: 2, yearRange: [2020, 2021],
    });
    expect(withoutSemantic.nodes.every((node) => node.type === "concept")).toBe(true);
    expect(withoutSemantic.edges.map((edge) => edge.id)).toEqual(["co2"]);
    expect(withoutSemantic.maxSupport).toBe(2);
    expect(withoutSemantic.stats).toMatchObject({ patent_count: 2, applicant_count: 1 });

    const withSemantic = selectGraphView(graph, {
      mode: "concept", showSemantic: true, minSupport: 2, yearRange: [2020, 2021],
    });
    expect(withSemantic.edges.map((edge) => edge.id)).toEqual(["co2", "sem"]);
  });

  it("專利脈絡圖依年份重算節點計數、大小並移除孤立節點", () => {
    const view = selectGraphView(graph, {
      mode: "context", showSemantic: true, minSupport: 1, yearRange: [2020, 2020],
    });
    expect(view.nodes.map((node) => node.id).sort()).toEqual(
      ["applicant:X", "concept:A", "concept:B", "patent:P1"].sort(),
    );
    expect(view.edges.every((edge) => edge.kind === "structural")).toBe(true);
    expect(view.nodes.find((node) => node.id === "applicant:X")).toMatchObject({ patent_count: 1, size: 23 });
    expect(view.nodes.find((node) => node.id === "concept:A")).toMatchObject({ frequency: 1, size: 16, source_patents: ["P1"] });
    expect(view.stats).toMatchObject({ patent_count: 1, concept_count: 2, year_range: [2020, 2020] });
    const ids = new Set(view.nodes.map((node) => node.id));
    expect(view.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });
});
