/**
 * analyses.ts — persist and rebuild GraphData through normalised tables.
 *
 * The database is the source of truth. `lib/store.ts` additionally drops a
 * JSON snapshot on disk, but that file is a portable backup / export artefact,
 * never the thing the app reads back.
 */

import type { PoolClient } from 'pg'
import type {
  Community,
  GodNode,
  GraphData,
  GraphEdge,
  GraphMethodology,
  GraphNode,
  RelationConfidence,
  RelationEvidence,
  SurprisingConnection,
} from '@/types/graph'
import { classifyOrgType, extractCountry } from '@/lib/applicant-classify'
import { query, queryOne, withTransaction } from './client'

export type AnalysisStatus = 'running' | 'done' | 'cancelled' | 'error'

export interface AnalysisSummary {
  id: string
  owner_id: string | null
  owner_username: string | null
  upload_id: string | null
  filename: string | null
  status: AnalysisStatus
  error: string | null
  provider: string | null
  model_id: string | null
  prompt_version: string | null
  sample_size: number | null
  applicant_count: number
  patent_count: number
  concept_count: number
  community_count: number
  year_min: number | null
  year_max: number | null
  created_at: Date
  completed_at: Date | null
}

const SUMMARY_COLUMNS = `a.id, a.owner_id, u.username AS owner_username, a.upload_id, a.filename,
  a.status, a.error, a.provider, a.model_id, a.prompt_version, a.sample_size,
  a.applicant_count, a.patent_count, a.concept_count, a.community_count,
  a.year_min, a.year_max, a.created_at, a.completed_at`

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function createAnalysis(input: {
  id: string
  ownerId: string | null
  uploadId?: string | null
  filename?: string | null
  provider?: string | null
  sampleSize?: number | null
}): Promise<void> {
  await query(
    `INSERT INTO analyses (id, owner_id, upload_id, filename, provider, sample_size, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'running')
     ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.ownerId,
      input.uploadId ?? null,
      input.filename ?? null,
      input.provider ?? null,
      input.sampleSize ?? null,
    ],
  )
}

export async function setAnalysisStatus(
  id: string,
  status: AnalysisStatus,
  error?: string,
): Promise<void> {
  await query(
    `UPDATE analyses
     SET status = $2,
         error = $3,
         completed_at = CASE WHEN $2 IN ('done', 'error', 'cancelled') THEN now() ELSE completed_at END
     WHERE id = $1`,
    [id, status, error ?? null],
  )
}

export async function listAnalyses(options: {
  ownerId?: string | null
  includeAll?: boolean
  limit?: number
}): Promise<AnalysisSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  if (options.includeAll) {
    return query<AnalysisSummary>(
      `SELECT ${SUMMARY_COLUMNS} FROM analyses a
       LEFT JOIN users u ON u.id = a.owner_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit],
    )
  }
  return query<AnalysisSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM analyses a
     LEFT JOIN users u ON u.id = a.owner_id
     WHERE a.owner_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
    [options.ownerId ?? null, limit],
  )
}

