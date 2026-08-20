import { describe, expect, it } from "vitest";
import {
  computeSubgraphMetrics,
  extractSubgraphView,
} from "@/lib/graph-subgraph";
import type { GraphViewData } from "@/lib/graph-view";
import type { GraphEdge, GraphNode } from "@/types/graph";

const makeNode = (id: string, label: string, community_id = 0): GraphNode => ({
  id,
  type: "concept",
  label,
  color: "#3b82f6",
  size: 14,
  community_id,
  frequency: 5,
});

const makeEdge = (
  from: string,
  to: string,
  support_count = 3,
  jaccard = 0.5,
): GraphEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  relation: "cooccurrence",
  kind: "cooccurrence",
  support_count,
  jaccard,
});

describe("extractSubgraphView", () => {
  // Graph topology:
  // A - B - C - D
  //     |
  //     E
  // F (isolated)
  const nodes: GraphNode[] = [
    makeNode("A", "聯邦學習", 0),
    makeNode("B", "差分隱私", 0),
    makeNode("C", "同態加密", 1),
    makeNode("D", "雲端計算", 1),
    makeNode("E", "邊緣運算", 0),
    makeNode("F", "生醫材料", 2),
  ];

  const edges: GraphEdge[] = [
    makeEdge("A", "B", 10, 0.8),
    makeEdge("B", "C", 5, 0.4),
    makeEdge("C", "D", 3, 0.2),
    makeEdge("B", "E", 7, 0.6),
  ];

  const baseView: GraphViewData = {
    nodes,
    edges,
    communities: [
      { id: 0, name: "隱私保護技術", color: "#10b981", node_count: 3 },
      { id: 1, name: "密碼與雲端", color: "#6366f1", node_count: 2 },
      { id: 2, name: "生醫領域", color: "#f59e0b", node_count: 1 },
    ],
    stats: {
      applicant_count: 0,
      patent_count: 0,
      concept_count: 6,
      community_count: 3,
      year_range: [2018, 2024],
    },
    maxSupport: 10,
    citationEdges: [
      {
        id: "cite:A-B",
        from: "A",
        to: "B",
        forward_count: 2,
        reverse_count: 0,
        direction_conflict: false,
        supported: true,
      },
      {
        id: "cite:D-F",
        from: "D",
        to: "F",
        forward_count: 1,
        reverse_count: 0,
        direction_conflict: false,
        supported: true,
      },
    ],
  };

  it("1-hop 抽取以 A 為中心的子圖，只包含 A、B 與關聯邊和引用邊", () => {
    const sub = extractSubgraphView(baseView, { centerNodeId: "A", hops: 1 });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(sub.edges.map((e) => e.id)).toEqual(["A-B"]);
    expect(sub.citationEdges.map((e) => e.id)).toEqual(["cite:A-B"]);
    expect(sub.communities.map((c) => c.id)).toEqual([0]);
    expect(sub.stats.concept_count).toBe(2);
  });

  it("2-hops 抽取以 A 為中心的子圖，應包含 A, B, C, E", () => {
    const sub = extractSubgraphView(baseView, { centerNodeId: "A", hops: 2 });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "E"]);
    expect(sub.edges.map((e) => e.id).sort()).toEqual(["A-B", "B-C", "B-E"]);
    expect(sub.citationEdges.map((e) => e.id)).toEqual(["cite:A-B"]);
    expect(sub.communities.map((c) => c.id).sort()).toEqual([0, 1]);
    expect(sub.stats.concept_count).toBe(4);
  });

  it("3-hops 抽取以 A 為中心的子圖，應包含 A, B, C, D, E（排除獨立節點 F）", () => {
    const sub = extractSubgraphView(baseView, { centerNodeId: "A", hops: 3 });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(sub.edges.map((e) => e.id).sort()).toEqual([
      "A-B",
      "B-C",
      "B-E",
      "C-D",
    ]);
    expect(sub.communities.map((c) => c.id).sort()).toEqual([0, 1]);
    expect(sub.nodes.some((n) => n.id === "F")).toBe(false);
  });

  it("傳入不存在的 centerNodeId 時安全回傳原始視圖", () => {
    const sub = extractSubgraphView(baseView, {
      centerNodeId: "NON_EXISTENT",
      hops: 1,
    });
    expect(sub).toBe(baseView);
  });

  it("計算子圖指標 computeSubgraphMetrics 正確排序最高共現鄰居", () => {
    const metrics = computeSubgraphMetrics(baseView, "B", 1);
    expect(metrics.centerNode?.id).toBe("B");
    expect(metrics.directNeighborCount).toBe(3); // A, C, E
    expect(metrics.topCooccurring.map((t) => t.node.id)).toEqual([
      "A",
      "E",
      "C",
    ]); // 依 jaccard: A(0.8) > E(0.6) > C(0.4)
  });
});
