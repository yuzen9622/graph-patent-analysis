import { applicantSize, conceptSize, PATENT_NODE_SIZE, stableEdgeId } from './concept-network'
import { gradientColor } from './concept-time'
import { classifyOrgType } from './applicant-classify'
import type {
  Community,
  GraphData,
  GraphEdge,
  GraphMode,
  GraphNode,
} from '../types/graph'

export type ColorMode = 'community' | 'first_year'

/** PRD v2 / P4: 分析單位 —— 篇（patent）／家（institution）。 */
export type Unit = 'patent' | 'applicant'

export interface GraphViewOptions {
  mode: GraphMode
  showSemantic: boolean
  minSupport: number
  yearRange: [number, number]
  /** PRD v2 / P3: concept-node colouring. `community` = default. */
  colorMode?: ColorMode
}

/**
 * PRD v2 / P4: coarse institution-type for the 機構節點圖. Splits 大學 out
 * of the generic 學研 class so the 「銀行 × 大學」story stays visible.
 */
export type InstitutionType =
  | '銀行'
  | '金控'
  | '保險'
  | '大學'
  | '證券投承'
  | '支付金流'
  | '科技'
  | '學研'
  | '個人'
  | '其他'

export const INSTITUTION_TYPE_COLORS: Record<InstitutionType, string> = {
  銀行: '#1d6fd1',
  金控: '#12385c',
  保險: '#d97706',
  大學: '#7c3aed',
  證券投承: '#0f7662',
  支付金流: '#15803d',
  科技: '#475569',
  學研: '#8b5cf6',
  個人: '#d1d5db',
  其他: '#94a3b8',
}

/** Unit-testable classifier for the institution view bucket colouring. */
export function institutionTypeOf(applName: string): InstitutionType {
  const n = applName.trim()
  // 大學優先於泛泛學研，直接服務「銀行 × 大學一起做」這個研究問題。
  if (/大學|科技大學|技術學院|University/i.test(n)) return '大學'
  const raw = classifyOrgType(n)
  if (raw === '銀行') return '銀行'
  if (raw === '金控') return '金控'
  if (raw === '保險') return '保險'
  if (raw === '證券投信') return '證券投承'
  if (raw === '支付金流') return '支付金流'
  if (raw === '科技資訊') return '科技'
  if (raw === '個人') return '個人'
  return '學研'
}

function institutionColor(applName: string): string {
  return INSTITUTION_TYPE_COLORS[institutionTypeOf(applName)]
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
  let nodes = graph.nodes.filter((node) => node.type === 'concept')
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
  if (options.colorMode === 'first_year') {
    nodes = applyTimeColour(nodes, graph.methodology?.time_window)
  }
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

/** [min, max] of concept first-years on the given (concept) nodes, or null. */
function timeWindowOf(nodes: GraphNode[]): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const node of nodes) {
    if (node.type !== 'concept' || node.first_year === undefined) continue
    if (node.first_year < min) min = node.first_year
    if (node.first_year > max) max = node.first_year
  }
  return Number.isFinite(min) ? [min, max] : null
}

/**
 * PRD v2 / P3: pure view-layer recolour — never mutates graph nodes, never
 * touches DB. `storedWindow` is the persisted methodology.time_window; fall
 * back to deriving it from the nodes (old graphs without the stored field).
 */
