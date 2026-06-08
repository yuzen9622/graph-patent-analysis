import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'
import type { ExtractionResult } from '@/types/graph'

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
  extractions: ExtractionResult[]
): CommunityResult {
  const graph = new Graph({ type: 'undirected', multi: false })

  // Add concept keyword nodes and co-occurrence edges
  for (const extraction of extractions) {
    const keywords = extraction.keywords ?? []

    // Ensure all keyword nodes exist
    for (const kw of keywords) {
      if (!graph.hasNode(kw)) {
        graph.addNode(kw)
      }
    }

    // Add co-occurrence edges for every pair of keywords in the same patent
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const a = keywords[i]
        const b = keywords[j]
        if (a === b) continue
        if (!graph.hasEdge(a, b)) {
          graph.addEdge(a, b, { weight: 1 })
        } else {
          const w = (graph.getEdgeAttribute(graph.edge(a, b), 'weight') as number) ?? 1
          graph.setEdgeAttribute(graph.edge(a, b), 'weight', w + 1)
        }
      }
    }

    // Add relation edges (concept-to-concept) from LLM output
    for (const rel of extraction.relations ?? []) {
      const { source, target } = rel
      if (!source || !target || source === target) continue

      if (!graph.hasNode(source)) graph.addNode(source)
      if (!graph.hasNode(target)) graph.addNode(target)

      if (!graph.hasEdge(source, target)) {
        graph.addEdge(source, target, { weight: rel.weight ?? 1 })
      } else {
        const w = (graph.getEdgeAttribute(graph.edge(source, target), 'weight') as number) ?? 1
        graph.setEdgeAttribute(graph.edge(source, target), 'weight', w + (rel.weight ?? 1))
      }
    }
  }

  if (graph.order === 0) {
    return {
      assignments: new Map(),
      colors: new Map(),
      names: new Map(),
    }
  }

  // Run Louvain community detection
  const communityMap: { [node: string]: number } = louvain(graph)

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
