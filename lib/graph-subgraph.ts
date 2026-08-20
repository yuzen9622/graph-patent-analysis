import type {
  CitationEdge,
  Community,
  GraphEdge,
  GraphNode,
} from "../types/graph";
import type { GraphViewData } from "./graph-view";
import { subgraphNodeIds } from "./publication-export";

export type SubgraphHops = 1 | 2 | 3;

export interface SubgraphOptions {
  centerNodeId: string;
  hops: SubgraphHops;
}

export interface SubgraphNeighborItem {
  node: GraphNode;
  edge: GraphEdge;
}

export interface SubgraphMetrics {
  centerNode: GraphNode | undefined;
  hops: SubgraphHops;
  nodeCount: number;
  edgeCount: number;
  directNeighborCount: number;
  topCooccurring: SubgraphNeighborItem[];
  topCommunities: Array<{ communityId: number; count: number; name?: string }>;
}

/**
 * 抽取以 centerNodeId 為中心、半徑為 hops 的局部子圖視圖。
 * 1. 透過 BFS（subgraphNodeIds）找出 hops 步內所有可達節點。
 * 2. 過濾節點、邊與引用邊至子圖範圍。
 * 3. 保留子圖內出現之社群並重算統計數據。
 */
export function extractSubgraphView(
  view: GraphViewData,
  options: SubgraphOptions,
): GraphViewData {
  const { centerNodeId, hops } = options;
  if (!centerNodeId || !view.nodes.some((n) => n.id === centerNodeId)) {
    return view;
  }

  const reachableIds = subgraphNodeIds(centerNodeId, view.edges, hops);
  if (reachableIds.size === 0) {
    return view;
  }

  const nodes = view.nodes.filter((node) => reachableIds.has(node.id));
  const edges = view.edges.filter(
    (edge) => reachableIds.has(edge.from) && reachableIds.has(edge.to),
  );
  const citationEdges: CitationEdge[] = (view.citationEdges ?? []).filter(
    (edge) => reachableIds.has(edge.from) && reachableIds.has(edge.to),
  );

  const communityIds = new Set(
    nodes
      .map((node) => node.community_id)
      .filter((id): id is number => id !== undefined),
  );
  const communities: Community[] = view.communities.filter((comm) =>
    communityIds.has(comm.id),
  );

  const stats: GraphViewData["stats"] = {
    applicant_count: nodes.filter((n) => n.type === "applicant").length,
    patent_count: nodes.filter((n) => n.type === "patent").length,
    concept_count: nodes.filter((n) => n.type === "concept").length,
    community_count: communities.length,
    year_range: view.stats?.year_range ?? [0, 0],
  };

  return {
    ...view,
    nodes,
    edges,
    citationEdges,
    communities,
    stats,
  };
}

/**
 * 計算子圖中中心節點的關聯統計資訊（直接鄰居、最高共現詞、相關社群等）。
 */
export function computeSubgraphMetrics(
  view: GraphViewData,
  centerNodeId: string,
  hops: SubgraphHops = 1,
): SubgraphMetrics {
  const centerNode = view.nodes.find((node) => node.id === centerNodeId);
  const directEdges = view.edges.filter(
    (edge) => edge.from === centerNodeId || edge.to === centerNodeId,
  );

  const topCooccurring: SubgraphNeighborItem[] = directEdges
    .map((edge) => {
      const neighborId = edge.from === centerNodeId ? edge.to : edge.from;
      const neighbor = view.nodes.find((node) => node.id === neighborId);
      return neighbor ? { node: neighbor, edge } : null;
    })
    .filter((item): item is SubgraphNeighborItem => item !== null)
    .sort((a, b) => {
      const jDiff = (b.edge.jaccard ?? 0) - (a.edge.jaccard ?? 0);
      if (jDiff !== 0) return jDiff;
      return (b.edge.support_count ?? 0) - (a.edge.support_count ?? 0);
    });

  const commCounts = new Map<number, number>();
  for (const node of view.nodes) {
    if (typeof node.community_id === "number") {
      commCounts.set(
        node.community_id,
        (commCounts.get(node.community_id) ?? 0) + 1,
      );
    }
  }

  const topCommunities = Array.from(commCounts.entries())
    .map(([communityId, count]) => {
      const comm = view.communities.find((c) => c.id === communityId);
      return { communityId, count, name: comm?.name };
    })
    .sort((a, b) => b.count - a.count);

  return {
    centerNode,
    hops,
    nodeCount: view.nodes.length,
    edgeCount: view.edges.length,
    directNeighborCount: directEdges.length,
    topCooccurring,
    topCommunities,
  };
}
