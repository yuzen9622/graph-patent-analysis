import type {
  CitationEdge,
  Community,
  GraphEdge,
  GraphNode,
} from "../types/graph";
import type { GraphViewData } from "./graph-view";
import { subgraphNodeIds } from "./publication-export";

export type SubgraphHops = 1 | 2 | 3;
export type KeywordSubgraphHops = 0 | 1 | 2;

export interface SubgraphOptions {
  centerNodeId: string;
  hops: SubgraphHops;
}

export interface KeywordSubgraphOptions {
  query: string;
  hops: KeywordSubgraphHops;
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

export type SubgraphState =
  | {
      kind: "keyword";
      query: string;
      matchedCount: number;
      hops: KeywordSubgraphHops;
    }
  | {
      kind: "node";
      centerNodeId: string;
      centerNodeLabel: string;
      hops: SubgraphHops;
    };

/**
 * 判斷節點是否與關鍵字查詢相符（比對 label、title、abstract、applicant）。
 */
export function isNodeMatchingKeyword(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (node.label.toLowerCase().includes(q)) return true;
  if (node.title && node.title.toLowerCase().includes(q)) return true;
  if (node.abstract && node.abstract.toLowerCase().includes(q)) return true;
  if (node.applicant && node.applicant.toLowerCase().includes(q)) return true;
  return false;
}

/**
 * 從一組種子節點 ID 開始做 BFS 擴展。
 * - hops = 0: 僅保留種子節點本身。
 * - hops = 1: 保留種子節點 + 1 步以內所有相鄰直接關聯節點。
 * - hops = 2: 向外擴展 2 步。
 */
export function multiSeedSubgraphNodeIds(
  seedIds: Set<string>,
  edges: Array<Pick<GraphEdge, "from" | "to">>,
  hops: KeywordSubgraphHops = 1,
): Set<string> {
  if (seedIds.size === 0) return new Set();
  if (hops === 0) return new Set(seedIds);

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>();
    set.add(b);
    adjacency.set(a, set);
  };
  for (const edge of edges) {
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }

  const visited = new Set<string>(seedIds);
  let frontier = new Set<string>(seedIds);

  for (let step = 0; step < hops; step += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}

/**
 * 抽取以關鍵字搜尋為基礎的主題子圖（包含所有包含該關鍵字的節點及擴展脈絡）。
 */
export function extractKeywordSubgraphView(
  view: GraphViewData,
  options: KeywordSubgraphOptions,
): GraphViewData {
  const { query, hops } = options;
  const cleanQuery = query.trim();
  if (!cleanQuery) return view;

  const matchedNodes = view.nodes.filter((node) =>
    isNodeMatchingKeyword(node, cleanQuery),
  );
  if (matchedNodes.length === 0) {
    return view;
  }

  const seedIds = new Set(matchedNodes.map((n) => n.id));
  const reachableIds = multiSeedSubgraphNodeIds(seedIds, view.edges, hops);
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
 * 抽取以 centerNodeId 為中心、半徑為 hops 的單一節點子圖視圖。
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
