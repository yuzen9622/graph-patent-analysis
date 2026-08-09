import { buildConceptNetwork, applicantSize, conceptSize, PATENT_NODE_SIZE } from './concept-network'
import { detectCommunities } from './community'
import { computeGodNodes, computeSurprisingConnections } from './graph-analysis'
import type {
  CitationEdge,
  Community,
  ExtractionResult,
  GraphData,
  GraphEdge,
  GraphEdgeKind,
  GraphMethodology,
  GraphNode,
  NodeType,
  RelationConfidence,
} from '../types/graph'

const NODE_TYPES = new Set<NodeType>(['applicant', 'patent', 'concept'])
const EDGE_KINDS = new Set<GraphEdgeKind>(['structural', 'cooccurrence', 'semantic'])
const CONFIDENCES = new Set<RelationConfidence>(['EXTRACTED', 'INFERRED', 'AMBIGUOUS'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Integer-only number (PRD v2 / P3: years). Anything else is undefined. */
function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)
    ? value
    : undefined
}

/** {year: finite number} map, or undefined if absent / not a plain object. */
function asYearCounts(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, v] of Object.entries(value)) {
    const n = asFiniteNumber(v)
    if (n === undefined) return undefined
    out[key] = n
  }
  return out
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string'))).sort()
}

function normalizeNode(value: unknown): GraphNode | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const label = asString(value.label)
  const type = value.type as NodeType
  if (!id || !label || !NODE_TYPES.has(type)) return null
  return {
    ...(value as unknown as GraphNode),
    id,
    label,
    type,
    color: typeof value.color === 'string' ? value.color : '#BAB0AC',
    size: asFiniteNumber(value.size) ?? (type === 'patent' ? PATENT_NODE_SIZE : 18),
    source_patents: asStringArray(value.source_patents),
    // PRD v2 / P3: the four concept-time fields are validated, not spread
    // through unchecked — a string / null / 1e309 first_year would compute a
    // NaN colour, violating the no-NaN guard (§B7). Invalid -> undefined.
    first_year: asNonNegativeInteger(value.first_year),
    q1_year: asNonNegativeInteger(value.q1_year),
    // P6 true median / LOO values may be half-years, not only integers.
    median_year: asFiniteNumber(value.median_year),
    q3_year: asNonNegativeInteger(value.q3_year),
    last_year: asNonNegativeInteger(value.last_year),
    median_loo_min: asFiniteNumber(value.median_loo_min),
    median_loo_max: asFiniteNumber(value.median_loo_max),
    scope_id: typeof value.scope_id === 'string' ? value.scope_id : undefined,
    temporal_legacy_unverified:
      typeof value.median_year === 'number' &&
      (!Number.isInteger(value.q1_year) || !Number.isInteger(value.q3_year))
        ? true
        : undefined,
    year_counts: asYearCounts(value.year_counts),
  }
}

function inferEdgeKind(edge: Record<string, unknown>): GraphEdgeKind {
  if (EDGE_KINDS.has(edge.kind as GraphEdgeKind)) return edge.kind as GraphEdgeKind
  const from = asString(edge.from)
  const to = asString(edge.to)
  if (!from.startsWith('concept:') || !to.startsWith('concept:')) return 'structural'
  return asString(edge.relation) === '共同出現' && asFiniteNumber(edge.support_count)
    ? 'cooccurrence'
    : 'semantic'
}