function applyTimeColour(
  nodes: GraphNode[],
  storedWindow?: [number, number] | null,
): GraphNode[] {
  const window = storedWindow ?? timeWindowOf(nodes)
  return nodes.map((node) =>
    node.type === 'concept'
      ? { ...node, color: gradientColor(node.first_year, window) }
      : node,
  )
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

/**
 * PRD v2 / P4: 機構節點圖 —— nodes are 機構（institution）, edges = concepts two
 * institutions share. 障接「某銀行＋某大學一起做哪些技術」的問題：點開邊看共享概念清單。
 * Reconstructed purely from the structural edges (申請／包含), so it works
 * identically for freshly-built and reloaded graphs — no extra DB columns.
 */
function selectInstitutionView(graph: GraphData, options: GraphViewOptions): GraphViewData {
  const appPatents = new Map<string, Set<string>>()
  const patentConcepts = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'structural') continue
    if (edge.relation === '申請了') {
      const s = appPatents.get(edge.from) ?? new Set()
      s.add(edge.to)
      appPatents.set(edge.from, s)
    } else if (edge.relation === '包含') {
      const s = patentConcepts.get(edge.from) ?? new Set()
      s.add(edge.to)
      patentConcepts.set(edge.from, s)
    }
  }

  const appConcepts = new Map<string, Set<string>>()
  const conceptApplicants = new Map<string, Set<string>>()
  for (const [appId, patents] of appPatents) {
    const cs = new Set<string>()
    for (const p of patents) {
      const pc = patentConcepts.get(p)
      if (pc) for (const c of pc) cs.add(c)
    }
    if (cs.size === 0) continue
    appConcepts.set(appId, cs)
    for (const c of cs) {
      const s = conceptApplicants.get(c) ?? new Set()
      s.add(appId)
      conceptApplicants.set(c, s)
    }
  }

  // Pairwise shared-concept count, via the concept→holders index (so we don't
  // enumerate every applicant pair).
  const pairConcepts = new Map<string, Set<string>>()
  for (const [conceptId, holders] of conceptApplicants) {
    const arr = Array.from(holders)
    if (arr.length < 2) continue
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        if (arr[i] === arr[j]) continue
        const key = arr[i] < arr[j] ? `${arr[i]}\u0000${arr[j]}` : `${arr[j]}\u0000${arr[i]}`
        const s = pairConcepts.get(key) ?? new Set()
        s.add(conceptId)
        pairConcepts.set(key, s)
      }
    }
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const nodes: GraphNode[] = []
  for (const [appId, cs] of appConcepts) {
    const base = byId.get(appId)
    if (!base) continue
    nodes.push({
      ...base,
      type: 'applicant',
      concept_count: cs.size,
      org_type: institutionTypeOf(base.label),
      size: Math.min(52, 18 + 5 * Math.sqrt(cs.size)),
      color: institutionColor(base.label),
    })
  }

  const edges: GraphEdge[] = []
  for (const [key, sharedIds] of pairConcepts) {
    const [a, b] = key.split('\u0000')
    const shared = Array.from(sharedIds).map((c) => c.replace(/^concept:/, ''))
    edges.push({
      id: stableEdgeId('institution', [a, b]),
      from: a,
      to: b,
      relation: '共享概念',
      kind: 'institution',
      support_count: shared.length,
      weight: shared.length,
      shared_concepts: shared,
    })
  }
  const maxSupport = Math.max(1, ...edges.map((e) => e.support_count ?? 1))
  const activeEdges = edges.filter((e) => (e.support_count ?? 0) >= options.minSupport)

  const typeCounts = new Map<string, number>()
  for (const node of nodes) {
    const t = node.org_type ?? '其他'
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  }
  const communities: Community[] = Array.from(typeCounts.entries()).map(
    ([name, node_count]) => ({
      id: -1,
      name,
      color: INSTITUTION_TYPE_COLORS[name as InstitutionType] ?? '#94a3b8',
      node_count,
    }),
  )

  const connected = new Set(activeEdges.flatMap((e) => [e.from, e.to]))
  const activeNodes = nodes.filter((n) => connected.has(n.id))
  const patents = new Set<string>()
  for (const patentsByApp of appPatents.values()) for (const p of patentsByApp) patents.add(p)

  return {
    nodes: activeNodes,
    edges: activeEdges,
    communities,
    stats: {
      applicant_count: activeNodes.length,
      patent_count: patents.size,
      concept_count: conceptApplicants.size,
      community_count: typeCounts.size,
      year_range: options.yearRange,
    },
    maxSupport,
    capabilityWarning: capabilityWarning(graph),
  }
}

export function selectGraphView(graph: GraphData, options: GraphViewOptions): GraphViewData {
  if (options.mode === 'institution') return selectInstitutionView(graph, options)
  return options.mode === 'concept'
    ? selectConceptView(graph, options)
    : selectContextView(graph, options)
}
