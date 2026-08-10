import { describe, expect, it } from 'vitest'
import { selectGraphView } from '../lib/graph-view'
import { temporalGraph } from './fixtures/temporal-graph'

const base = {
  mode: 'concept' as const,
  showSemantic: false,
  showCitations: false,
  minSupport: 1,
  edgeWeight: 'jaccard' as const,
}

describe('P6 I1–I3 temporal projection', () => {
  it('I1: a year cohort recomputes size, support, medians and one shared scope', () => {
    const view = selectGraphView(temporalGraph(), { ...base, yearRange: [2024, 2024] })
    expect(view.stats.patent_count).toBe(2)
    expect(view.stats.year_range).toEqual([2024, 2024])
    expect(view.nodes.every((node) => node.scope_id === view.scopeId)).toBe(true)
    expect(view.edges.filter((edge) => edge.kind === 'cooccurrence').every((edge) => edge.scope_id === view.scopeId)).toBe(true)
    expect(view.nodes.find((node) => node.label === 'A')).toMatchObject({ frequency: 1, median_year: 2024 })
    // Cohort {p2, p3}: A∩C = {p2} so ac survives with support 1 and Jaccard 1/2;
    // the disjoint pair (A,B) is dropped entirely.
    expect(view.edges.find((edge) => edge.id === 'ac')).toMatchObject({ support_count: 1, jaccard: 1 / 2 })
    expect(view.edges.find((edge) => edge.id === 'ab')).toBeUndefined()
  })

  it('I1: a year cohort recounts retained concepts in each preserved community', () => {
    const graph = temporalGraph()
    graph.nodes = graph.nodes.map((node) =>
      node.type === 'concept'
        ? { ...node, community_id: 0, community_id_applicants: 0 }
        : node,
    )
    graph.communities_applicants = [
      { id: 0, name: 'all applicants', color: '#222', node_count: 3 },
    ]

    const view = selectGraphView(graph, { ...base, yearRange: [2018, 2018] })
    const applicantView = selectGraphView(graph, {
      ...base,
      yearRange: [2018, 2018],
      colorMode: 'community_applicants',
    })

    expect(view.nodes.map((node) => node.label).sort()).toEqual(['A', 'B'])
    expect(view.communities).toMatchObject([
      { id: 0, name: 'all', color: '#111', node_count: 2 },
    ])
    expect(view.communities.reduce((sum, community) => sum + community.node_count, 0))
      .toBe(view.nodes.length)
    expect(applicantView.communities).toMatchObject([
      { id: 0, name: 'all applicants', color: '#222', node_count: 2 },
    ])
    expect(applicantView.communities.reduce((sum, community) => sum + community.node_count, 0))
      .toBe(applicantView.nodes.length)
  })

  it('I1: full views use their complete source-file dataset identities', () => {
    const first = temporalGraph()
    const second = {
      ...temporalGraph(),
      nodes: temporalGraph().nodes.map((node) => node.type === 'patent'
        ? { ...node, source_files: ['other-dataset.xlsx'] }
        : node),
    }
    const options = { ...base, yearRange: [2018, 2024] as [number, number], unit: 'patent' as const }
    const full = selectGraphView(first, options)
    const otherFull = selectGraphView(second, options)
    const subset = selectGraphView(first, { ...options, sourceFiles: ['new.xlsx'] })
    expect(full.scopeId).not.toBe(otherFull.scopeId)
    expect(full.scopeId).not.toBe(subset.scopeId)
  })

  it('I1: source + IPC + year dimensions each change scope and the active metrics', () => {
    const graph = temporalGraph()
    const source = selectGraphView(graph, { ...base, yearRange: [2018, 2024], sourceFiles: ['new.xlsx'] })
    const ipc = selectGraphView(graph, { ...base, yearRange: [2018, 2024], ipcLevel: 3, ipcFilter: ['G06Q'] })
    const windowed = selectGraphView(graph, { ...base, yearRange: [2024, 2024], sourceFiles: ['new.xlsx'], ipcLevel: 3, ipcFilter: ['G06Q'] })
    expect(source.scopeId).not.toBe(ipc.scopeId)
    expect(ipc.scopeId).not.toBe(windowed.scopeId)
    const applicantUnit = selectGraphView(graph, { ...base, yearRange: [2018, 2024], unit: 'applicant' })
    expect(applicantUnit.scopeId).not.toBe(selectGraphView(graph, { ...base, yearRange: [2018, 2024], unit: 'patent' }).scopeId)
    expect(source.nodes.find((node) => node.label === 'A')?.frequency).toBe(1)
    expect(ipc.nodes.find((node) => node.label === 'A')?.frequency).toBe(1)
    expect(windowed.nodes.find((node) => node.label === 'B')).toMatchObject({ frequency: 1, median_year: 2024 })
  })

  it('I2: temporal direction follows distinct active-scope median ranks', () => {
    const view = selectGraphView(temporalGraph(), { ...base, yearRange: [2018, 2024] })
    const ac = view.edges.find((edge) => edge.id === 'ac')
    expect(ac).toMatchObject({ from: 'concept:A', to: 'concept:C', temporal_directed: true })
  })

  it('I3: equal medians have no arrow even when the input edge order is reversed', () => {
    const view = selectGraphView(temporalGraph(), { ...base, yearRange: [2018, 2024] })
    const ab = view.edges.find((edge) => edge.id === 'ab')
    expect(ab?.temporal_directed).toBe(false)
    expect(ab?.from).toBe('concept:B')
    expect(ab?.to).toBe('concept:A')
  })
})
