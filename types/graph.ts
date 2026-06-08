// Types derived from PRD v1.1 Section 5 — Data Models

// 5.1 Input data (Excel row)
export interface PatentRow {
  id: string                    // System-generated: `${filename}-${rowIndex}` (e.g. "patents-0")
  title: string                 // Patent name (Chinese)
  abstract: string              // Abstract
  applicant: string             // Applicant (cleaned; multiple applicants separated by "；")
  filing_date?: string          // Filing date (YYYY/MM/DD)
  application_number?: string   // Application number
  search_keyword?: string       // Search keyword
}

// 5.2 LLM extraction result
export interface ExtractionResult {
  patent_id: string
  translated_abstract: string
  keywords: string[]
  relations: Array<{
    source: string
    target: string
    relation: string
    weight: number  // 1–5
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
  // Visual attributes
  color: string
  size: number
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  relation: string
  weight?: number         // Optional: absent on applicant→patent edges, present on concept edges
  source_patent?: string  // Which patent produced this edge
}

export interface Community {
  id: number
  name: string
  color: string
  node_count: number
}

export interface GraphData {
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
  ai_report: string
  generated_at: string        // ISO 8601 UTC; frontend converts to UTC+8 for display
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
