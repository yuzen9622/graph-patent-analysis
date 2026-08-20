import { afterEach, describe, expect, it, vi } from 'vitest'

const louvainState = vi.hoisted(() => ({
  capturedWeights: new Map<string, number>(),
  forcedAssignments: undefined as Record<string, number> | undefined,
}))

vi.mock('graphology-communities-louvain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphology-communities-louvain')>()
  return {
    ...actual,
    default: (
      graph: Parameters<typeof actual.default>[0],
      options?: Parameters<typeof actual.default>[1],
    ) => {
      louvainState.capturedWeights.clear()
      for (const edge of graph.edges()) {
        const [a, b] = graph.extremities(edge).sort()
        louvainState.capturedWeights.set(`${a}\u0000${b}`, graph.getEdgeAttribute(edge, 'weight'))
      }
      return louvainState.forcedAssignments ?? actual.default(graph, options)
    },
  }
})

import { assocOf } from '../lib/concept-metrics'
import { runLouvain } from '../lib/louvain'

function assignmentsOf(assignments: Map<string, number>) {
  return Object.fromEntries([...assignments.entries()].sort())
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

afterEach(() => {
  louvainState.capturedWeights.clear()
  louvainState.forcedAssignments = undefined
})

describe('runLouvain', () => {
  it('同一輸入連跑兩次，assignments 逐鍵相同', () => {
    const nodes = ['D', 'C', 'B', 'A']
    const edges = [
      { a: 'A', b: 'B', support: 3 },
      { a: 'B', b: 'C', support: 2 },
      { a: 'C', b: 'D', support: 3 },
    ]

    const first = runLouvain(nodes, edges)
    const repeated = runLouvain(nodes, edges)

    expect(assignmentsOf(repeated.assignments)).toEqual(assignmentsOf(first.assignments))
  })

  it('回報刻意不連通社群的連通分量數', () => {
    louvainState.forcedAssignments = { A: 7, B: 7, C: 7, D: 7 }

    const outcome = runLouvain(
      ['A', 'B', 'C', 'D'],
      [
        { a: 'A', b: 'B', support: 1 },
        { a: 'C', b: 'D', support: 1 },
      ],
      { weightMode: 'support' },
    )

    expect(outcome.connectivity.get(7)).toBe(2)
  })

  it('association mode 逐邊使用 assocOf 的內部權重，而非 support 或傳入 association', () => {
    const edges = [
      { a: 'A', b: 'B', support: 2, association: 99 },
      { a: 'A', b: 'C', support: 1, association: 99 },
      { a: 'B', b: 'C', support: 3, association: 99 },
    ]
    const incidentSupport = new Map<string, number>()
    let sumSupport = 0
    for (const edge of edges) {
      incidentSupport.set(edge.a, (incidentSupport.get(edge.a) ?? 0) + edge.support)
      incidentSupport.set(edge.b, (incidentSupport.get(edge.b) ?? 0) + edge.support)
      sumSupport += edge.support
    }
    const m = sumSupport / 2

    runLouvain(['A', 'B', 'C'], edges, { weightMode: 'association' })

    for (const edge of edges) {
      const expected = assocOf(
        edge.support,
        incidentSupport.get(edge.a) ?? 0,
        incidentSupport.get(edge.b) ?? 0,
        m,
      )
      expect(expected).toBeDefined()
      expect(louvainState.capturedWeights.get(pairKey(edge.a, edge.b))).toBe(expected)
    }
  })
})
