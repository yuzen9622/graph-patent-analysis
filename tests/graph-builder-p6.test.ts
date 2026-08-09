import { describe, expect, it } from 'vitest'
import { buildGraph } from '../lib/graph-builder'
import { buildConceptNetwork } from '../lib/concept-network'
import type { ExtractionResult, PatentRow } from '../types/graph'

function temporalInputs() {
  const patents: PatentRow[] = []
  const extractions: ExtractionResult[] = []
  const citations: Array<{ from: string; to: string }> = []
  const add = (id: string, year: number, keywords: string[]) => {
    patents.push({ id, title: id, abstract: '', applicant: 'A', filing_date: `${year}-01-01` })
    extractions.push({ patent_id: id, translated_abstract: '', keywords, relations: [] })
  }
  const pair = (left: string, right: string, kind: 'absent' | 'insufficient' | 'aligned' | 'conflicting' | 'citation-only') => {
    if (kind !== 'citation-only') add(`${left}${right}-shared`, 2018, [left, right])
    for (let i = 1; i <= 3; i += 1) {
      add(`${left}${i}`, 2018, [left])
      add(`${right}${i}`, 2024, [right])
    }
    const forward = () => citations.push({ from: `${left}1`, to: `${right}1` })
    if (kind === 'insufficient') forward()
    if (kind === 'aligned' || kind === 'citation-only') {
      forward(); citations.push({ from: `${left}2`, to: `${right}2` }); citations.push({ from: `${left}3`, to: `${right}3` });
      citations.push({ from: `${right}1`, to: `${left}1` })
    }
    if (kind === 'conflicting') {
      forward(); citations.push({ from: `${right}1`, to: `${left}1` }); citations.push({ from: `${right}2`, to: `${left}2` }); citations.push({ from: `${right}3`, to: `${left}3` })
    }
  }
  pair('A', 'B', 'absent')
  pair('C', 'D', 'insufficient')
  pair('E', 'F', 'aligned')
  pair('G', 'H', 'conflicting')
  pair('I', 'J', 'citation-only')
  return { patents, network: buildConceptNetwork(extractions), citations }
}

describe('P6 builder citation evidence', () => {
  it('keeps citation four states separate from rank direction and makes a citation-only layer', () => {
    const { patents, network, citations } = temporalInputs()
    const labels = Array.from(network.concepts.keys())
    const graph = buildGraph(
      patents, network,
      new Map(labels.map((label) => [label, 0])), new Map([[0, '#111']]), new Map([[0, 'all']]),
      { prompt_version: 'test', model_provider: 'test', model_id: 'test' }, citations,
    )
    const edge = (from: string, to: string) => graph.edges.find((item) => item.kind === 'cooccurrence' && item.from === `concept:${from}` && item.to === `concept:${to}`)
    expect(edge('A', 'B')).toMatchObject({ temporal_directed: true, citation_supported: false, citation_direction_conflict: false })
    expect(edge('C', 'D')).toMatchObject({ citation_supported: false, citation_direction_conflict: false })
    expect(edge('E', 'F')).toMatchObject({ citation_supported: true, citation_direction_conflict: false })
    expect(edge('G', 'H')).toMatchObject({ citation_supported: true, citation_direction_conflict: true })
    expect(graph.warnings?.temporal_direction_conflict).toHaveLength(1)
    expect(graph.citation_edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'concept:I', to: 'concept:J', supported: true, direction_conflict: false }),
    ]))
    expect(graph.methodology).toMatchObject({ temporal_median_method: 'standard_median', temporal_quartile_method: 'nearest_rank', time_axis: 'ordinal_rank', support_strength_tau: 5 })
  })
})
