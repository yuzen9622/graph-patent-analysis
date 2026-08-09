import type { GraphData } from '../../types/graph'

export function temporalGraph(): GraphData {
  return {
    schema_version: 3,
    nodes: [
      { id: 'patent:p1', type: 'patent', label: 'P1', year: 2018, source_files: ['old.xlsx'], ipc5: ['G06Q10/00'], color: '#999', size: 18 },
      { id: 'patent:p2', type: 'patent', label: 'P2', year: 2024, source_files: ['new.xlsx'], ipc5: ['H04L9/00'], color: '#999', size: 18 },
      { id: 'patent:p3', type: 'patent', label: 'P3', year: 2024, source_files: ['new.xlsx'], ipc5: ['G06Q20/00'], color: '#999', size: 18 },
      { id: 'concept:A', type: 'concept', label: 'A', source_patents: ['p1', 'p2'], frequency: 2, median_year: 2021, color: '#111', size: 18 },
      { id: 'concept:B', type: 'concept', label: 'B', source_patents: ['p1', 'p3'], frequency: 2, median_year: 2021, color: '#222', size: 18 },
      { id: 'concept:C', type: 'concept', label: 'C', source_patents: ['p2', 'p3'], frequency: 2, median_year: 2024, color: '#333', size: 18 },
    ],
    edges: [
      { id: 's1', from: 'patent:p1', to: 'concept:A', relation: '包含', kind: 'structural' },
      { id: 's2', from: 'patent:p1', to: 'concept:B', relation: '包含', kind: 'structural' },
      { id: 's3', from: 'patent:p2', to: 'concept:A', relation: '包含', kind: 'structural' },
      { id: 's4', from: 'patent:p2', to: 'concept:C', relation: '包含', kind: 'structural' },
      { id: 's5', from: 'patent:p3', to: 'concept:B', relation: '包含', kind: 'structural' },
      { id: 's6', from: 'patent:p3', to: 'concept:C', relation: '包含', kind: 'structural' },
      { id: 'ab', from: 'concept:B', to: 'concept:A', relation: '共同投入', kind: 'cooccurrence', support_count: 1, jaccard: 1 / 3 },
      { id: 'ac', from: 'concept:A', to: 'concept:C', relation: '共同投入', kind: 'cooccurrence', support_count: 1, jaccard: 1 / 3 },
      { id: 'bc', from: 'concept:B', to: 'concept:C', relation: '共同投入', kind: 'cooccurrence', support_count: 1, jaccard: 1 / 3 },
    ],
    communities: [{ id: 0, name: 'all', color: '#111', node_count: 3 }],
    stats: { applicant_count: 0, patent_count: 3, concept_count: 3, community_count: 1, year_range: [2018, 2024] },
    ai_report: '', generated_at: '2026-01-01T00:00:00.000Z',
    methodology: {
      concept_frequency_metric: 'unique_patent_count', cooccurrence_metric: 'unique_patent_support',
      concept_size_formula: '', applicant_size_formula: '', patent_size: 18,
      community_algorithm: 'louvain', community_edge_weight: 'support_count', community_resolution: 1,
      community_random_walk: false, layout_distance_interpretation: 'visual_only',
      prompt_version: 'test', model_provider: 'test', model_id: 'test',
      cooccurrence_data: 'native', semantic_provenance: 'complete',
    },
  }
}
