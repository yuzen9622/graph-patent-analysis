import { buildConceptNetwork, applicantSize, conceptSize, PATENT_NODE_SIZE } from './concept-network'
import { detectCommunities } from './community'
import { computeGodNodes, computeSurprisingConnections } from './graph-analysis'
import type {
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
  }
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
  return {
    schema_version: 2,
    nodes,
    edges,
    communities,
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
    schema_version: 2,
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
  return input.schema_version === 2
    ? normalizeV2(input, nodes, edges)
    : normalizeLegacy(input, nodes, edges)
}
