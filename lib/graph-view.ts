import { applicantSize, conceptSize, PATENT_NODE_SIZE } from './concept-network'
import type {
  Community,
  GraphData,
  GraphEdge,
  GraphMode,
  GraphNode,
} from '../types/graph'

export interface GraphViewOptions {
  mode: GraphMode
  showSemantic: boolean
  minSupport: number
  yearRange: [number, number]
}

export interface GraphViewData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: Community[]
  stats: GraphData['stats']
  maxSupport: number
  capabilityWarning?: string
}

function viewStats(
  nodes: GraphNode[],
  communities: Community[],
  yearRange: [number, number],
): GraphData['stats'] {
  return {
    applicant_count: nodes.filter((node) => node.type === 'applicant').length,
    patent_count: nodes.filter((node) => node.type === 'patent').length,
    concept_count: nodes.filter((node) => node.type === 'concept').length,
    community_count: communities.length,
    year_range: yearRange,
  }
}

function capabilityWarning(graph: GraphData): string | undefined {
  const warnings: string[] = []
  if (graph.methodology.cooccurrence_data === 'unavailable') {
    warnings.push('舊資料缺少可重建的專利—概念成員關係，無法產生共現統計。')
  } else if (graph.methodology.cooccurrence_data === 'reconstructed') {
    warnings.push('共現統計由舊資料保存的專利—概念成員關係重建；正式分析建議使用新版重新產生。')
  }
  if (graph.methodology.semantic_provenance === 'partial') {
    warnings.push('舊資料只保留部分 LLM 關係來源；目前顯示的是可觀測來源，不代表完整支持篇數。')
  }
  return warnings.length > 0 ? warnings.join(' ') : undefined
}

function selectConceptView(graph: GraphData, options: GraphViewOptions): GraphViewData {
  const nodes = graph.nodes.filter((node) => node.type === 'concept')
  const nodeIds = new Set(nodes.map((node) => node.id))
  const cooccurrence = graph.edges.filter(
    (edge) => edge.kind === 'cooccurrence' && (edge.support_count ?? 0) >= options.minSupport,
  )
  const semantic = options.showSemantic
    ? graph.edges.filter((edge) => edge.kind === 'semantic')
    : []
  const edges = [...cooccurrence, ...semantic].filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  )
  const activeCommunityIds = new Set(
    nodes
      .map((node) => node.community_id)
      .filter((id): id is number => typeof id === 'number'),
  )
  const communities = graph.communities.filter((community) => activeCommunityIds.has(community.id))
  const maxSupport = Math.max(
    1,
    ...graph.edges
      .filter((edge) => edge.kind === 'cooccurrence')
      .map((edge) => edge.support_count ?? 1),
  )
  return {
    nodes,
    edges,
    communities,
    stats: {
      ...graph.stats,
      concept_count: nodes.length,
      community_count: communities.length,
    },
    maxSupport,
    capabilityWarning: capabilityWarning(graph),
  }
}

function selectContextView(graph: GraphData, options: GraphViewOptions): GraphViewData {
  const [yearStart, yearEnd] = options.yearRange
  const isFullRange =
    yearStart === graph.stats.year_range[0] && yearEnd === graph.stats.year_range[1]
  const visiblePatents = graph.nodes.filter(
    (node) =>
      node.type === 'patent' &&
      (typeof node.year === 'number'
        ? node.year >= yearStart && node.year <= yearEnd
        : isFullRange),
  )
  const visiblePatentIds = new Set(visiblePatents.map((node) => node.id))
  const structuralEdges = graph.edges.filter((edge) => {
    if (edge.kind !== 'structural') return false
    return visiblePatentIds.has(edge.from) || visiblePatentIds.has(edge.to)
  })
  const includedIds = new Set(visiblePatentIds)
  for (const edge of structuralEdges) {
    includedIds.add(edge.from)
    includedIds.add(edge.to)
  }

  const patentIdsByApplicant = new Map<string, Set<string>>()
  const patentIdsByConcept = new Map<string, Set<string>>()
  for (const edge of structuralEdges) {
    if (edge.relation === '申請了' && visiblePatentIds.has(edge.to)) {
      const patents = patentIdsByApplicant.get(edge.from) ?? new Set<string>()
      patents.add(edge.to)
      patentIdsByApplicant.set(edge.from, patents)
    }
    if (edge.relation === '包含' && visiblePatentIds.has(edge.from)) {
      const patents = patentIdsByConcept.get(edge.to) ?? new Set<string>()
      patents.add(edge.from)
      patentIdsByConcept.set(edge.to, patents)
    }
  }

  const nodes = graph.nodes
    .filter((node) => includedIds.has(node.id))
    .map((node): GraphNode => {
      if (node.type === 'applicant') {
        const patentCount = patentIdsByApplicant.get(node.id)?.size ?? 0
        return { ...node, patent_count: patentCount, size: applicantSize(patentCount) }
      }
      if (node.type === 'concept') {
        const patents = Array.from(patentIdsByConcept.get(node.id) ?? []).sort()
        return {
          ...node,
          frequency: patents.length,
          source_patents: patents.map((id) => id.replace(/^patent:/, '')),
          size: conceptSize(patents.length),
        }
      }
      return { ...node, size: PATENT_NODE_SIZE }
    })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = structuralEdges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  )
  const activeCommunityIds = new Set(
    nodes
      .filter((node) => node.type === 'concept')
      .map((node) => node.community_id)
      .filter((id): id is number => typeof id === 'number'),
  )
  const communities = graph.communities
    .filter((community) => activeCommunityIds.has(community.id))
    .map((community) => ({
      ...community,
      node_count: nodes.filter(
        (node) => node.type === 'concept' && node.community_id === community.id,
      ).length,
    }))

  return {
    nodes,
    edges,
    communities,
    stats: viewStats(nodes, communities, options.yearRange),
    maxSupport: 1,
    capabilityWarning: capabilityWarning(graph),
  }
}

export function selectGraphView(graph: GraphData, options: GraphViewOptions): GraphViewData {
  return options.mode === 'concept'
    ? selectConceptView(graph, options)
    : selectContextView(graph, options)
}
