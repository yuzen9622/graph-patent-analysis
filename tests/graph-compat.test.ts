import { describe, expect, it } from "vitest";
import { normalizeGraphData } from "../lib/graph-compat";
import { selectGraphView } from "../lib/graph-view";

const legacyGraph = {
  nodes: [
    { id: "applicant:X", type: "applicant", label: "X", color: "#00f", size: 10 },
    { id: "patent:P1", type: "patent", label: "P1", color: "#f90", size: 10, year: 2020 },
    { id: "patent:P2", type: "patent", label: "P2", color: "#f90", size: 10, year: 2021 },
    { id: "concept:A", type: "concept", label: "A", color: "#0f0", size: 10 },
    { id: "concept:B", type: "concept", label: "B", color: "#0f0", size: 10 },
  ],
  edges: [
    { id: "s1", from: "applicant:X", to: "patent:P1", relation: "申請了" },
    { id: "s2", from: "applicant:X", to: "patent:P2", relation: "申請了" },
    { id: "s3", from: "patent:P1", to: "concept:A", relation: "包含" },
    { id: "s4", from: "patent:P1", to: "concept:B", relation: "包含" },
    { id: "s5", from: "patent:P2", to: "concept:A", relation: "包含" },
    {
      id: "llm1",
      from: "concept:A",
      to: "concept:B",
      relation: "支援",
      source_patent: "P1",
      weight: 4,
    },
    { id: "bad", from: "missing", to: "concept:A", relation: "包含" },
  ],
  communities: [],
  stats: { applicant_count: 1, patent_count: 2, concept_count: 2, community_count: 1, year_range: [2020, 2021] },
  ai_report: "legacy",
  generated_at: "2026-01-01T00:00:00.000Z",
};

describe("normalizeGraphData", () => {
  it("從舊版專利—概念結構重建共現，但不虛構完整 LLM 證據", () => {
    const graph = normalizeGraphData(legacyGraph);
    expect(graph?.schema_version).toBe(2);
    expect(graph?.methodology.cooccurrence_data).toBe("reconstructed");
    expect(graph?.methodology.semantic_provenance).toBe("partial");
    expect(graph?.edges.some((edge) => edge.id === "bad")).toBe(false);

    const co = graph?.edges.find((edge) => edge.kind === "cooccurrence");
    expect(co).toMatchObject({ support_count: 1, source_patents: ["P1"] });
    expect(co?.jaccard).toBeCloseTo(1 / 2);

    const semantic = graph?.edges.find((edge) => edge.kind === "semantic");
    expect(semantic?.support_count).toBeUndefined();
    expect(semantic?.source_patents).toEqual(["P1"]);
    expect(semantic?.evidence?.[0]).toMatchObject({ patent_id: "P1", weight: 4 });
    expect(semantic?.evidence?.[0].reason).toBeUndefined();
    expect(semantic?.evidence?.[0].confidence).toBeUndefined();

    const view = selectGraphView(graph!, {
      mode: "concept", showSemantic: false, minSupport: 1, yearRange: [2020, 2021],
    });
    expect(view.capabilityWarning).toContain("重建");
    expect(view.capabilityWarning).toContain("部分 LLM 關係來源");
  });

  it("缺少專利—概念成員關係時明確標示共現不可用", () => {
    const graph = normalizeGraphData({
      ...legacyGraph,
      edges: legacyGraph.edges.slice(0, 2),
    });
    expect(graph?.methodology.cooccurrence_data).toBe("unavailable");
    expect(graph?.edges.filter((edge) => edge.kind === "cooccurrence")).toHaveLength(0);
  });

  it("schema v2 方法欄位執行 runtime allowlist 與數值驗證", () => {
    const graph = normalizeGraphData({
      schema_version: 2,
      nodes: legacyGraph.nodes,
      edges: legacyGraph.edges,
      communities: [],
      methodology: {
        community_resolution: "</footer><script>alert(1)</script>",
        cooccurrence_data: "forged",
        semantic_provenance: "forged",
      },
    });
    expect(graph?.methodology.community_resolution).toBe(1);
    expect(graph?.methodology.cooccurrence_data).toBe("native");
    expect(graph?.methodology.semantic_provenance).toBe("complete");
  });
});
