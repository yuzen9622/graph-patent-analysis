// Types derived from PRD v1.1 Section 5 — Data Models

// 5.1 Input data (Excel row)
export interface PatentRow {
  // Stable content-derived identity — PRD v2 P0 §4.5.
  // `sha1hex(identityKey)` where identityKey is one of
  //   `pn|<patent_number>|<title_key>` / `an|<application_number>|<title_key>` /
  //   `noid|<title_key>|<sha1(abstract)>|<applicants…>|<filing_date>`
  // computed from the POST-MERGE fields, so the value never depends on upload
  // order.  (Pre-v2 this was `${filename}-${rowIndex}`, which did.)
  // The graph node id stays `patent:${PatentRow.id}` (lib/graph-builder.ts).
  id: string
  title: string                 // Patent name (Chinese)
  abstract: string              // Abstract
  applicant: string             // Applicant (cleaned; multiple applicants separated by "；")
  applicant_raw?: string        // Original cell, incl. address and country — needed to recover country
  filing_date?: string          // Filing date (YYYY/MM/DD for format A, YYYY-MM-DD for format B)
  application_number?: string   // Application number
  search_keyword?: string       // Search keyword

  // --- PRD v2 P0 §6.1 additions -------------------------------------------
  title_en?: string
  patent_number?: string
  publication_number?: string
  publication_date?: string
  applicants?: string[]         // optional on purpose — keeps pre-v2 fixtures type-valid (§8)
  inventors?: string[]
  ipc5?: string[]               // normalised L5 keys, e.g. "G06Q10/10"
  ipc5_raw?: string[]           // original cell values, before normalisation
  ipc_primary?: string          // normalised form of IPC5-1
  ipc_depth?: number            // 5 for full L5 keys, 3 for subclass-only values
  references?: string[]         // normalised 專利編號 of cited patents
  external_references?: string[]// references that match no patent in the dataset
  cited_by_count?: number
  case_status?: string          // parsed and stored only — no exclusion flags (§5.4)
  design_class?: string         // same
  source_files?: string[]       // optional on purpose — see applicants above (§8)
  search_keywords?: string[]
  applicant_key?: string        // normalised merge key; never overwrites `applicant` (§3.4)
}

// 5.2 LLM extraction result
export type RelationConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'

export interface ExtractionResult {
  patent_id: string
  translated_abstract: string
  keywords: string[]
  relations: Array<{
    source: string
    target: string
    relation: string
    weight: number  // 1–5
    reason?: string // 解釋這段關係的依據
    confidence?: RelationConfidence
  }>
}

// 5.3 Graph data

export type NodeType = 'applicant' | 'patent' | 'concept'

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  // Applicant node fields
  patent_count?: number
  // Patent node fields
  title?: string
  applicant?: string
  filing_date?: string
  year?: number
  abstract?: string
  application_number?: string
  // Concept node fields
  frequency?: number
  community_id?: number         // 篇單位社群
  community_id_applicants?: number // PRD v2/P4 Q2: 家單位社群（可缺省＝舊圖）
  source_patents?: string[]
  // --- PRD v2 / P4: applicant-unit metric (概念被幾家機構碰到) ---
  applicant_count?: number
  // --- PRD v2 / P4: institution-view fields (機構節點圖) ---
  concept_count?: number     // 涉足的概念數（家）
  org_type?: string          // 機構類型（bank / insurance / university / …）
  shared_concepts?: string[] // 與相鄰機構共享的概念
  // --- PRD v2 / P3/P6 additions: concept time metadata ----------------
  first_year?: number       // 首次有效申請年
  q1_year?: number          // nearest-rank 第一四分位年
  median_year?: number      // 標準中位有效申請年（可為 .5）
  q3_year?: number          // nearest-rank 第三四分位年
  last_year?: number        // 最近有效申請年
  median_loo_min?: number   // leave-one-out median 下界（只供顯示）
  median_loo_max?: number   // leave-one-out median 上界（只供顯示）
  year_counts?: Record<string, number>  // 年度分布 {year: count}
  /** Derived metrics on a view must all originate from this same scope (I1). */
  scope_id?: string
  /** P6: pre-007 lower median has no verified quartile provenance. */
  temporal_legacy_unverified?: boolean
  // --- PRD v2 P0 §6.1 additions -------------------------------------------
  // Patent nodes: carried on the node (not only on the transient PatentRow) so
  // that IPC / provenance filters can be recomputed after a reload.
  ipc5?: string[]
  ipc_primary?: string
  ipc_depth?: number
  source_files?: string[]
  cited_by_count?: number
  case_status?: string
  // Applicant nodes
  applicant_key?: string
  // Visual attributes
  color: string
  size: number
}

export type GraphMode = 'concept' | 'context' | 'institution'
export type GraphEdgeKind = 'structural' | 'cooccurrence' | 'semantic' | 'institution'