function normalizeEdge(value: unknown, validNodes: Set<string>): GraphEdge | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const from = asString(value.from)
  const to = asString(value.to)
  const relation = asString(value.relation)
  if (!id || !from || !to || !relation || !validNodes.has(from) || !validNodes.has(to)) {
    return null
  }
  const confidence = CONFIDENCES.has(value.confidence as RelationConfidence)
    ? (value.confidence as RelationConfidence)
    : undefined
  return {
    ...(value as unknown as GraphEdge),
    id,
    from,
    to,
    relation,
    kind: inferEdgeKind(value),
    confidence,
    support_count: asFiniteNumber(value.support_count),
    jaccard: asFiniteNumber(value.jaccard),
    temporal_directed: typeof value.temporal_directed === 'boolean' ? value.temporal_directed : undefined,
    opacity: asFiniteNumber(value.opacity),
    citation_supported: typeof value.citation_supported === 'boolean' ? value.citation_supported : undefined,
    citation_direction_conflict: typeof value.citation_direction_conflict === 'boolean' ? value.citation_direction_conflict : undefined,
    scope_id: typeof value.scope_id === 'string' ? value.scope_id : undefined,
    source_patents: asStringArray(value.source_patents),
    evidence: Array.isArray(value.evidence)
      ? value.evidence
          .filter(isRecord)
          .map((item) => ({
            patent_id: asString(item.patent_id),
            weight: asFiniteNumber(item.weight),
            reason: typeof item.reason === 'string' ? item.reason : undefined,
            confidence: CONFIDENCES.has(item.confidence as RelationConfidence)
              ? (item.confidence as RelationConfidence)
              : undefined,
          }))
          .filter((item) => item.patent_id)
      : undefined,
  }
}

function methodologyDefaults(
  capability: Pick<GraphMethodology, 'cooccurrence_data' | 'semantic_provenance'>,
): GraphMethodology {
  return {
    concept_frequency_metric: 'unique_patent_count',
    cooccurrence_metric: 'unique_patent_support',
    concept_size_formula: 'clamp(10 + 6 * sqrt(frequency), 10, 52)',
    applicant_size_formula: 'clamp(18 + 5 * sqrt(patent_count), 18, 52)',
    patent_size: PATENT_NODE_SIZE,
    community_algorithm: 'louvain',
    community_edge_weight: 'support_count',
    community_resolution: 1,
    community_random_walk: false,
    layout_distance_interpretation: 'visual_only',
    prompt_version: 'legacy-unknown',
    model_provider: 'unknown',
    model_id: 'unknown',
    ...capability,
  }
}

function normalizeMethodology(
  value: unknown,
  defaults: GraphMethodology,
): GraphMethodology {
  const raw = isRecord(value) ? value : {}
  const cooccurrenceData = raw.cooccurrence_data
  const semanticProvenance = raw.semantic_provenance
  return {
    concept_frequency_metric: raw.concept_frequency_metric === 'unique_patent_count'
      ? 'unique_patent_count'
      : defaults.concept_frequency_metric,
    cooccurrence_metric: raw.cooccurrence_metric === 'unique_patent_support'
      ? 'unique_patent_support'
      : defaults.cooccurrence_metric,
    concept_size_formula: asString(raw.concept_size_formula, defaults.concept_size_formula),
    applicant_size_formula: asString(raw.applicant_size_formula, defaults.applicant_size_formula),
    patent_size: asFiniteNumber(raw.patent_size) ?? defaults.patent_size,
    community_algorithm: raw.community_algorithm === 'louvain'
      ? 'louvain'
      : defaults.community_algorithm,
    community_edge_weight: raw.community_edge_weight === 'support_count'
      ? 'support_count'
      : defaults.community_edge_weight,
    community_resolution:
      asFiniteNumber(raw.community_resolution) ?? defaults.community_resolution,
    community_random_walk: typeof raw.community_random_walk === 'boolean'
      ? raw.community_random_walk
      : defaults.community_random_walk,
    layout_distance_interpretation: raw.layout_distance_interpretation === 'visual_only'
      ? 'visual_only'
      : defaults.layout_distance_interpretation,
    prompt_version: asString(raw.prompt_version, defaults.prompt_version),
    model_provider: asString(raw.model_provider, defaults.model_provider),
    model_id: asString(raw.model_id, defaults.model_id),
    cooccurrence_data:
      cooccurrenceData === 'native' ||
      cooccurrenceData === 'reconstructed' ||
      cooccurrenceData === 'unavailable'
        ? cooccurrenceData
        : defaults.cooccurrence_data,
    semantic_provenance:
      semanticProvenance === 'complete' ||
      semanticProvenance === 'partial' ||
      semanticProvenance === 'unavailable'
        ? semanticProvenance
        : defaults.semantic_provenance,
    // PRD v2 / P3: two methodology fields must survive normalisation or the
    // admin/import path would permanently drop them (B6). A present-but-invalid
    // time_window becomes null; an ABSENT field stays omitted (undefined), never
    // a faked default — the methodology-level "0 impostor" guard.
    ...normalizeTimeMethodology(raw),
    ...normalizeTemporalMethodology(raw),
  }
}

