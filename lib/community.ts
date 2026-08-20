import type { ConceptNetworkResult } from '@/lib/concept-network'
import { runLouvain, type LouvainOptions } from './louvain'

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
  conceptNetwork: ConceptNetworkResult,
  options?: LouvainOptions,
): CommunityResult {
  const labels = Array.from(conceptNetwork.concepts.keys()).sort()
  const labelsSet = new Set(labels)
  const degree = new Map<string, number>()
  const edges: Array<{ a: string; b: string; support: number }> = []

  for (const edge of conceptNetwork.cooccurrenceEdges) {
    const source = edge.from.replace(/^concept:/, '')
    const target = edge.to.replace(/^concept:/, '')
    if (!labelsSet.has(source) || !labelsSet.has(target) || source === target) continue
    edges.push({ a: source, b: target, support: edge.support_count ?? 1 })
    degree.set(source, (degree.get(source) ?? 0) + 1)
    degree.set(target, (degree.get(target) ?? 0) + 1)
  }

  const { assignments } = runLouvain(labels, edges, options)

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
      const deg = degree.get(node) ?? 0
      if (deg > bestDegree) {
        bestDegree = deg
        bestNode = node
      }
    }

    names.set(communityId, bestNode)
  }

  return { assignments, colors, names }
}