export async function getAnalysis(id: string): Promise<AnalysisSummary | null> {
  return queryOne<AnalysisSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM analyses a
     LEFT JOIN users u ON u.id = a.owner_id
     WHERE a.id = $1`,
    [id],
  )
}

export async function deleteAnalysis(id: string): Promise<void> {
  await query('DELETE FROM analyses WHERE id = $1', [id])
}

// ── Bulk insert helper ──────────────────────────────────────────────────────

/** Chunked multi-row INSERT; a 500-patent graph is ~7k edges. */
async function insertRows(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 500,
): Promise<void> {
  if (rows.length === 0) return
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const params: unknown[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value)
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
      params,
    )
  }
}

// ── Save ────────────────────────────────────────────────────────────────────

export interface SaveContext {
  /** Extra per-patent fields not carried on GraphNode (keyed by patent node id). */
  patentExtras?: Map<string, { search_keyword?: string; translated_abstract?: string }>
  /** Cleaned applicant name → country, recovered from the raw spreadsheet cell. */
  applicantCountries?: Map<string, string>
}

export async function saveGraph(
  analysisId: string,
  graph: GraphData,
  context: SaveContext = {},
): Promise<void> {
  const applicantNodes = graph.nodes.filter((node) => node.type === 'applicant')
  const patentNodes = graph.nodes.filter((node) => node.type === 'patent')
  const conceptNodes = graph.nodes.filter((node) => node.type === 'concept')

  await withTransaction(async (client) => {
    // Re-saving an analysis replaces its contents wholesale.
    await client.query('DELETE FROM edges WHERE analysis_id = $1', [analysisId])
    await client.query('DELETE FROM communities WHERE analysis_id = $1', [analysisId])
    await client.query('DELETE FROM concepts WHERE analysis_id = $1', [analysisId])
    await client.query('DELETE FROM patents WHERE analysis_id = $1', [analysisId])
    await client.query('DELETE FROM applicants WHERE analysis_id = $1', [analysisId])

    await client.query(
      `UPDATE analyses SET
         status = 'done',
         error = NULL,
         model_id = COALESCE($2, model_id),
         prompt_version = COALESCE($3, prompt_version),
         provider = COALESCE($4, provider),
         applicant_count = $5,
         patent_count = $6,
         concept_count = $7,
         community_count = $8,
         year_min = $9,
         year_max = $10,
         schema_version = $11,
         methodology = $12,
         god_nodes = $13,
         surprising = $14,
         ai_report = $15,
         generated_at = $16,
         completed_at = now()
       WHERE id = $1`,
      [
        analysisId,
        graph.methodology?.model_id ?? null,
        graph.methodology?.prompt_version ?? null,
        graph.methodology?.model_provider ?? null,
        graph.stats.applicant_count,
        graph.stats.patent_count,
        graph.stats.concept_count,
        graph.stats.community_count,
        graph.stats.year_range?.[0] ?? null,
        graph.stats.year_range?.[1] ?? null,
        graph.schema_version ?? 2,
        graph.methodology ? JSON.stringify(graph.methodology) : null,
        graph.analysis?.god_nodes ? JSON.stringify(graph.analysis.god_nodes) : null,
        graph.analysis?.surprising_connections
          ? JSON.stringify(graph.analysis.surprising_connections)
          : null,
        graph.ai_report ?? null,
        graph.generated_at ? new Date(graph.generated_at) : new Date(),
      ],
    )

    await insertRows(
      client,
      'applicants',
      ['analysis_id', 'node_id', 'name', 'country', 'org_type', 'patent_count', 'color', 'size'],
      applicantNodes.map((node) => [
        analysisId,
        node.id,
        node.label,
        // Node labels are already cleaned, so the country can only come from
        // the raw cell; fall back to the label for legacy imports.
        context.applicantCountries?.get(node.label) ?? extractCountry(node.label),
        classifyOrgType(node.label),
        node.patent_count ?? 0,
        node.color,
        node.size,
      ]),
    )

    await insertRows(
      client,
      'patents',
      [
        'analysis_id',
        'node_id',
        'title',
        'abstract',
        'translated_abstract',
        'applicant_raw',
        'application_number',
        'filing_date',
        'year',
        'search_keyword',
        'color',
        'size',
      ],
      patentNodes.map((node) => {
        const extra = context.patentExtras?.get(node.id)
        return [
          analysisId,
          node.id,
          node.title ?? node.label,
          node.abstract ?? null,
          extra?.translated_abstract ?? null,
          node.applicant ?? null,
          node.application_number ?? null,
          node.filing_date ?? null,
          node.year ?? null,
          extra?.search_keyword ?? null,
          node.color,
          node.size,
        ]
      }),
    )

    await insertRows(
      client,
      'concepts',
      ['analysis_id', 'node_id', 'label', 'frequency', 'community_id', 'color', 'size'],
      conceptNodes.map((node) => [
        analysisId,
        node.id,
        node.label,
        node.frequency ?? 0,
        node.community_id ?? null,
        node.color,
        node.size,
      ]),
    )

    await insertRows(
      client,
      'communities',
      ['analysis_id', 'community_id', 'name', 'color', 'node_count'],
      graph.communities.map((community) => [
        analysisId,
        community.id,
        community.name,
        community.color,
        community.node_count,
      ]),
    )

    await insertRows(
      client,
      'edges',
      [
        'analysis_id',
        'edge_id',
        'kind',
        'from_node',
        'to_node',
        'relation',
        'weight',
        'support_count',
        'jaccard',
        'reason',
        'confidence',
        'source_patent',
        'source_patents',
        'evidence',
      ],
      graph.edges.map((edge) => [
        analysisId,
        edge.id,
        edge.kind ?? null,
        edge.from,
        edge.to,
        edge.relation,
        edge.weight ?? null,
        edge.support_count ?? null,
        edge.jaccard ?? null,
        edge.reason ?? null,
        edge.confidence ?? null,
        edge.source_patent ?? null,
        edge.source_patents ?? null,
        edge.evidence ? JSON.stringify(edge.evidence) : null,
      ]),
    )

    // Membership tables derived from the structural edges, so that
    // "which patents mention concept X in 2023" is a two-join query.
    await client.query(
      `INSERT INTO patent_applicants (patent_id, applicant_id)
       SELECT p.id, ap.id
       FROM edges e
       JOIN applicants ap ON ap.analysis_id = e.analysis_id AND ap.node_id = e.from_node
       JOIN patents p     ON p.analysis_id  = e.analysis_id AND p.node_id  = e.to_node
       WHERE e.analysis_id = $1
       ON CONFLICT DO NOTHING`,
      [analysisId],
    )

    await client.query(
      `INSERT INTO patent_concepts (patent_id, concept_id)
       SELECT p.id, c.id
       FROM edges e
       JOIN patents p  ON p.analysis_id  = e.analysis_id AND p.node_id  = e.from_node
       JOIN concepts c ON c.analysis_id = e.analysis_id AND c.node_id = e.to_node
       WHERE e.analysis_id = $1
       ON CONFLICT DO NOTHING`,
      [analysisId],
    )
  })
}

// ── Load ────────────────────────────────────────────────────────────────────

interface ApplicantRow {
  node_id: string
  name: string
  patent_count: number
  color: string | null
  size: number | null
}

interface PatentRowDb {
  node_id: string
  title: string | null
  abstract: string | null
  applicant_raw: string | null
  application_number: string | null
  filing_date: string | null
  year: number | null
  color: string | null
  size: number | null
}

interface ConceptRow {
  node_id: string
  label: string
  frequency: number
  community_id: number | null
  color: string | null
  size: number | null
}

interface EdgeRow {
  edge_id: string
  kind: GraphEdge['kind']
  from_node: string
  to_node: string
  relation: string | null
  weight: number | null
  support_count: number | null
  jaccard: number | null
  reason: string | null
  confidence: RelationConfidence | null
  source_patent: string | null
  source_patents: string[] | null
  evidence: RelationEvidence[] | null
}

interface AnalysisRow {
  schema_version: number
  methodology: GraphMethodology | null
  god_nodes: GodNode[] | null
  surprising: SurprisingConnection[] | null
  ai_report: string | null
  generated_at: Date | null
  applicant_count: number
  patent_count: number
  concept_count: number
  community_count: number
  year_min: number | null
  year_max: number | null
  status: AnalysisStatus
}

export async function loadGraph(analysisId: string): Promise<GraphData | null> {
  const meta = await queryOne<AnalysisRow>(
    `SELECT schema_version, methodology, god_nodes, surprising, ai_report, generated_at,
            applicant_count, patent_count, concept_count, community_count,
            year_min, year_max, status
     FROM analyses WHERE id = $1`,
    [analysisId],
  )
  if (!meta || meta.status !== 'done') return null

  const [applicants, patents, concepts, communityRows, edgeRows] = await Promise.all([
    query<ApplicantRow>(
      'SELECT node_id, name, patent_count, color, size FROM applicants WHERE analysis_id = $1 ORDER BY id',
      [analysisId],
    ),
    query<PatentRowDb>(
      `SELECT node_id, title, abstract, applicant_raw, application_number, filing_date, year, color, size
       FROM patents WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
    query<ConceptRow>(
      `SELECT node_id, label, frequency, community_id, color, size
       FROM concepts WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
    query<Community & { community_id: number }>(
      `SELECT community_id, name, color, node_count FROM communities
       WHERE analysis_id = $1 ORDER BY community_id`,
      [analysisId],
    ),
    query<EdgeRow>(
      `SELECT edge_id, kind, from_node, to_node, relation, weight, support_count, jaccard,
              reason, confidence, source_patent, source_patents, evidence
       FROM edges WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
  ])

  const nodes: GraphNode[] = [
    ...applicants.map((row): GraphNode => ({
      id: row.node_id,
      type: 'applicant',
      label: row.name,
      patent_count: row.patent_count,
      color: row.color ?? '#94A3B8',
      size: row.size ?? 18,
    })),
    ...patents.map((row): GraphNode => ({
      id: row.node_id,
      type: 'patent',
      label: row.title ?? row.node_id,
      title: row.title ?? undefined,
      abstract: row.abstract ?? undefined,
      applicant: row.applicant_raw ?? undefined,
      application_number: row.application_number ?? undefined,
      filing_date: row.filing_date ?? undefined,
      year: row.year ?? undefined,
      color: row.color ?? '#94A3B8',
      size: row.size ?? 18,
    })),
    ...concepts.map((row): GraphNode => ({
      id: row.node_id,
      type: 'concept',
      label: row.label,
      frequency: row.frequency,
      community_id: row.community_id ?? undefined,
      color: row.color ?? '#94A3B8',
      size: row.size ?? 10,
    })),
  ]

  const edges: GraphEdge[] = edgeRows.map((row) => {
    const edge: GraphEdge = {
      id: row.edge_id,
      from: row.from_node,
      to: row.to_node,
      relation: row.relation ?? '',
    }
    if (row.kind) edge.kind = row.kind
    if (row.weight !== null) edge.weight = row.weight
    if (row.support_count !== null) edge.support_count = row.support_count
    if (row.jaccard !== null) edge.jaccard = row.jaccard
    if (row.reason !== null) edge.reason = row.reason
    if (row.confidence !== null) edge.confidence = row.confidence
    if (row.source_patent !== null) edge.source_patent = row.source_patent
    if (row.source_patents !== null) edge.source_patents = row.source_patents
    if (row.evidence !== null) edge.evidence = row.evidence
    return edge
  })

  const communities: Community[] = communityRows.map((row) => ({
    id: row.community_id,
    name: row.name,
    color: row.color,
    node_count: row.node_count,
  }))

  return {
    schema_version: 2,
    nodes,
    edges,
    communities,
    stats: {
      applicant_count: meta.applicant_count,
      patent_count: meta.patent_count,
      concept_count: meta.concept_count,
      community_count: meta.community_count,
      year_range: [meta.year_min ?? 0, meta.year_max ?? 0],
    },
    analysis: {
      god_nodes: meta.god_nodes ?? [],
      surprising_connections: meta.surprising ?? [],
    },
    ai_report: meta.ai_report ?? '',
    generated_at: (meta.generated_at ?? new Date()).toISOString(),
    methodology: meta.methodology as GraphMethodology,
  }
}