function normalizeTimeMethodology(
  raw: Record<string, unknown>,
): Pick<GraphMethodology, 'time_window' | 'time_color_scale'> {
  const out: Pick<GraphMethodology, 'time_window' | 'time_color_scale'> = {}
  const tw = raw.time_window
  if (
    Array.isArray(tw) &&
    tw.length === 2 &&
    typeof tw[0] === 'number' &&
    typeof tw[1] === 'number' &&
    Number.isInteger(tw[0]) &&
    Number.isInteger(tw[1])
  ) {
    out.time_window = [tw[0], tw[1]]
  } else if (tw === null || tw !== undefined) {
    // Present but invalid, or explicitly null -> "window unknown".
    out.time_window = null
  }
  if (raw.time_color_scale === 'sequential_blue') {
    out.time_color_scale = 'sequential_blue'
  }
  return out
}

function normalizeTemporalMethodology(raw: Record<string, unknown>): Partial<GraphMethodology> {
  const out: Partial<GraphMethodology> = {}
  if (raw.temporal_median_method === 'standard_median') out.temporal_median_method = 'standard_median'
  if (raw.temporal_quartile_method === 'nearest_rank') out.temporal_quartile_method = 'nearest_rank'
  if (raw.support_strength_visual === '0.30 + 0.70 * (1 - exp(-support/5))') out.support_strength_visual = raw.support_strength_visual
  const tau = asFiniteNumber(raw.support_strength_tau)
  if (tau !== undefined) out.support_strength_tau = tau
  if (raw.time_axis === 'ordinal_rank') out.time_axis = 'ordinal_rank'
  if (raw.layout_time_band === 'ordinal_rank') out.layout_time_band = 'ordinal_rank'
  if (raw.citation_threshold === 'net>=2 && ratio>=2') out.citation_threshold = raw.citation_threshold
  for (const key of ['quality_year_bounds', 'analysis_year_filter'] as const) {
    const value = raw[key]
    if (Array.isArray(value) && value.length === 2 && value.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      out[key] = [value[0]!, value[1]!]
    }
  }
  return out
}

function normalizeCitationEdges(value: unknown, validNodes: Set<string>): CitationEdge[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter(isRecord).flatMap((item) => {
    const id = asString(item.id)
    const from = asString(item.from)
    const to = asString(item.to)
    const forward = asNonNegativeInteger(item.forward_count)
    const reverse = asNonNegativeInteger(item.reverse_count)
    if (!id || !from || !to || !validNodes.has(from) || !validNodes.has(to) || forward === undefined || reverse === undefined || typeof item.supported !== 'boolean' || typeof item.direction_conflict !== 'boolean') return []
    return [{ id, from, to, forward_count: forward, reverse_count: reverse, supported: item.supported, direction_conflict: item.direction_conflict, scope_id: typeof item.scope_id === 'string' ? item.scope_id : undefined }]
  })
}

/**
 * Resolve the schema version to echo back on the normalised output.
 *
 * Pass-through semantics (PRD v2 P0 §6.3 #6): a v2 graph normalises to a v2
 * graph and a v3 graph normalises to a v3 graph — normalisation repairs the
 * payload, it never re-labels which schema produced it.  Anything that is
 * neither (pre-v2 files carry no `schema_version` at all) is *upgraded* to 2,
 * because `normalizeLegacy()` genuinely rebuilds it into the v2 shape.
 */
