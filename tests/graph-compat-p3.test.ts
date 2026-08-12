import { describe, expect, it } from 'vitest'
import { normalizeGraphData } from '../lib/graph-compat'
import type { GraphData, GraphNode } from '../types/graph'

/**
 * PRD v2 / P3 acceptance 5 (B6/B7):
 *  - time_window / time_color_scale must survive normalizeGraphData() (the
 *    admin/import path is the only place it ever runs), or they are dropped.
 *  - normalizeNode must validate the four concept-time fields (Number.isInteger
 *    on years, only finite counts) so dirty data cannot become a NaN colour.
 */

let seq = 0
function p3Graph(overrides: {
  methodology?: Partial<GraphData['methodology']>;
  dirtyFirstYear?: unknown;
} = {}): GraphData {
  const id = `concept:${seq++}`
  const node: GraphNode = {
    id,
    type: 'concept',
    label: `A${seq}`,
    color: '#ABCDEF',
    size: 30,
    first_year: 2007,
    last_year: 2025,
    median_year: 2020,
    year_counts: { '2007': 1, '2025': 1 },
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'dirtyFirstYear')) {
    ;(node as unknown as Record<string, unknown>).first_year = overrides.dirtyFirstYear
  }
  const graph: GraphData = {
    schema_version: 3,
    nodes: [node],
    edges: [],
    communities: [],
    stats: { concept_count: 1, patent_count: 0, applicant_count: 0, community_count: 0, year_range: [2007, 2025] },
    ai_report: '',
    generated_at: '2026-08-05T00:00:00.000Z',
    methodology: {
      concept_frequency_metric: 'unique_patent_count',
      cooccurrence_metric: 'unique_patent_support',
      concept_size_formula: 'x',
      applicant_size_formula: 'x',
      patent_size: 0,
      community_algorithm: 'louvain',
      community_edge_weight: 'support_count',
      community_resolution: 1,
      community_random_walk: false,
      layout_distance_interpretation: 'visual_only',
      prompt_version: 'p3',
      model_provider: 'test',
      model_id: 'test',
      cooccurrence_data: 'native',
      semantic_provenance: 'complete',
      time_window: [2007, 2025],
      time_color_scale: 'sequential_blue', // 舊名；normalize 應正規化為 rainbow
      ...overrides.methodology,
    },
  }
  return graph
}

describe('PRD v2 / P3 normalize 保留與驗證（B6/B7）', () => {
  it('v3 的 time_window／time_color_scale 經 normalizeGraphData 逐欄保留（舊名 sequential_blue 正規化為 rainbow）', () => {
    const graph = normalizeGraphData(p3Graph())
    expect(graph?.methodology.time_window).toEqual([2007, 2025])
    expect(graph?.methodology.time_color_scale).toBe('rainbow')
    const concept = graph?.nodes.find((n) => n.type === 'concept')
    expect(concept?.first_year).toBe(2007)
    expect(concept?.last_year).toBe(2025)
    expect(concept?.median_year).toBe(2020)
    expect(concept?.year_counts).toEqual({ '2007': 1, '2025': 1 })
  })

  it('缺欄的 time_window／time_color_scale 保持省略（undefined），不塞假預設', () => {
    const graph = normalizeGraphData(
      p3Graph({ methodology: { time_window: undefined, time_color_scale: undefined } }),
    )
    expect(graph?.methodology.time_window).toBeUndefined()
    expect(graph?.methodology.time_color_scale).toBeUndefined()
  })

  it('time\"window 非「兩個整數 tuple」→ null，不是假值', () => {
    const graph = normalizeGraphData(
      p3Graph({ methodology: { time_window: ['2007', 2025] as unknown as [number, number] } }),
    )
    expect(graph?.methodology.time_window).toBeNull()
  })

  it('first_year 為字串 → 變 undefined 而非 NaN 顏色', () => {
    const graph = normalizeGraphData(p3Graph({ dirtyFirstYear: '2019' }))
    const node = graph?.nodes.find((n) => n.type === 'concept')
    expect(node?.first_year).toBeUndefined()
    expect(String(node?.color ?? '').includes('NaN')).toBe(false)
  })

  it('first_year 為超大數字 → 變 undefined；color 無 NaN', () => {
    const graph = normalizeGraphData(p3Graph({ dirtyFirstYear: 1e309 }))
    const node = graph?.nodes.find((n) => n.type === 'concept')
    expect(node?.first_year).toBeUndefined()
    expect(String(node?.color ?? '').includes('NaN')).toBe(false)
  })
})