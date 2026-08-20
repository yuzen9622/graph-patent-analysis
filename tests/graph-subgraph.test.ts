import { describe, expect, it } from "vitest";
import {
  computeSubgraphMetrics,
  extractKeywordSubgraphView,
  extractSubgraphView,
  isNodeMatchingKeyword,
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

describe("extractKeywordSubgraphView（關鍵字多節點主題子圖）", () => {
  // Topology:
  // V1 (語音辨識) - V2 (語音合成) - S1 (聲學模型) - N1 (神經網路)
  // V1 - S2 (特徵擷取)
  // V3 (語音編碼) - O1 (音訊壓縮)
  // X1 (生醫影像 - 無關)
  const speechNodes: GraphNode[] = [
    makeNode("V1", "語音辨識", 0),
    makeNode("V2", "語音合成", 0),
    makeNode("V3", "語音編碼", 0),
    makeNode("S1", "聲學模型", 1),
    makeNode("S2", "特徵擷取", 1),
    makeNode("N1", "神經網路", 1),
    makeNode("O1", "音訊壓縮", 2),
    makeNode("X1", "生醫影像", 3),
  ];

  const speechEdges: GraphEdge[] = [
    makeEdge("V1", "V2", 8, 0.7),
    makeEdge("V2", "S1", 6, 0.5),
    makeEdge("S1", "N1", 4, 0.4),
    makeEdge("V1", "S2", 5, 0.5),
    makeEdge("V3", "O1", 3, 0.3),
  ];

  const speechView: GraphViewData = {
    nodes: speechNodes,
    edges: speechEdges,
    communities: [
      { id: 0, name: "語音技術核心", color: "#10b981", node_count: 3 },
      { id: 1, name: "模型與演算法", color: "#6366f1", node_count: 3 },
      { id: 2, name: "音訊傳輸", color: "#f59e0b", node_count: 1 },
      { id: 3, name: "生醫領域", color: "#ec4899", node_count: 1 },
    ],
    stats: {
      applicant_count: 0,
      patent_count: 0,
      concept_count: 8,
      community_count: 4,
      year_range: [2018, 2024],
    },
    maxSupport: 8,
    citationEdges: [],
  };

  it("isNodeMatchingKeyword 正確比對 label 與 title", () => {
    expect(isNodeMatchingKeyword(speechNodes[0], "語音")).toBe(true);
    expect(isNodeMatchingKeyword(speechNodes[0], "辨識")).toBe(true);
    expect(isNodeMatchingKeyword(speechNodes[0], "影像")).toBe(false);
  });

  it("0-hop：僅抽取所有包含「語音」的節點（V1, V2, V3）及其內部關聯（V1-V2）", () => {
    const sub = extractKeywordSubgraphView(speechView, {
      query: "語音",
      hops: 0,
    });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["V1", "V2", "V3"]);
    expect(sub.edges.map((e) => e.id)).toEqual(["V1-V2"]);
    expect(sub.stats.concept_count).toBe(3);
    expect(sub.communities.map((c) => c.id)).toEqual([0]);
  });

  it("1-hop（建議模式）：抽取包含「語音」的所有節點 + 直接共現的周邊技術（S1, S2, O1）", () => {
    const sub = extractKeywordSubgraphView(speechView, {
      query: "語音",
      hops: 1,
    });
    // V1, V2, V3 + 鄰居 S1, S2, O1（排除 2-hop 外的 N1 與完全無關的 X1）
    expect(sub.nodes.map((n) => n.id).sort()).toEqual([
      "O1",
      "S1",
      "S2",
      "V1",
      "V2",
      "V3",
    ]);
    expect(sub.edges.map((e) => e.id).sort()).toEqual([
      "V1-S2",
      "V1-V2",
      "V2-S1",
      "V3-O1",
    ]);
    expect(sub.nodes.some((n) => n.id === "N1")).toBe(false);
    expect(sub.nodes.some((n) => n.id === "X1")).toBe(false);
  });

  it("2-hop：向外擴展 2 層，納入神經網路 N1，但仍排除無關的生醫影像 X1", () => {
    const sub = extractKeywordSubgraphView(speechView, {
      query: "語音",
      hops: 2,
    });
    expect(sub.nodes.map((n) => n.id).sort()).toEqual([
      "N1",
      "O1",
      "S1",
      "S2",
      "V1",
      "V2",
      "V3",
    ]);
    expect(sub.nodes.some((n) => n.id === "X1")).toBe(false);
  });

  it("搜尋無相符關鍵字時安全回傳原始視圖", () => {
    const sub = extractKeywordSubgraphView(speechView, {
      query: "完全找不到的關鍵字",
      hops: 1,
    });
    expect(sub).toBe(speechView);
  });
});
