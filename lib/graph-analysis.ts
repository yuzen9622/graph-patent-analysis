import type { GraphNode, GraphEdge, GodNode, SurprisingConnection } from "@/types/graph";

const GOD_NODE_TOP_N = 10;
const SURPRISING_TOP_N = 15;
const MAX_BRIDGE_EDGE_COUNT_FOR_PAIR = 2; // 社群配對之間邊數 <= 此值才算「罕見橋接」

export function computeGodNodes(nodes: GraphNode[], edges: GraphEdge[]): GodNode[] {
  const degree = new Map<string, number>();
  const weightedDegree = new Map<string, number>();

  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    const w = e.weight ?? 1;
    weightedDegree.set(e.from, (weightedDegree.get(e.from) ?? 0) + w);
    weightedDegree.set(e.to, (weightedDegree.get(e.to) ?? 0) + w);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  return Array.from(degree.entries())
    .map(([id, deg]) => {
      const node = byId.get(id);
      return node
        ? {
            id,
            label: node.label,
            type: node.type,
            degree: deg,
            weighted_degree: weightedDegree.get(id) ?? deg,
          }
        : null;
    })
    .filter((n): n is GodNode => n !== null)
    .sort((a, b) => b.weighted_degree - a.weighted_degree)
    .slice(0, GOD_NODE_TOP_N);
}

export function computeSurprisingConnections(
  edges: GraphEdge[],
  nodes: GraphNode[],
): SurprisingConnection[] {
  const communityById = new Map(
    nodes.filter((n) => n.type === "concept").map((n) => [n.id, n.community_id]),
  );

  // 只看 concept-concept 邊（唯一有 community_id 的節點類型）
  const candidates = edges.filter((e) => {
    const fc = communityById.get(e.from);
    const tc = communityById.get(e.to);
    return fc !== undefined && tc !== undefined && fc !== tc;
  });

  if (candidates.length === 0) return [];

  // 統計每個社群配對（無序）之間有幾條橋接邊
  const pairCount = new Map<string, number>();
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (const e of candidates) {
    const fc = communityById.get(e.from)!;
    const tc = communityById.get(e.to)!;
    const key = pairKey(fc, tc);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  return candidates
    .map((e) => {
      const fc = communityById.get(e.from)!;
      const tc = communityById.get(e.to)!;
      const count = pairCount.get(pairKey(fc, tc))!;
      return {
        edge_id: e.id,
        from: e.from,
        to: e.to,
        from_community: fc,
        to_community: tc,
        weight: e.weight,
        reason: e.reason,
        bridge_rarity: 1 / count,
      };
    })
    .filter((c) => 1 / c.bridge_rarity <= MAX_BRIDGE_EDGE_COUNT_FOR_PAIR)
    .sort((a, b) => b.bridge_rarity - a.bridge_rarity || (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, SURPRISING_TOP_N);
}