export interface RelationEvidence {
  patent_id: string
  weight?: number
  reason?: string
  confidence?: RelationConfidence
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  relation: string
  weight?: number         // Optional: absent on applicant→patent edges, present on concept edges
  reason?: string         // LLM 對此邊關聯性的解釋
  confidence?: RelationConfidence  // Only set on LLM-derived concept-concept edges
  source_patent?: string  // Which patent produced this edge
  kind?: GraphEdgeKind    // Optional only for loading pre-v2 graph files
  support_count?: number  // Unique patents supporting a co-occurrence/semantic edge
  jaccard?: number        // Co-occurrence similarity; never inferred for semantic edges
  // --- PRD v2 / P4 second slice: per-unit metrics (全量, 門檻前; 缺省=舊圖) ---
  support_applicants?: number        // 同一位申請人（跨篇）其專利同時含過兩概念的家數
  jaccard_applicants?: number       // 家單位 jaccard
  npmi?: number                     // 篇單位 NPMI（p_ij=1 → undefined, Q5）
  npmi_applicants?: number          // 家單位 NPMI
  association_strength?: number     // 篇單位 association strength（排序用, 意圖決策 2）
  association_strength_applicants?: number // 家單位 association strength
  source_patents?: string[]
  evidence?: RelationEvidence[]
  /** PRD v2 / P4: institution-edge (機構節點圖) shared-concept labels. */
  shared_concepts?: string[]
  /** P6 temporal direction: only present when both median ranks are distinct. */
  temporal_directed?: boolean
  /** Fixed support-count visual encoding; independent of width/citation (I4). */
  opacity?: number
  citation_supported?: boolean
  citation_direction_conflict?: boolean
  /** Derived metrics on a view must all originate from this same scope (I1). */
  scope_id?: string
}

/** Independent citation-only layer; it is never a zero-weight relation edge. */
export interface CitationEdge {
  id: string
  from: string
  to: string
  forward_count: number
  reverse_count: number
  supported: boolean
  direction_conflict: boolean
  scope_id?: string
}

export type CommunityUnit = 'patent' | 'applicant'

export interface Community {
  id: number
  name: string
  color: string
  node_count: number
  /** PRD v2 / P4 (Q2): 分單位。patent 為缺省（舊圖）；兩單位沿用各自分區。 */
  unit?: CommunityUnit
}

// graphify-style analysis: hub nodes and cross-community bridge edges
export interface GodNode {
  id: string
  label: string
  type: NodeType
  degree: number           // unweighted degree (edge count)
  weighted_degree: number  // sum of edge weight (weight=1 for structural edges)
}

export interface SurprisingConnection {
  edge_id: string
  from: string
  to: string
  from_community: number
  to_community: number
  weight?: number
  reason?: string
  bridge_rarity: number // 1 / (該社群配對之間的邊數)，越大越罕見
}

export interface GraphAnalysis {
  god_nodes: GodNode[]
  surprising_connections: SurprisingConnection[]
}

export interface GraphMethodology {
  concept_frequency_metric: 'unique_patent_count'
  cooccurrence_metric: 'unique_patent_support'
  concept_size_formula: string
  applicant_size_formula: string
  patent_size: number
  community_algorithm: 'louvain'
  community_edge_weight: 'support_count'
  community_resolution: number
  community_random_walk: boolean
  layout_distance_interpretation: 'visual_only'
  // --- PRD v2 / P3 additions (optional, absent on pre-v3 graphs) ---
  time_window?: [number, number] | null      // 漸層窗 = [min first_year, max first_year]
  time_color_scale?: 'sequential_blue'       // 漸層色盤名稱
  /** P6: true median, nearest-rank quartiles, and fixed visual heuristic. */
  temporal_median_method?: 'standard_median'
  temporal_quartile_method?: 'nearest_rank'
  support_strength_visual?: '0.30 + 0.70 * (1 - exp(-support/5))'
  support_strength_tau?: number
  time_axis?: 'ordinal_rank'
  quality_year_bounds?: [number, number]
  analysis_year_filter?: [number, number]
  layout_time_band?: 'ordinal_rank'
  citation_threshold?: 'net>=2 && ratio>=2'
  prompt_version: string
  model_provider: string
  model_id: string
  cooccurrence_data: 'native' | 'reconstructed' | 'unavailable'
  semantic_provenance: 'complete' | 'partial' | 'unavailable'
}

export interface GraphData {
  // 2 = PRD v1.2; 3 = P0–P5; 4 = P6 verified temporal semantics.
  schema_version: 2 | 3 | 4
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: Community[]
  /** PRD v2 / P4 (Q2): 「家」單位的社群分區（缺省=舊圖只有 patent 單位）。 */
  communities_applicants?: Community[]
  /** P6 independent citation-only evidence layer (optional for old graphs). */
  citation_edges?: CitationEdge[]
  /** Patent-level citation links retained for active-scope projection (I1). */
  patent_citations?: Array<{ from: string; to: string }>
  /** P6 projection identity; optional so saved legacy JSON remains loadable. */
  scope_id?: string
  warnings?: {
    temporal_direction_conflict?: Array<{ edge_id: string; forward: number; reverse: number }>
    legacy_temporal_indeterminate?: number
    temporal_cycles_broken?: Array<{
      edge_id: string
      old_source: string
      target: string
      support: number
      delta_median: number
      reason: 'legacy_or_corrupt_graph'
    }>
  }
  stats: {
    applicant_count: number
    patent_count: number
    concept_count: number
    community_count: number   // Corresponds to "W 社群" in the UI stats bar
    year_range: [number, number]
  }
  analysis?: GraphAnalysis     // Optional for backward-compat with pre-existing data/*.json files
  ai_report: string
  generated_at: string        // ISO 8601 UTC; frontend converts to UTC+8 for display
  methodology: GraphMethodology
}

// Job state managed by lib/store.ts (in-memory Map + data/ JSON files)
export interface JobState {
  id: string
  status: 'running' | 'done' | 'cancelled' | 'error'
  done: number
  total: number
  cancelled: boolean
  graph?: GraphData
  error?: string
}
