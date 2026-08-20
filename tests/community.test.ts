import { describe, expect, it } from "vitest";
import { buildConceptNetwork } from "../lib/concept-network";
import { detectCommunities } from "../lib/community";
import { buildGraph } from "../lib/graph-builder";
import { normalizeGraphData } from "../lib/graph-compat";
import type { ExtractionResult, PatentRow } from "../types/graph";

function extraction(
  patent_id: string,
  keywords: string[],
  relations: ExtractionResult["relations"] = [],
): ExtractionResult {
  return { patent_id, translated_abstract: "", keywords, relations };
}

function assignmentObject(result: ReturnType<typeof detectCommunities>) {
  return Object.fromEntries([...result.assignments.entries()].sort());
}

describe("community analysis contract", () => {
  it("相同共現網路可重現，且改變 semantic overlay 不影響社群", () => {
    const base = [
      extraction("P1", ["A", "B"]),
      extraction("P2", ["A", "B"]),
      extraction("P3", ["C", "D"]),
    ];
    const withSemantic = [...base];
    withSemantic[0] = extraction("P1", ["A", "B"], [
      { source: "A", target: "B", relation: "支援", weight: 5 },
    ]);

    const first = detectCommunities(buildConceptNetwork(base), { weightMode: "support" });
    const repeated = detectCommunities(buildConceptNetwork(base), { weightMode: "support" });
    const overlayChanged = detectCommunities(buildConceptNetwork(withSemantic), { weightMode: "support" });

    expect(assignmentObject(repeated)).toEqual(assignmentObject(first));
    expect(assignmentObject(overlayChanged)).toEqual(assignmentObject(first));
    expect(assignmentObject(first)).toEqual({ A: 0, B: 0, C: 1, D: 1 });
  });

  it("寫入實際的 Louvain 參數，且保留 association 與舊圖 support metadata", () => {
    const patents: PatentRow[] = [
      { id: "P1", title: "專利一", abstract: "", applicant: "X" },
      { id: "P2", title: "專利二", abstract: "", applicant: "Y" },
    ];
    const network = buildConceptNetwork([
      extraction("P1", ["A", "B"]),
      extraction("P2", ["A", "C"]),
    ]);
    const options = { resolution: 0.8, weightMode: "support" as const };
    const communities = detectCommunities(network, options);
    const graph = buildGraph(
      patents,
      network,
      communities.assignments,
      communities.colors,
      communities.names,
      { prompt_version: "test", model_provider: "test", model_id: "test" },
      undefined,
      options,
    );

    expect(graph.methodology.community_resolution).toBe(0.8);
    expect(graph.methodology.community_edge_weight).toBe("support_count");

    const associationOptions = { resolution: 0.8, weightMode: "association" as const };
    const associationCommunities = detectCommunities(network, associationOptions);
    const associationGraph = buildGraph(
      patents,
      network,
      associationCommunities.assignments,
      associationCommunities.colors,
      associationCommunities.names,
      { prompt_version: "test", model_provider: "test", model_id: "test" },
      undefined,
      associationOptions,
    );
    expect(associationGraph.methodology.community_edge_weight).toBe("association_strength");
    expect(normalizeGraphData(associationGraph)?.methodology.community_edge_weight).toBe(
      "association_strength",
    );

    const { community_edge_weight: _omitted, ...oldMethodology } = graph.methodology;
    expect(_omitted).toBe("support_count");
    const normalized = normalizeGraphData({ ...graph, methodology: oldMethodology });
    expect(normalized?.methodology.community_edge_weight).toBe("support_count");
  });

  it("樞紐分析只產生概念節點，且同篇重複申請人不重複計數", () => {
    const patents: PatentRow[] = [
      { id: "P1", title: "專利一", abstract: "", applicant: "X；X" },
      { id: "P2", title: "專利二", abstract: "", applicant: "X" },
    ];
    const network = buildConceptNetwork([
      extraction("P1", ["A", "B"]),
      extraction("P2", ["A", "C"]),
    ]);
    const communities = detectCommunities(network);
    const graph = buildGraph(
      patents,
      network,
      communities.assignments,
      communities.colors,
      communities.names,
      { prompt_version: "test", model_provider: "test", model_id: "test" },
    );

    expect(graph.nodes.find((node) => node.id === "applicant:X")?.patent_count).toBe(2);
    expect(graph.analysis?.god_nodes.length).toBeGreaterThan(0);
    expect(graph.analysis?.god_nodes.every((node) => node.type === "concept")).toBe(true);
  });
});
