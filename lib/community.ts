import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'
import type { ConceptNetworkResult } from '@/lib/concept-network'

const COMMUNITY_COLORS: string[] = [
  '#4E79A7',
  '#F28E2B',
  '#E15759',
  '#76B7B2',
  '#59A14F',
  '#EDC948',
  '#B07AA1',
  '#FF9DA7',
  '#9C755F',
  '#BAB0AC',
  '#86BCB6',
  '#E9C46A',
  '#F4A261',
  '#264653',
  '#A8DADC',
]

export interface CommunityResult {
  assignments: Map<string, number>
  colors: Map<number, string>
  names: Map<number, string>
}

export function detectCommunities(
  conceptNetwork: ConceptNetworkResult
): CommunityResult {
  const graph = new Graph({ type: 'undirected', multi: false })

  for (const label of Array.from(conceptNetwork.concepts.keys()).sort()) {
    graph.addNode(label)
  }

  for (const edge of conceptNetwork.cooccurrenceEdges) {
    const source = edge.from.replace(/^concept:/, '')
    const target = edge.to.replace(/^concept:/, '')
    if (!graph.hasNode(source) || !graph.hasNode(target) || source === target) continue
    graph.addEdge(source, target, { weight: edge.support_count ?? 1 })
  }

  if (graph.order === 0) {
    return {
      assignments: new Map(),
      colors: new Map(),
      names: new Map(),
    }
  }

  // Louvain requires at least one edge. Isolated concepts are each their own
  // deterministic community instead of being dropped or causing an exception.
  const communityMap: { [node: string]: number } = graph.size === 0
    ? Object.fromEntries(graph.nodes().sort().map((node, index) => [node, index]))
    : louvain(graph, {
        getEdgeWeight: 'weight',
        resolution: 1,
        randomWalk: false,
      })

  const assignments = new Map<string, number>()
  for (const [node, communityId] of Object.entries(communityMap)) {
    assignments.set(node, communityId)
  }

  // Collect all unique community IDs
  const communityIds = Array.from(new Set(assignments.values())).sort(
    (a, b) => a - b
  )

  // Assign colors
  const colors = new Map<number, string>()
  communityIds.forEach((id, index) => {
    colors.set(id, COMMUNITY_COLORS[index % COMMUNITY_COLORS.length])
  })

  // Community name = highest-degree node in that community
  const names = new Map<number, string>()
  for (const communityId of communityIds) {
    let bestNode = ''
    let bestDegree = -1

    for (const [node, cid] of assignments) {
      if (cid !== communityId) continue
      const deg = graph.degree(node)
      if (deg > bestDegree) {
        bestDegree = deg
        bestNode = node
      }
    }

    names.set(communityId, bestNode)
  }

  return { assignments, colors, names }
}
