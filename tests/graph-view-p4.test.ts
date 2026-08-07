import { describe, expect, it } from 'vitest'
import { selectGraphView } from '../lib/graph-view'
import type { GraphData } from '../types/graph'

const methodology = {
  concept_frequency_metric: 'unique_patent_count',
  cooccurrence_metric: 'unique_patent_support',
  concept_size_formula: 'clamp(10 + 6 * sqrt(frequency), 10, 52)',
  applicant_size_formula: 'clamp(18 + 5 * sqrt(patent_count), 18, 52)',
  patent_size: 18,
  community_algorithm: 'louvain',
  community_edge_weight: 'support_count',
  community_resolution: 1,
  community_random_walk: false,
  layout_distance_interpretation: 'visual_only',
  prompt_version: 'test',
  model_provider: 'test',
  model_id: 'test',
  cooccurrence_data: 'native',
  semantic_provenance: 'complete',
} as const

const graph: GraphData = {
  schema_version: 3,
  nodes: [
    { id: 'concept:A', type: 'concept', label: 'A', color: '#111', size: 18, frequency: 2, community_id: 0, community_id_applicants: 0 },
    { id: 'concept:B', type: 'concept', label: 'B', color: '#111', size: 18, frequency: 2, community_id: 0, community_id_applicants: 1 },
    { id: 'concept:C', type: 'concept', label: 'C', color: '#222', size: 18, frequency: 1, community_id: 1, community_id_applicants: 1 },
  ],
  edges: [
    { id: 'co', from: 'concept:A', to: 'concept:B', relation: '共同出現', kind: 'cooccurrence', support_count: 1 },
  ],
  communities: [
    { id: 0, name: '篇群A', color: '#ff0000', node_count: 2 },
    { id: 1, name: '篇群B', color: '#00ff00', node_count: 1 },
  ],
  communities_applicants: [
    { id: 0, name: '家群1', color: '#0000ff', node_count: 1, unit: 'applicant' },
    { id: 1, name: '家群2', color: '#ff00ff', node_count: 2, unit: 'applicant' },
  ],
  stats: { applicant_count: 0, patent_count: 0, concept_count: 3, community_count: 2, year_range: [2020, 2021] },
  ai_report: '',
  generated_at: '2026-01-01T00:00:00.000Z',
  methodology,
}

describe('分單位社群著色（Q2）', () => {
  it('colorMode=community（缺省）用「篇」單位社群與色盤', () => {
    const view = selectGraphView(graph, { mode: 'concept', showSemantic: false, minSupport: 1, yearRange: [2020, 2021], edgeWeight: 'jaccard' })
    expect(view.communities.map((c) => c.name)).toEqual(['篇群A', '篇群B'])
    // 缺省模式不重上色——節點顏色在 build 時已 = 篇單位社群色（此處 fixture 給 #111）
    expect(view.nodes.find((n) => n.label === 'A')?.color).toBe('#111')
  })

  it('colorMode=community_applicants 用「家」單位社群與色盤（同 id 不同色）', () => {
    const view = selectGraphView(graph, { mode: 'concept', showSemantic: false, minSupport: 1, yearRange: [2020, 2021], colorMode: 'community_applicants', edgeWeight: 'jaccard' })
    expect(view.communities.map((c) => c.name)).toEqual(['家群1', '家群2'])
    // A: community_id_applicants=0 → 家群1 色（#0000ff），與篇單位 id 0 的 #ff0000 不同
    expect(view.nodes.find((n) => n.label === 'A')?.color).toBe('#0000ff')
    // B, C → 家群2
    expect(view.nodes.find((n) => n.label === 'B')?.color).toBe('#ff00ff')
    expect(view.nodes.find((n) => n.label === 'C')?.color).toBe('#ff00ff')
    expect(view.stats.community_count).toBe(2)
  })

  it('舊圖無家單位分區時，community_applicants 退為「篇」單位不破', () => {
    const legacy: GraphData = {
      ...graph,
      communities_applicants: undefined,
      nodes: graph.nodes.map((n) => ({ ...n, community_id_applicants: undefined })),
    }
    const view = selectGraphView(legacy, { mode: 'concept', showSemantic: false, minSupport: 1, yearRange: [2020, 2021], colorMode: 'community_applicants' })
    expect(view.communities).toHaveLength(0)
    expect(view.nodes.every((n) => n.color === '#111' || n.color === '#222')).toBe(true)
  })
})
describe('家單位門檻（Q3）', () => {
  const unitGraph: GraphData = {
    ...graph,
    edges: [
      { id: 'ab', from: 'concept:A', to: 'concept:B', relation: '共同出現', kind: 'cooccurrence', support_count: 5, support_applicants: 1 },
      { id: 'ac', from: 'concept:A', to: 'concept:C', relation: '共同出現', kind: 'cooccurrence', support_count: 1, support_applicants: 4 },
    ],
    nodes: graph.nodes.map((n) =>
      n.id === 'concept:A' ? { ...n, applicant_count: 5, size: 30 } : n,
    ),
  }

  it('unit=patent：門檻套 support_count；unit=applicant：門檻套 support_applicants', () => {
    const byPatent = selectGraphView(unitGraph, { mode: 'concept', showSemantic: false, minSupport: 2, yearRange: [2020, 2021], unit: 'patent' })
    expect(byPatent.edges.map((e) => e.id)).toEqual(['ab']) // support_count 5 ≥ 2
    const byApplicant = selectGraphView(unitGraph, { mode: 'concept', showSemantic: false, minSupport: 2, yearRange: [2020, 2021], unit: 'applicant' })
    expect(byApplicant.edges.map((e) => e.id)).toEqual(['ac']) // support_applicants 4 ≥ 2
    expect(byApplicant.maxSupport).toBe(4)
  })

  it('unit=applicant 節點大小改用家數', () => {
    const view = selectGraphView(unitGraph, { mode: 'concept', showSemantic: false, minSupport: 1, yearRange: [2020, 2021], unit: 'applicant' })
    const a = view.nodes.find((n) => n.id === 'concept:A')
    expect(a?.size).toBeGreaterThan(18) // 家數 5 → 較大
  })
})