function resolveSchemaVersion(input: Record<string, unknown>): 2 | 3 | 4 {
  return input.schema_version === 4 ? 4 : input.schema_version === 3 ? 3 : 2
}

function computeStats(nodes: GraphNode[], communities: Community[]): GraphData['stats'] {
  const years = nodes
    .filter((node) => node.type === 'patent' && typeof node.year === 'number')
    .map((node) => node.year as number)
  const currentYear = new Date().getFullYear()
  return {
    applicant_count: nodes.filter((node) => node.type === 'applicant').length,
    patent_count: nodes.filter((node) => node.type === 'patent').length,
    concept_count: nodes.filter((node) => node.type === 'concept').length,
    community_count: communities.length,
    year_range: years.length > 0
      ? [Math.min(...years), Math.max(...years)]
      : [currentYear, currentYear],
  }
}

function normalizeV2(raw: Record<string, unknown>, nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  const communities = Array.isArray(raw.communities)
    ? (raw.communities.filter(isRecord).map((item) => ({
        id: asFiniteNumber(item.id) ?? 0,
        name: asString(item.name, '未命名社群'),
        color: asString(item.color, '#BAB0AC'),
        node_count: asFiniteNumber(item.node_count) ?? 0,
      })) as Community[])
    : []
  const defaults = methodologyDefaults({
    cooccurrence_data: 'native',
    semantic_provenance: 'complete',
  })
  const methodology = normalizeMethodology(raw.methodology, defaults)
  const validNodes = new Set(nodes.map((node) => node.id))
  return {
    schema_version: resolveSchemaVersion(raw),
    nodes,
    edges,
    communities,
    citation_edges: normalizeCitationEdges(raw.citation_edges, validNodes),
    patent_citations: Array.isArray(raw.patent_citations)
      ? raw.patent_citations.filter(isRecord).flatMap((item) => {
          const from = asString(item.from)
          const to = asString(item.to)
          return from && to ? [{ from, to }] : []
        })
      : undefined,
    scope_id: typeof raw.scope_id === 'string' ? raw.scope_id : undefined,
    warnings: isRecord(raw.warnings) ? raw.warnings as GraphData['warnings'] : undefined,
    stats: computeStats(nodes, communities),
    analysis: isRecord(raw.analysis) ? (raw.analysis as unknown as GraphData['analysis']) : undefined,
    ai_report: asString(raw.ai_report),
    generated_at: asString(raw.generated_at, new Date().toISOString()),
    methodology,
  }
}

