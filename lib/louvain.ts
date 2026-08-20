import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'
import { assocOf } from './concept-metrics'

export type CommunityWeightMode = 'support' | 'association'

export interface LouvainOptions {
  resolution?: number
  weightMode?: CommunityWeightMode
}

export interface LouvainOutcome {
  assignments: Map<string, number>
  /** 每個社群的連通分量數；>1 表示該社群不連通。 */
  connectivity: Map<number, number>
}

type LouvainEdge = {
  a: string
  b: string
  support: number
  association?: number
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

function associationWeights(edges: LouvainEdge[]): Array<number | undefined> {
  const incidentSupport = new Map<string, number>()
  let sumSupport = 0

  for (const edge of edges) {
    if (!(edge.support > 0)) continue
    incidentSupport.set(edge.a, (incidentSupport.get(edge.a) ?? 0) + edge.support)
    incidentSupport.set(edge.b, (incidentSupport.get(edge.b) ?? 0) + edge.support)
    sumSupport += edge.support
  }

  const m = sumSupport / 2
  return edges.map((edge) =>
    assocOf(
      edge.support,
      incidentSupport.get(edge.a) ?? 0,
      incidentSupport.get(edge.b) ?? 0,
      m,
    ),
  )
}

function connectivityOf(
  graph: Graph,
  assignments: Map<string, number>,
): Map<number, number> {
  const nodesByCommunity = new Map<number, string[]>()
  for (const [node, communityId] of assignments) {
    const nodes = nodesByCommunity.get(communityId) ?? []
    nodes.push(node)
    nodesByCommunity.set(communityId, nodes)
  }

  const connectivity = new Map<number, number>()
  for (const [communityId, nodes] of Array.from(nodesByCommunity.entries()).sort(
    ([a], [b]) => a - b,
  )) {
    const visited = new Set<string>()
    let components = 0

    for (const start of nodes) {
      if (visited.has(start)) continue
      components += 1
      const stack = [start]
      visited.add(start)

      while (stack.length > 0) {
        const node = stack.pop()!
        for (const neighbor of graph.neighbors(node)) {
          if (assignments.get(neighbor) !== communityId || visited.has(neighbor)) continue
          visited.add(neighbor)
          stack.push(neighbor)
        }
      }
    }

    connectivity.set(communityId, components)
  }

  return connectivity
}

export function runLouvain(
  nodes: string[],
  edges: Array<{ a: string; b: string; support: number; association?: number }>,
  options?: LouvainOptions,
): LouvainOutcome {
  const resolution = options?.resolution ?? 1
  const weightMode = options?.weightMode ?? 'association'
  const graph = new Graph({ type: 'undirected', multi: false })
  const sortedNodes = Array.from(new Set(nodes)).sort()
  const sortedEdges = Array.from(edges).sort((left, right) => {
    const leftKey = pairKey(left.a, left.b)
    const rightKey = pairKey(right.a, right.b)
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1
    return left.support - right.support
  })
  const weights =
    weightMode === 'association'
      ? associationWeights(sortedEdges)
      : sortedEdges.map((edge) => edge.support)

  for (const node of sortedNodes) graph.addNode(node)

  for (const [index, edge] of sortedEdges.entries()) {
    if (!graph.hasNode(edge.a) || !graph.hasNode(edge.b) || edge.a === edge.b) continue
    graph.addEdge(edge.a, edge.b, { weight: weights[index] ?? 0 })
  }

  const communityMap: Record<string, number> =
    graph.size === 0
      ? Object.fromEntries(sortedNodes.map((node, index) => [node, index]))
      : louvain(graph, {
          getEdgeWeight: 'weight',
          resolution,
          randomWalk: false,
        })
  const assignments = new Map<string, number>(
    Object.entries(communityMap).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )

  return { assignments, connectivity: connectivityOf(graph, assignments) }
}
