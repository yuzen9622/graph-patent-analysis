import { describe, expect, it } from 'vitest'
import { normalizeGraphData } from '../lib/graph-compat'
import { selectGraphView } from '../lib/graph-view'
import {
  analysisScopeKeyOf,
  citationAdjudication,
  fallbackCycleBreak,
  leaveOneOutMedianSpan,
  medianStandard,
  orientPair,
  quartiles,
  supportStrengthOpacity,
  timeRankOf,
  TEMPORAL_LEGEND_SENTENCE,
  TEMPORAL_OPACITY_LINE,
  TEMPORAL_YEAR_TERMS_LINE,
} from '../lib/temporal'

describe('P6 temporal pure rules', () => {
  it('uses standard medians and nearest-rank quartiles', () => {
    expect(medianStandard([])).toBeUndefined()
    expect(medianStandard([2018, 2019])).toBe(2018.5)
    expect(medianStandard([2018, 2024])).toBe(2021)
    expect(quartiles([2015, 2016, 2018, 2020])).toEqual({ q1: 2015, q3: 2018 })
    expect(leaveOneOutMedianSpan([2015, 2016, 2018, 2020])).toEqual({ min: 2016, max: 2018 })
  })

  it('uses fixed monotonic support opacity independent of citations', () => {
    expect(supportStrengthOpacity(0)).toBeCloseTo(0.30)
    expect(supportStrengthOpacity(5)).toBeCloseTo(0.7425, 3)
    expect(supportStrengthOpacity(10)).toBeCloseTo(0.9053, 3)
  })

  it('orients only distinct known median ranks, never labels or hashes', () => {
    expect(timeRankOf(undefined)).toBeNull()
    expect(orientPair(2018, 2020)).toEqual({ from: 'a', to: 'b' })
    expect(orientPair(2020, 2018)).toEqual({ from: 'b', to: 'a' })
    expect(orientPair(2020, 2020)).toBeUndefined()
    expect(orientPair(undefined, 2020)).toBeUndefined()
  })

  it('classifies all citation states with the rank direction kept separate', () => {
    expect(citationAdjudication(0, 0)).toMatchObject({ state: 'absent', net: 0 })
    expect(citationAdjudication(1, 0)).toMatchObject({ state: 'insufficient', net: 1, ratio: Infinity })
    expect(citationAdjudication(3, 1)).toMatchObject({ state: 'aligned', net: 2, ratio: 3 })
    expect(citationAdjudication(1, 3)).toMatchObject({ state: 'conflicting', net: 2, ratio: 3 })
  })

  it('breaks legacy cycles by support, median delta, then canonical edge id', () => {
    expect(fallbackCycleBreak([
      { edge_id: 'b', source: 'A', target: 'B', support: 2, delta_median: 4 },
      { edge_id: 'a', source: 'C', target: 'D', support: 2, delta_median: -4 },
      { edge_id: 'z', source: 'E', target: 'F', support: 3, delta_median: 1 },
    ])).toEqual({
      edge_id: 'a', old_source: 'C', target: 'D', support: 2, delta_median: -4,
      reason: 'legacy_or_corrupt_graph',
    })
  })

  it('routes legacy/corrupt graph through compatibility and view fallback', () => {
    const graph = normalizeGraphData({
      schema_version: 3,
      nodes: [
        { id: 'patent:p1', type: 'patent', label: 'p1', year: 2018, color: '#111', size: 10 },
        { id: 'patent:p2', type: 'patent', label: 'p2', year: 2020, color: '#111', size: 10 },
        ...['A', 'B', 'C'].map((label, i) => ({ id: `concept:${label}`, type: 'concept', label, color: '#111', size: 10, median_year: 2018 + i, q1_year: 2018 + i, q3_year: 2018 + i })),
        { id: 'concept:L', type: 'concept', label: 'L', color: '#111', size: 10, median_year: 2018 },
        { id: 'concept:M', type: 'concept', label: 'M', color: '#111', size: 10, median_year: 2020 },
      ],
      edges: [
        { id: 'ab', from: 'concept:A', to: 'concept:B', relation: '共同投入', kind: 'cooccurrence', support_count: 3, temporal_directed: true },
        { id: 'bc', from: 'concept:B', to: 'concept:C', relation: '共同投入', kind: 'cooccurrence', support_count: 2, temporal_directed: true },
        { id: 'ca', from: 'concept:C', to: 'concept:A', relation: '共同投入', kind: 'cooccurrence', support_count: 1, temporal_directed: true },
        { id: 'lm', from: 'concept:L', to: 'concept:M', relation: '共同投入', kind: 'cooccurrence', support_count: 1, temporal_directed: true },
      ],
      communities: [], stats: { applicant_count: 0, patent_count: 0, concept_count: 5, community_count: 0, year_range: [2018, 2020] },
      ai_report: '', generated_at: '2026-01-01T00:00:00Z',
      methodology: {},
    })!
    const view = selectGraphView(graph, { mode: 'concept', showSemantic: false, showCitations: false, minSupport: 1, yearRange: [2018, 2020] })
    expect(view.warnings?.temporal_cycles_broken).toEqual([expect.objectContaining({ edge_id: 'ca', old_source: 'concept:C', target: 'concept:A', support: 1, delta_median: -2, reason: 'legacy_or_corrupt_graph' })])
    expect(view.warnings?.legacy_temporal_indeterminate).toBe(2)
    expect(view.edges.find((edge) => edge.id === 'ca')?.temporal_directed).toBe(false)
    expect(view.edges.find((edge) => edge.id === 'lm')?.temporal_directed).toBe(false)
  })

  it('normalises analysis scope tuples before making a scope key', () => {
    expect(analysisScopeKeyOf({ dataset: ['B', 'A'], source: ['z', 'a'], ipc: ['H04', 'G06'], unit: 'patent', year: [2015, 2025] }))
      .toBe(analysisScopeKeyOf({ dataset: ['A', 'B'], source: ['a', 'z'], ipc: ['G06', 'H04'], unit: 'patent', year: [2015, 2025] }))
  })
})

describe('P6 圖說文字（§2/§4/§8 單一來源）', () => {
  it('TEMPORAL_LEGEND_SENTENCE 符合規格 §2 原文（附因果否認）', () => {
    expect(TEMPORAL_LEGEND_SENTENCE).toBe(
      'Vertical position indicates the ordinal ranking of median application year and does not imply causality or proportional temporal distance.',
    )
  })

  it('三窗一詞描述包含 quality_year_bounds / analysis_year_filter / layout_time_band', () => {
    expect(TEMPORAL_YEAR_TERMS_LINE).toContain('quality_year_bounds')
    expect(TEMPORAL_YEAR_TERMS_LINE).toContain('analysis_year_filter')
    expect(TEMPORAL_YEAR_TERMS_LINE).toContain('layout_time_band')
  })

  it('opacity 聲明是 visual heuristic（τ=5），不含 confidence', () => {
    expect(TEMPORAL_OPACITY_LINE).toContain('τ=5 is a visualization heuristic')
    expect(TEMPORAL_OPACITY_LINE).not.toMatch(/confidenc/i)
  })
})