function normalizeLegacy(raw: Record<string, unknown>, nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  const structuralEdges = edges.filter((edge) => edge.kind === 'structural')
  const legacySemanticEdges = edges
    .filter((edge) => edge.kind === 'semantic')
    .map((edge): GraphEdge => {
      const observedSources = Array.from(
        new Set([
          ...(edge.source_patents ?? []),
          ...(edge.source_patent ? [edge.source_patent] : []),
        ]),
      ).sort()
      return {
        ...edge,
        kind: 'semantic',
        support_count: undefined,
        source_patents: observedSources,
        evidence: observedSources.map((patentId) => ({
          patent_id: patentId,
          weight: edge.weight,
          reason: edge.reason,
          confidence: edge.confidence,
        })),
      }
    })

  const labelsById = new Map(nodes.map((node) => [node.id, node]))
  const conceptsByPatent = new Map<string, Set<string>>()
  for (const edge of structuralEdges) {
    const fromNode = labelsById.get(edge.from)
    const toNode = labelsById.get(edge.to)
    if (fromNode?.type !== 'patent' || toNode?.type !== 'concept' || edge.relation !== '包含') continue
    const labels = conceptsByPatent.get(fromNode.id) ?? new Set<string>()
    labels.add(toNode.label)
    conceptsByPatent.set(fromNode.id, labels)
  }

  const extractions: ExtractionResult[] = Array.from(conceptsByPatent.entries()).map(
    ([patentNodeId, keywords]) => ({
      patent_id: patentNodeId.replace(/^patent:/, ''),
      translated_abstract: '',
      keywords: Array.from(keywords),
      relations: [],
    }),
  )
  const conceptNetwork = buildConceptNetwork(extractions)
  const canReconstruct = conceptNetwork.concepts.size > 0
  const communityResult = detectCommunities(conceptNetwork)

  for (const node of nodes) {
    if (node.type === 'concept') {
      const aggregate = conceptNetwork.concepts.get(node.label)
      node.frequency = aggregate?.frequency ?? 0
      node.source_patents = aggregate?.source_patents ?? []
      node.size = conceptSize(node.frequency)
      node.community_id = communityResult.assignments.get(node.label) ?? node.community_id ?? 0
      node.color = communityResult.colors.get(node.community_id) ?? node.color
    }
    if (node.type === 'applicant') {
      const patents = new Set(
        structuralEdges
          .filter((edge) => edge.from === node.id && labelsById.get(edge.to)?.type === 'patent')
          .map((edge) => edge.to),
      )
      node.patent_count = patents.size
      node.size = applicantSize(patents.size)
    }
    if (node.type === 'patent') node.size = PATENT_NODE_SIZE
  }

  const communityCounts = new Map<number, number>()
  for (const node of nodes.filter((item) => item.type === 'concept')) {
    const communityId = node.community_id ?? 0
    communityCounts.set(communityId, (communityCounts.get(communityId) ?? 0) + 1)
  }
  const communities: Community[] = Array.from(communityCounts.keys())
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      name: communityResult.names.get(id) ?? `社群 ${id}`,
      color: communityResult.colors.get(id) ?? '#BAB0AC',
      node_count: communityCounts.get(id) ?? 0,
    }))

  const allEdges = [
    ...structuralEdges,
    ...conceptNetwork.cooccurrenceEdges,
    ...legacySemanticEdges,
  ]
  const conceptNodes = nodes.filter((node) => node.type === 'concept')
  const analysis = {
    god_nodes: computeGodNodes(conceptNodes, conceptNetwork.cooccurrenceEdges),
    surprising_connections: computeSurprisingConnections(
      conceptNetwork.cooccurrenceEdges,
      conceptNodes,
    ),
  }

  return {
    schema_version: resolveSchemaVersion(raw),
    nodes,
    edges: allEdges,
    communities,
    stats: computeStats(nodes, communities),
    analysis,
    ai_report: asString(raw.ai_report),
    generated_at: asString(raw.generated_at, new Date().toISOString()),
    methodology: methodologyDefaults({
      cooccurrence_data: canReconstruct ? 'reconstructed' : 'unavailable',
      semantic_provenance: legacySemanticEdges.length > 0 ? 'partial' : 'unavailable',
    }),
  }
}

export function normalizeGraphData(input: unknown): GraphData | null {
  if (!isRecord(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return null
  const nodes = input.nodes.map(normalizeNode).filter((node): node is GraphNode => node !== null)
  const validNodes = new Set(nodes.map((node) => node.id))
  const edges = input.edges
    .map((edge) => normalizeEdge(edge, validNodes))
    .filter((edge): edge is GraphEdge => edge !== null)
  // Dispatch on the *declared* schema version, allow-listing every version that
  // already stores its own concept network.  This must stay an explicit
  // `2 | 3 | 4` allow-list rather than `=== 2 ? v2 : legacy` (PRD v2 P0 §6.3 #5):
  // under the old form a v3 graph fell through to `normalizeLegacy()`, which
  // rebuilds the concept network from scratch — discarding every cooccurrence
  // edge and overwriting `frequency` / `community_id` / `color` / `methodology`
  // with recomputed v1.2 defaults.  `saveGraph()` then DELETEs the stored rows
  // before writing that mangled version back, so the loss is unrecoverable.
  // Only genuinely pre-v2 payloads (no `schema_version`) may take the legacy
  // reconstruction path.
  const declared = input.schema_version
  if (declared === 2 || declared === 3 || declared === 4) return normalizeV2(input, nodes, edges)
  return normalizeLegacy(input, nodes, edges)
}
