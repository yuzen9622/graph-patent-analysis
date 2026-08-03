// Types derived from PRD v1.1 Section 5 — Data Models

// 5.1 Input data (Excel row)
export interface PatentRow {
  id: string                    // System-generated: `${filename}-${rowIndex}` (e.g. "patents-0")
  title: string                 // Patent name (Chinese)
  abstract: string              // Abstract
  applicant: string             // Applicant (cleaned; multiple applicants separated by "；")
  applicant_raw?: string        // Original cell, incl. address and country — needed to recover country
  filing_date?: string          // Filing date (YYYY/MM/DD)
  application_number?: string   // Application number
  search_keyword?: string       // Search keyword
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
  community_id?: number
  source_patents?: string[]
  // Visual attributes
  color: string
  size: number
}

export type GraphMode = 'concept' | 'context'
export type GraphEdgeKind = 'structural' | 'cooccurrence' | 'semantic'

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
  source_patents?: string[]
  evidence?: RelationEvidence[]
}

export interface Community {
  id: number
  name: string
  color: string
  node_count: number
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
  prompt_version: string
  model_provider: string
  model_id: string
  cooccurrence_data: 'native' | 'reconstructed' | 'unavailable'
  semantic_provenance: 'complete' | 'partial' | 'unavailable'
}

export interface GraphData {
  schema_version: 2
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: Community[]
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
