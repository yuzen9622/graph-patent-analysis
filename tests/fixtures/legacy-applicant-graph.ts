import { conceptSize } from '../../lib/concept-network'
import type { GraphData } from '../../types/graph'

/**
 * 舊格式（schema v2 備份）圖：概念節點沒有 applicant_count，共現邊沒有
 * support_applicants。成員關係（專利↔概念／專利↔機構）以結構邊保存，
 * view 層可由此重建家計量（P9）。
 * 成員：p1＝{A}、p2＝{A,B}、p3＝{B,C}；a1 申請 p1,p2；a2 申請 p3。
 */
export const legacyApplicantGraph: GraphData = {
  schema_version: 2,
  nodes: [
    { id: 'patent:p1', type: 'patent', label: 'p1', color: '#ccc', size: 18, year: 2020 },
    { id: 'patent:p2', type: 'patent', label: 'p2', color: '#ccc', size: 18, year: 2021 },
    { id: 'patent:p3', type: 'patent', label: 'p3', color: '#ccc', size: 18, year: 2022 },
    { id: 'applicant:a1', type: 'applicant', label: '甲公司', color: '#999', size: 18 },
    { id: 'applicant:a2', type: 'applicant', label: '乙公司', color: '#999', size: 18 },
    {
      id: 'concept:A',
      type: 'concept',
      label: 'A',
      color: '#111',
      size: conceptSize(2),
      frequency: 2,
      community_id: 0,
    },
    {
      id: 'concept:B',
      type: 'concept',
      label: 'B',
      color: '#111',
      size: conceptSize(2),
      frequency: 2,
      community_id: 0,
    },
    {
      id: 'concept:C',
      type: 'concept',
      label: 'C',
      color: '#222',
      size: conceptSize(1),
      frequency: 1,
      community_id: 1,
    },
  ],
  edges: [
    { id: 's1', from: 'applicant:a1', to: 'patent:p1', relation: '申請了', kind: 'structural' },
    { id: 's2', from: 'applicant:a1', to: 'patent:p2', relation: '申請了', kind: 'structural' },
    { id: 's3', from: 'applicant:a2', to: 'patent:p3', relation: '申請了', kind: 'structural' },
    { id: 's4', from: 'patent:p1', to: 'concept:A', relation: '包含', kind: 'structural' },
    { id: 's5', from: 'patent:p2', to: 'concept:A', relation: '包含', kind: 'structural' },
    { id: 's6', from: 'patent:p2', to: 'concept:B', relation: '包含', kind: 'structural' },
    { id: 's7', from: 'patent:p3', to: 'concept:B', relation: '包含', kind: 'structural' },
    { id: 's8', from: 'patent:p3', to: 'concept:C', relation: '包含', kind: 'structural' },
    // 共現邊照舊格式：只有篇計量，沒有家計量。
    { id: 'coAB', from: 'concept:A', to: 'concept:B', relation: '共同出現', kind: 'cooccurrence', support_count: 1 },
    { id: 'coBC', from: 'concept:B', to: 'concept:C', relation: '共同出現', kind: 'cooccurrence', support_count: 1 },
  ],
  communities: [
    { id: 0, name: '群0', color: '#ff0000', node_count: 2 },
    { id: 1, name: '群1', color: '#00ff00', node_count: 1 },
  ],
  stats: { applicant_count: 2, patent_count: 3, concept_count: 3, community_count: 2, year_range: [2020, 2022] },
  ai_report: '',
  generated_at: '2026-01-01T00:00:00.000Z',
  methodology: {
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
    prompt_version: 'legacy',
    model_provider: 'unknown',
    model_id: 'unknown',
    cooccurrence_data: 'native',
    semantic_provenance: 'complete',
  },
}