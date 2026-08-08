import type { GraphData } from '../../types/graph'

const methodology = {
  concept_frequency_metric: 'unique_patent_count' as const,
  cooccurrence_metric: 'unique_patent_support' as const,
  concept_size_formula: 'clamp(10 + 6 * sqrt(frequency), 10, 52)',
  applicant_size_formula: 'clamp(18 + 5 * sqrt(patent_count), 18, 52)',
  patent_size: 18,
  community_algorithm: 'louvain' as const,
  community_edge_weight: 'support_count' as const,
  community_resolution: 1,
  community_random_walk: false,
  layout_distance_interpretation: 'visual_only' as const,
  prompt_version: 'test',
  model_provider: 'test',
  model_id: 'test',
  cooccurrence_data: 'native' as const,
  semantic_provenance: 'complete' as const,
}

/**
 * PRD v2 / P5 測試 fixture。
 *
 * 專利（含 IPC 與來源檔）：
 *   p1 ipc5=[G06Q10/10, G06Q40/04]  src=fileA   → 概念 C1、C2
 *   p2 ipc5=[G06K9/00]              src=fileA   → 概念 C1
 *   p3 ipc5=[G06Q20/38]             src=fileB   → 概念 C2
 *   p4 ipc5=[H04L9/32]                          → 概念 C3
 *   p5 無 ipc5                                   → 概念 C4
 * 申請人：A1（p1,p2）、A2（p3,p4,p5）。cooccurrence C1–C2 support=1。
 */
export function ipcGraph(): GraphData {
  return {
    schema_version: 3,
    nodes: [
      { id: 'concept:C1', type: 'concept', label: 'C1', color: '#111', size: 18, frequency: 2, community_id: 0, source_patents: ['p1', 'p2'] },
      { id: 'concept:C2', type: 'concept', label: 'C2', color: '#222', size: 18, frequency: 2, community_id: 0, source_patents: ['p1', 'p3'] },
      { id: 'concept:C3', type: 'concept', label: 'C3', color: '#333', size: 18, frequency: 1, community_id: 1, source_patents: ['p4'] },
      { id: 'concept:C4', type: 'concept', label: 'C4', color: '#444', size: 18, frequency: 1, community_id: 1, source_patents: ['p5'] },
      { id: 'patent:p1', type: 'patent', label: '專利一', color: '#999', size: 18, ipc5: ['G06Q10/10', 'G06Q40/04'], source_files: ['fileA'] },
      { id: 'patent:p2', type: 'patent', label: '專利二', color: '#999', size: 18, ipc5: ['G06K9/00'], source_files: ['fileA'] },
      { id: 'patent:p3', type: 'patent', label: '專利三', color: '#999', size: 18, ipc5: ['G06Q20/38'], source_files: ['fileB'] },
      { id: 'patent:p4', type: 'patent', label: '專利四', color: '#999', size: 18, ipc5: ['H04L9/32'] },
      { id: 'patent:p5', type: 'patent', label: '專利五', color: '#999', size: 18, ipc5: undefined },
      { id: 'applicant:A1', type: 'applicant', label: 'A1', color: '#777', size: 18 },
      { id: 'applicant:A2', type: 'applicant', label: 'A2', color: '#777', size: 18 },
    ],
    edges: [
      { id: 'e-p1c1', from: 'patent:p1', to: 'concept:C1', relation: '包含', kind: 'structural' },
      { id: 'e-p1c2', from: 'patent:p1', to: 'concept:C2', relation: '包含', kind: 'structural' },
      { id: 'e-p2c1', from: 'patent:p2', to: 'concept:C1', relation: '包含', kind: 'structural' },
      { id: 'e-p3c2', from: 'patent:p3', to: 'concept:C2', relation: '包含', kind: 'structural' },
      { id: 'e-p4c3', from: 'patent:p4', to: 'concept:C3', relation: '包含', kind: 'structural' },
      { id: 'e-p5c4', from: 'patent:p5', to: 'concept:C4', relation: '包含', kind: 'structural' },
      { id: 'e-a1p1', from: 'applicant:A1', to: 'patent:p1', relation: '申請了', kind: 'structural' },
      { id: 'e-a1p2', from: 'applicant:A1', to: 'patent:p2', relation: '申請了', kind: 'structural' },
      { id: 'e-a2p3', from: 'applicant:A2', to: 'patent:p3', relation: '申請了', kind: 'structural' },
      { id: 'e-a2p4', from: 'applicant:A2', to: 'patent:p4', relation: '申請了', kind: 'structural' },
      { id: 'e-a2p5', from: 'applicant:A2', to: 'patent:p5', relation: '申請了', kind: 'structural' },
      { id: 'co1', from: 'concept:C1', to: 'concept:C2', relation: '共同出現', kind: 'cooccurrence', support_count: 1 },
    ],
    communities: [
      { id: 0, name: '篇群0', color: '#ff0000', node_count: 2 },
      { id: 1, name: '篇群1', color: '#00ff00', node_count: 2 },
    ],
    stats: { applicant_count: 2, patent_count: 5, concept_count: 4, community_count: 2, year_range: [2020, 2021] },
    ai_report: '',
    generated_at: '2026-01-01T00:00:00.000Z',
    methodology,
  }
}