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
  options: { chunkSize?: number; onConflict?: string } = {},
): Promise<void> {
  if (rows.length === 0) return
  const chunkSize = options.chunkSize ?? 500
  const suffix = options.onConflict ? ` ${options.onConflict}` : ''
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
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}${suffix}`,
      params,
    )
  }
}

// ── Save ────────────────────────────────────────────────────────────────────

/**
 * Per-patent columns that have no home on `GraphNode`.
 *
 * `GraphNode` only carries the six fields the graph UI can filter on
 * (PRD v2 P0 §6.1: `ipc5` / `ipc_primary` / `ipc_depth` / `source_files` /
 * `cited_by_count` / `case_status`).  The remaining §6.2 patent columns are
 * stored for querying and export only, so they travel here — straight off the
 * `PatentRow` the parser produced — rather than bloating every graph payload.
 */
export interface PatentExtras {
  search_keyword?: string
  translated_abstract?: string
  patent_number?: string
  publication_number?: string
  publication_date?: string
  ipc5_raw?: string[]
  design_class?: string
  external_references?: string[]
}

export interface SaveContext {
  /** Extra per-patent fields not carried on GraphNode (keyed by patent node id). */
  patentExtras?: Map<string, PatentExtras>
  /** Cleaned applicant name → country, recovered from the raw spreadsheet cell. */
  applicantCountries?: Map<string, string>
  /**
   * Internal 參考文獻 links (§3.5), as `PatentRow.id` pairs — i.e. exactly
   * `ParseResult.citations`.  Optional because the value originates in the
   * browser-side parse and only reaches the server if the caller forwards it;
   * `saveGraph()`'s signature stays backwards compatible either way.
   */
  citations?: Array<{ from: string; to: string }>
  /** `ParseResult.warnings` — stored on `analyses.data_quality_warnings`. */
  dataQualityWarnings?: unknown
  /**
   * PRD v2 / P1: immutable copy of the synonym dictionary used by THIS analysis
   * (`analyses.synonym_snapshot`). Old analyses must not change when the global
   * dictionary is later edited — the snapshot is what froze them.
   */
  synonymSnapshot?: unknown
  /**
   * Every upload backing this analysis (§6.2 `analysis_uploads`).  Upstream
   * currently supplies a single upload; multi-file uploads are stage 3.
   */
  uploads?: Array<{ uploadId: string; originalName?: string | null }>
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
    // Only clear citations when this save actually carries a citation set;
    // otherwise a re-save that lacks the parser context would silently drop
    // links a previous save had already stored.
    if (context.citations) {
      await client.query('DELETE FROM citations WHERE analysis_id = $1', [analysisId])
    }

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
         data_quality_warnings = COALESCE($17, data_quality_warnings),
         synonym_snapshot = COALESCE($18, synonym_snapshot),
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
        context.dataQualityWarnings === undefined
          ? null
          : JSON.stringify(context.dataQualityWarnings),
        context.synonymSnapshot === undefined
          ? null
          : JSON.stringify(context.synonymSnapshot),
      ],
    )

    await insertRows(
      client,
      'applicants',
      [
        'analysis_id',
        'node_id',
        'name',
        'country',
        'org_type',
        'patent_count',
        'applicant_key',
        'color',
        'size',
      ],
      applicantNodes.map((node) => [
        analysisId,
        node.id,
        node.label,
        // Node labels are already cleaned, so the country can only come from
        // the raw cell; fall back to the label for legacy imports.
        context.applicantCountries?.get(node.label) ?? extractCountry(node.label),
        classifyOrgType(node.label),
        node.patent_count ?? 0,
        node.applicant_key ?? null,
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
        // --- PRD v2 P0 §6.2 additions -------------------------------------
        'patent_number',
        'publication_number',
        'publication_date',
        'ipc5',
        'ipc5_raw',
        'ipc_primary',
        'ipc_depth',
        'cited_by_count',
        'case_status',
        'design_class',
        'source_files',
        'external_references',
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
          // Absent values stay NULL rather than ''/0/{}, so loadGraph() can
          // hand back `undefined` and the UI never shows a 0 impostor (§6.1).
          extra?.patent_number ?? null,
          extra?.publication_number ?? null,
          extra?.publication_date ?? null,
          node.ipc5 ?? null,
          extra?.ipc5_raw ?? null,
          node.ipc_primary ?? null,
          node.ipc_depth ?? null,
          node.cited_by_count ?? null,
          node.case_status ?? null,
          extra?.design_class ?? null,
          node.source_files ?? null,
          extra?.external_references ?? null,
          node.color,
          node.size,
        ]
      }),
    )

    await insertRows(
      client,
      'concepts',
      [
        'analysis_id',
        'node_id',
        'label',
        'frequency',
        'community_id',
        // §6.2: previously written only to patent_concepts and never read back,
        // so a concept node's source_patents vanished on every reload.
        'source_patents',
        // --- PRD v2 / P3: concept time metadata (§2.3) ---
        'first_year',
        'last_year',
        'median_year',
        'year_counts',
        // --- PRD v2 / P4: applicant-unit metric ---
        'applicant_count',
        // PRD v2 / P4 Q2: 家單位社群
        'community_id_applicants',
        'color',
        'size',
      ],
      conceptNodes.map((node) => [
        analysisId,
        node.id,
        node.label,
        node.frequency ?? 0,
        node.community_id ?? null,
        node.source_patents ?? null,
        node.first_year ?? null,
        node.last_year ?? null,
        node.median_year ?? null,
        node.year_counts ? JSON.stringify(node.year_counts) : null,
        node.applicant_count ?? null,
        node.community_id_applicants ?? null,
        node.color,
        node.size,
      ]),
    )

    await insertRows(
      client,
      'communities',
      ['analysis_id', 'unit', 'community_id', 'name', 'color', 'node_count'],
      graph.communities.map((community) => [
        analysisId,
        community.unit ?? 'patent',
        community.id,
        community.name,
        community.color,
        community.node_count,
      ]),
    )

    // PRD v2 / P4 (Q2): 「家」單位社群分區共享治同表，unit 區隔（旧圖無）。
    if (graph.communities_applicants && graph.communities_applicants.length > 0) {
      await insertRows(
        client,
        'communities',
        ['analysis_id', 'unit', 'community_id', 'name', 'color', 'node_count'],
        graph.communities_applicants.map((community) => [
          analysisId,
          'applicant',
          community.id,
          community.name,
          community.color,
          community.node_count,
        ]),
      )
    }

    // PRD v2 / P4 (Q2): 概念→社群歸屬僅多單位各存一份；舊圖只有 patent 單位。
    const conceptCommunityRows: unknown[][] = []
    for (const node of conceptNodes) {
      if (node.community_id !== undefined && node.community_id !== null) {
        conceptCommunityRows.push([analysisId, node.label, 'patent', node.community_id])
      }
      if (node.community_id_applicants !== undefined && node.community_id_applicants !== null) {
        conceptCommunityRows.push([analysisId, node.label, 'applicant', node.community_id_applicants])
      }
    }
    if (conceptCommunityRows.length > 0) {
      await insertRows(
        client,
        'concept_communities',
        ['analysis_id', 'label', 'unit', 'community_id'],
        conceptCommunityRows,
        { onConflict: 'ON CONFLICT DO NOTHING' },
      )
    }

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
        // --- PRD v2 / P4 second slice: per-unit metrics ---
        'support_applicants',
        'jaccard_applicants',
        'npmi',
        'npmi_applicants',
        'association_strength',
        'association_strength_applicants',
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
        edge.support_applicants ?? null,
        edge.jaccard_applicants ?? null,
        edge.npmi ?? null,
        edge.npmi_applicants ?? null,
        edge.association_strength ?? null,
        edge.association_strength_applicants ?? null,
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

    // Internal 參考文獻 links (§3.5).  from/to are PatentRow.id values, so no
    // ordering dependency on the patents rows' surrogate keys.  De-duplicated
    // before insert because the composite primary key would otherwise reject
    // the whole chunk and roll back the transaction.
    if (context.citations?.length) {
      const seen = new Set<string>()
      const citationRows: unknown[][] = []
      for (const link of context.citations) {
        if (!link?.from || !link?.to) continue
        const key = `${link.from}\u0000${link.to}`
        if (seen.has(key)) continue
        seen.add(key)
        citationRows.push([analysisId, link.from, link.to])
      }
      await insertRows(client, 'citations', ['analysis_id', 'from_patent', 'to_patent'], citationRows, {
        onConflict: 'ON CONFLICT DO NOTHING',
      })
    }

    // §6.2 analysis_uploads.  Additive on purpose: re-saving a graph must not
    // unlink uploads recorded by an earlier save, and upstream currently only
    // ever supplies the single upload that analyses.upload_id already holds.
    if (context.uploads?.length) {
      await insertRows(
        client,
        'analysis_uploads',
        ['analysis_id', 'upload_id', 'original_name'],
        context.uploads
          .filter((upload) => Boolean(upload?.uploadId))
          .map((upload) => [analysisId, upload.uploadId, upload.originalName ?? null]),
        { onConflict: 'ON CONFLICT DO NOTHING' },
      )
    }
  })
}

// ── Load ────────────────────────────────────────────────────────────────────

interface ApplicantRow {
  node_id: string
  name: string
  patent_count: number
  applicant_key: string | null
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
  ipc5: string[] | null
  ipc_primary: string | null
  ipc_depth: number | null
  cited_by_count: number | null
  case_status: string | null
  source_files: string[] | null
  color: string | null
  size: number | null
}

interface ConceptRow {
  node_id: string
  label: string
  frequency: number
  community_id: number | null
  source_patents: string[] | null
  // PRD v2 / P3: concept time metadata columns.
  first_year: number | null
  last_year: number | null
  median_year: number | null
  year_counts: Record<string, number> | null
  // PRD v2 / P4: applicant-unit metric column.
  applicant_count: number | null
  // PRD v2 / P4 (Q2): 家單位社群（由 concept_communities 回填）。
  community_id_applicants: number | null
  color: string | null
  size: number | null
}

interface ConceptCommunityRow {
  label: string
  unit: string
  community_id: number
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
  // --- PRD v2 / P4 second slice: per-unit metrics ---
  support_applicants: number | null
  jaccard_applicants: number | null
  npmi: number | null
  npmi_applicants: number | null
  association_strength: number | null
  association_strength_applicants: number | null
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

  const [applicants, patents, concepts, communityRows, conceptCommunityRows, edgeRows] = await Promise.all([
    query<ApplicantRow>(
      `SELECT node_id, name, patent_count, applicant_key, color, size
       FROM applicants WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
    query<PatentRowDb>(
      `SELECT node_id, title, abstract, applicant_raw, application_number, filing_date, year,
              ipc5, ipc_primary, ipc_depth, cited_by_count, case_status, source_files, color, size
       FROM patents WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
    query<ConceptRow>(
      `SELECT node_id, label, frequency, community_id, source_patents, color, size,
              first_year, last_year, median_year, year_counts,
              applicant_count
       FROM concepts WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
    query<Community & { community_id: number; unit: string }>(
      `SELECT community_id, name, color, node_count, unit FROM communities
       WHERE analysis_id = $1 ORDER BY unit, community_id`,
      [analysisId],
    ),
    query<ConceptCommunityRow>(
      `SELECT label, unit, community_id FROM concept_communities
       WHERE analysis_id = $1`,
      [analysisId],
    ),
    query<EdgeRow>(
      `SELECT edge_id, kind, from_node, to_node, relation, weight, support_count, jaccard,
              support_applicants, jaccard_applicants, npmi, npmi_applicants,
              association_strength, association_strength_applicants,
              reason, confidence, source_patent, source_patents, evidence
       FROM edges WHERE analysis_id = $1 ORDER BY id`,
      [analysisId],
    ),
  ])

  // PRD v2 / P4 (Q2): 「家」單位社群歸屬（concept_communities）回填到概念節點。
  const applicantCommunitiesByLabel = new Map<string, number>()
  for (const row of conceptCommunityRows) {
    if (row.unit === 'applicant') applicantCommunitiesByLabel.set(row.label, row.community_id)
  }

  const nodes: GraphNode[] = [
    ...applicants.map((row): GraphNode => ({
      id: row.node_id,
      type: 'applicant',
      label: row.name,
      patent_count: row.patent_count,
      applicant_key: row.applicant_key ?? undefined,
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
      // NULL → undefined, never 0 / '' / [] (§6.1 compatibility rule).
      ipc5: row.ipc5 ?? undefined,
      ipc_primary: row.ipc_primary ?? undefined,
      ipc_depth: row.ipc_depth ?? undefined,
      cited_by_count: row.cited_by_count ?? undefined,
      case_status: row.case_status ?? undefined,
      source_files: row.source_files ?? undefined,
      color: row.color ?? '#94A3B8',
      size: row.size ?? 18,
    })),
    ...concepts.map((row): GraphNode => ({
      id: row.node_id,
      type: 'concept',
      label: row.label,
      frequency: row.frequency,
      community_id: row.community_id ?? undefined,
      source_patents: row.source_patents ?? undefined,
      // --- PRD v2 / P3: DB null -> TS undefined; year_counts keys are strings. ---
      first_year: row.first_year ?? undefined,
      last_year: row.last_year ?? undefined,
      median_year: row.median_year ?? undefined,
      year_counts: row.year_counts ?? undefined,
      // --- PRD v2 / P4 ---
      applicant_count: row.applicant_count ?? undefined,
      community_id_applicants: applicantCommunitiesByLabel.get(row.label) ?? undefined,
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
    // --- PRD v2 / P4 second slice: per-unit metrics ---
    if (row.support_applicants !== null) edge.support_applicants = row.support_applicants
    if (row.jaccard_applicants !== null) edge.jaccard_applicants = row.jaccard_applicants
    if (row.npmi !== null) edge.npmi = row.npmi
    if (row.npmi_applicants !== null) edge.npmi_applicants = row.npmi_applicants
    if (row.association_strength !== null) edge.association_strength = row.association_strength
    if (row.association_strength_applicants !== null) {
      edge.association_strength_applicants = row.association_strength_applicants
    }
    if (row.reason !== null) edge.reason = row.reason
    if (row.confidence !== null) edge.confidence = row.confidence
    if (row.source_patent !== null) edge.source_patent = row.source_patent
    if (row.source_patents !== null) edge.source_patents = row.source_patents
    if (row.evidence !== null) edge.evidence = row.evidence
    return edge
  })

  const communities: Community[] = communityRows
    .filter((row) => row.unit !== 'applicant')
    .map((row) => ({
      id: row.community_id,
      name: row.name,
      color: row.color,
      node_count: row.node_count,
    }))

  // PRD v2 / P4 (Q2): 「家」單位社群分區；舊圖（migration 006 前）沒有。
  const communitiesApplicants: Community[] = communityRows
    .filter((row) => row.unit === 'applicant')
    .map((row) => ({
      id: row.community_id,
      name: row.name,
      color: row.color,
      node_count: row.node_count,
      unit: 'applicant' as const,
    }))

  return {
    // Report the version actually stored, not a hardcoded 2 — otherwise a v3
    // graph read back from the database claims to be v2 and normalizeGraphData()
    // is told the wrong thing about what the payload already contains.
    schema_version: meta.schema_version === 3 ? 3 : 2,
    nodes,
    edges,
    communities,
    communities_applicants: communitiesApplicants,
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
