import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import GraphLegend from '@/components/GraphLegend'
import type { GraphData, GraphMethodology, GraphMode } from '@/types/graph'

const methodology = {
  community_algorithm: 'louvain',
  cooccurrence_metric: 'jaccard',
  community_resolution: 1,
  model_id: 'gemini',
} as unknown as GraphMethodology

const stats: GraphData['stats'] = {
  applicant_count: 56,
  patent_count: 1869,
  concept_count: 186,
  community_count: 8,
  year_range: [2004, 2021],
}

/** paperMode 讓圖例展開，才能取得完整內文。 */
function render(mode: GraphMode, unit: 'patent' | 'applicant') {
  return renderToStaticMarkup(
    createElement(GraphLegend, { mode, unit, showSemantic: false, minSupport: 2, methodology, stats, paperMode: true }),
  )
}

describe('GraphLegend — 單位必須寫清楚（意圖・決策 9）', () => {
  it('概念圖「家」單位標明非篇數並給出大小對照', () => {
    const html = render('concept', 'applicant')
    expect(html).toContain('概念大小＝涵蓋該概念的不同機構家數，非專利篇數（1 家＝16、4 家＝22、9 家＝28）')
  })

  it('概念圖「篇」單位仍給出篇數對照', () => {
    expect(render('concept', 'patent')).toContain(
      '概念大小＝包含該概念的不同專利篇數（1 篇＝16、4 篇＝22、9 篇＝28）',
    )
  })

  it('機構網絡的節點大小是概念數而非家數或篇數', () => {
    const html = render('institution', 'applicant')
    expect(html).toContain('該機構涉足的不同技術概念數，非專利篇數')
    expect(html).toContain('1 概念＝23')
    expect(html).not.toContain('技術概念數（家，非篇數）')
  })

  it('footer 同時寫出機構家數與專利篇數', () => {
    for (const unit of ['patent', 'applicant'] as const) {
      expect(render('concept', unit)).toContain('分析樣本：56 家機構、1869 篇專利')
    }
  })
})
