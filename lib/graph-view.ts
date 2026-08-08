import { applicantSize, conceptSize, PATENT_NODE_SIZE, stableEdgeId } from './concept-network'
import { computeUnitMetrics, pairApplicantSupport } from './concept-metrics'
import { gradientColor } from './concept-time'
import { applyIpcColour, DEFAULT_IPC_LEVEL, ipcKeysOfPatents, type IpcLevel } from './ipc-filter'
import { classifyOrgType } from './applicant-classify'
import type {
  Community,
  GraphData,
  GraphEdge,
  GraphMode,
  GraphNode,
} from '../types/graph'

export type ColorMode =
  | 'community'
  | 'first_year'
  | 'community_applicants'
  | 'source'
  | 'ipc'

/** 線寬用哪個有界指標（意圖決策 2：只用有界指標當線寬）。 */
export type EdgeWeightMetric = 'jaccard' | 'npmi'

/** PRD v2 / P4: 分析單位 —— 篇（patent）／家（institution）。 */
export type Unit = 'patent' | 'applicant'

export interface GraphViewOptions {
  mode: GraphMode
  showSemantic: boolean
  minSupport: number
  yearRange: [number, number]
  /** PRD v2 / P3: concept-node colouring. `community` = 篇單位預設。 */
  colorMode?: ColorMode
  /** 線寬指標：jaccard（預設）或 NPMI（決策 2，皆為有界）。 */
  edgeWeight?: EdgeWeightMetric
  /** PRD v2 / P4 (Q3): 分析單位。概念視圖的門檻/大小/圖例跟「家」隨之。 */
  unit?: Unit
  /**
   * PRD v2 / P2: 來源檔篩選。空／未給＝不篩（全部來源）。非空時只保留
   * source_files 與之相交的專利，並從那份子集重新推導概念圖（不重跑 LLM）。
   */
  sourceFiles?: string[]
  /**
   * PRD v2 / P5: IPC 五級層級（1..5，缺省 3）。決定 IPC 篩選鍵與著色的投影層。
   */
  ipcLevel?: IpcLevel
  /**
   * PRD v2 / P5: 選定層級的 IPC key 集合（OR；與 sourceFiles 為 AND）。
   * 空／未給＝不做 IPC 篩選。S6：切換 ipcLevel 時由 UI 清空。
   */
  ipcFilter?: string[]
}

/**
 * PRD v2 / P2: 依來源檔著色色盤。檔案依 `sourceFilesOf()` 排序；每檔一色，
 * 跨檔（在 ≥2 個來源都出現）的概念用共享色以便一眼看出「哪個是獨有、哪個是共有」。
 */
export const SOURCE_FILE_COLORS = [
  '#0ea5e9', // sky（第一檔）
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f43f5e', // rose
  '#6366f1', // indigo
]
export const SOURCE_OVERLAP_COLOR = '#334155' // 跨多個來源檔出現的概念

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
  // PRD v2 / P2 + P5: 來源檔／IPC 篩選 → 由子集重推導概念視圖（不重跑 LLM）。
  const rawSel = selectedRawIds(graph, options)
  if (rawSel) return selectConceptViewFiltered(graph, options, sourceFilesOf(graph), rawSel)
  let nodes = graph.nodes.filter((node) => node.type === 'concept')
  const nodeIds = new Set(nodes.map((node) => node.id))
  // PRD v2 / P4 (Q3): 概念視圖的門檻/大小跟「家」隨之。缺省 unit='patent'。
  const applicantUnit = options.unit === 'applicant'
  const supportOf = applicantUnit
    ? (edge: GraphEdge) => edge.support_applicants ?? 0
    : (edge: GraphEdge) => edge.support_count ?? 0
  const cooccurrence = graph.edges.filter(
    (edge) => edge.kind === 'cooccurrence' && supportOf(edge) >= options.minSupport,
  )
  const semantic = options.showSemantic
    ? graph.edges.filter((edge) => edge.kind === 'semantic')
    : []
  const edges = [...cooccurrence, ...semantic].filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  )
  // 節點大小跟單位：家→概念涵蓋家數；篇→概念涵蓋篇數。
  if (applicantUnit) {
    nodes = nodes.map((node) => {
      const count = node.applicant_count ?? node.frequency ?? 0
      return { ...node, size: conceptSize(count) }
    })
  }
  // PRD v2 / P4 (Q2): colorMode 'community_applicants' 用「家」單位分區與色盤
  // （色盤 key = unit + id，兩單位同 id 不共享色）。
  const useApplicantCommunity = options.colorMode === 'community_applicants'
  const activeCommunityIds = new Set(
    nodes
      .map((node) =>
        useApplicantCommunity ? node.community_id_applicants : node.community_id,
      )
      .filter((id): id is number => typeof id === 'number'),
  )
  const communities = (useApplicantCommunity
    ? graph.communities_applicants ?? []
    : graph.communities
  ).filter((community) => activeCommunityIds.has(community.id))
  const maxSupport = Math.max(
    1,
    ...graph.edges
      .filter((edge) => edge.kind === 'cooccurrence')
      .map((edge) => supportOf(edge)),
  )
  if (options.colorMode === 'first_year') {
    nodes = applyTimeColour(nodes, graph.methodology?.time_window)
  } else if (useApplicantCommunity) {
    nodes = applyCommunityApplicantsColour(nodes, graph.communities_applicants ?? [])
  } else if (options.colorMode === 'source') {
    nodes = applySourceColour(graph, nodes, sourceFilesOf(graph))
  } else if (options.colorMode === 'ipc') {
    nodes = applyIpcColour(graph, nodes, options.ipcLevel ?? DEFAULT_IPC_LEVEL)
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

/**
 * PRD v2 / P4 (Q2): 純 view 層重上色——概念節點改用「家」單位社群色。
 * 永不 mutate graph nodes。
 */
function applyCommunityApplicantsColour(
  nodes: GraphNode[],
  communitiesApplicants: Community[],
): GraphNode[] {
  const colorById = new Map(
    communitiesApplicants.map((community) => [community.id, community.color]),
  )
  return nodes.map((node) => {
    if (node.type !== 'concept' || node.community_id_applicants === undefined) return node
    const color = colorById.get(node.community_id_applicants)
    return color ? { ...node, color } : node
  })
}

// ─── PRD v2 / P2: 來源檔（多檔比對）──────────────────────────────────────

/** 全圖所有的來源檔名（依 patents.source_files 聯集、排序）。 */
export function sourceFilesOf(graph: GraphData): string[] {
  const set = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    for (const f of node.source_files ?? []) set.add(f)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

/**
 * raw patent id（去掉 `patent:` 前缀）→ 其來源檔清單。
 * key 與 concept.source_patents／graph-builder 的 patent.id 對齊。
 */
function patentFilesByRawId(graph: GraphData): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    map.set(node.id.replace(/^patent:/, ''), node.source_files ?? [])
  }
  return map
}

/**
 * 專利子集（raw patent id）：P2 來源檔（任一命中）∩ P5 IPC（任一命中）。
 * 兩者皆空／未給＝null（不過濾）。P5 S2：IPC 命中以「目前層級投影」為準。
 */
function selectedRawIds(
  graph: GraphData,
  options: GraphViewOptions,
): Set<string> | null {
  const files = options.sourceFiles
  const ipcKeys = options.ipcFilter
  if ((!files || files.length === 0) && (!ipcKeys || ipcKeys.length === 0)) return null
  const wantFiles = new Set(files ?? [])
  const wantIpc = ipcKeys && ipcKeys.length > 0 ? new Set(ipcKeys) : null
  const level = options.ipcLevel ?? DEFAULT_IPC_LEVEL
  const raw = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    const okFile =
      !files || files.length === 0
        ? true
        : (node.source_files ?? []).some((f) => wantFiles.has(f))
    let okIpc = true
    if (wantIpc) {
      okIpc = false
      for (const key of ipcKeysOfPatents(node.ipc5, level)) {
        if (wantIpc.has(key)) {
          okIpc = true
          break
        }
      }
    }
    if (okFile && okIpc) raw.add(node.id.replace(/^patent:/, ''))
  }
  return raw
}

/** 概念節點依來源檔著色：恰好一檔→該檔色；≥2 檔→共享色。 */
export function applySourceColour(
  graph: GraphData,
  nodes: GraphNode[],
  fileList: string[],
): GraphNode[] {
  const patentFiles = patentFilesByRawId(graph)
  const index = new Map(fileList.map((f, i) => [f, i]))
  return nodes.map((node) => {
    if (node.type !== 'concept') return node
    const touch = new Set<string>()
    for (const raw of node.source_patents ?? []) {
      for (const f of patentFiles.get(raw) ?? []) touch.add(f)
    }
    let color: string
    if (touch.size === 1) {
      const f = Array.from(touch)[0]
      const i = index.get(f)
      color =
        i === undefined
          ? SOURCE_OVERLAP_COLOR
          : SOURCE_FILE_COLORS[i % SOURCE_FILE_COLORS.length]
    } else {
      color = SOURCE_OVERLAP_COLOR
    }
    return color === node.color ? node : { ...node, color }
  })
}

/**
 * 從結構邊（申請了／包含）重建 專利↔概念／專利↔機構 索引，
 * 與 institution view 同樣純 view 層（不用 DB、不重跑 LLM）。
 */
interface ConceptIndex {
  /** raw patent → concept label 集（含） */
  patentConcepts: Map<string, Set<string>>
  /** raw patent → 申請機構（label） */
  patentApplicants: Map<string, Set<string>>
}
function buildConceptIndex(graph: GraphData): ConceptIndex {
  const patentConcepts = new Map<string, Set<string>>()
  const patentApplicants = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'structural') continue
    if (edge.relation === '包含') {
      const p = edge.from.replace(/^patent:/, '')
      const label = edge.to.replace(/^concept:/, '')
      const s = patentConcepts.get(p) ?? new Set<string>()
      s.add(label)
      patentConcepts.set(p, s)
    } else if (edge.relation === '申請了') {
      const p = edge.to.replace(/^patent:/, '')
      const a = edge.from.replace(/^applicant:/, '')
      const s = patentApplicants.get(p) ?? new Set<string>()
      s.add(a)
      patentApplicants.set(p, s)
    }
  }
  return { patentConcepts, patentApplicants }
}

/**
 * 依來源檔／IPC 子集重新推導概念視圖（不重跑 LLM，重載圖與新圖皆可用）。
 * `rawSel`＝被保留的 raw patent id 集合（selectedRawIds 回傳）。
 */
function selectConceptViewFiltered(
  graph: GraphData,
  options: GraphViewOptions,
  fileList: string[],
  rawSel: Set<string>,
): GraphViewData {
  const idx = buildConceptIndex(graph)

  // label → 子集中的 raw patent／申請機構 集合
  const conceptPatents = new Map<string, Set<string>>()
  const conceptApplicants = new Map<string, Set<string>>()
  const applicantConcepts = new Map<string, Set<string>>()
  for (const [raw, labels] of idx.patentConcepts) {
    if (!rawSel.has(raw)) continue
    const apps = idx.patentApplicants.get(raw) ?? new Set<string>()
    for (const label of labels) {
      const ps = conceptPatents.get(label) ?? new Set<string>()
      ps.add(raw)
      conceptPatents.set(label, ps)
      if (apps.size > 0) {
        const as = conceptApplicants.get(label) ?? new Set<string>()
        for (const a of apps) as.add(a)
        conceptApplicants.set(label, as)
      }
    }
    for (const a of apps) {
      const cs = applicantConcepts.get(a) ?? new Set<string>()
      for (const label of idx.patentConcepts.get(raw) ?? []) cs.add(label)
      applicantConcepts.set(a, cs)
    }
  }

  // 只保留在子集仍存在的概念節點，並重算大小（篇/家單位）。
  const applicantUnit = options.unit === 'applicant'
  let nodes: GraphNode[] = graph.nodes
    .filter((node) => node.type === 'concept')
    .map((node) => {
      const patents = conceptPatents.get(labelOf(node.id)) ?? new Set<string>()
      const apps = conceptApplicants.get(labelOf(node.id)) ?? new Set<string>()
      const count = applicantUnit ? apps.size : patents.size
      return { ...node, source_patents: Array.from(patents), frequency: patents.size, applicant_count: apps.size, size: conceptSize(count) }
    })
    .filter((node) => (node.source_patents?.length ?? 0) > 0)

  // 依子集重算 co-occurrence 與各單位指標（全量→門檻顯示過濾，承 Q4）。
  const conceptPatentCount = new Map(
    Array.from(conceptPatents.entries()).map(([l, s]) => [l, s.size] as const),
  )
  const conceptApplicantCount = new Map(
    Array.from(conceptApplicants.entries()).map(([l, s]) => [l, s.size] as const),
  )
  const pairApplicants = pairApplicantSupport(applicantConcepts)
  const co = graph.edges
    .filter((e) => e.kind === 'cooccurrence')
    .map((e) => {
      const a = labelOf(e.from)
      const b = labelOf(e.to)
      const A = conceptPatents.get(a)
      const B = conceptPatents.get(b)
      if (!A || !B) return undefined
      const inter = intersectSize(A, B)
      return inter > 0 ? { id: e.id, from: e.from, to: e.to, support_count: inter } : undefined
    })
    .filter((e): e is NonNullable<typeof e> => e !== undefined)
  const totalInstitutions = applicantConcepts.size
  const metrics = computeUnitMetrics({
    cooccurrence: co,
    conceptPatents: conceptPatentCount,
    conceptApplicants: conceptApplicantCount,
    pairApplicants,
    totalPatents: rawSel.size,
    totalInstitutions,
  })

  const supportOf = applicantUnit
    ? (e: { support_applicants?: number }) => e.support_applicants ?? 0
    : (e: { support_count?: number }) => e.support_count ?? 0
  const edges: GraphEdge[] = co
    .map((e): GraphEdge => {
      const a = labelOf(e.from)
      const b = labelOf(e.to)
      const A = conceptPatents.get(a)
      const B = conceptPatents.get(b)
      const union = (A?.size ?? 0) + (B?.size ?? 0) - e.support_count
      const jaccard =
        e.support_count > 0 && union > 0 ? e.support_count / union : undefined
      const m = metrics.get(e.id) ?? {}
      return {
        id: e.id,
        from: e.from,
        to: e.to,
        relation: '共同投入',
        kind: 'cooccurrence' as const,
        support_count: e.support_count,
        jaccard,
        support_applicants: m.support_applicants,
        jaccard_applicants: m.jaccard_applicants,
        npmi: m.npmi,
        npmi_applicants: m.npmi_applicants,
        association_strength: m.association_strength,
        association_strength_applicants: m.association_strength_applicants,
      }
    })
  const semantic = options.showSemantic
    ? graph.edges.filter((e) => e.kind === 'semantic')
    : []
  const maxSupport = Math.max(1, ...co.map((e) => Math.max(supportOf(e), 0)))
  const cooEdges = edges.filter((e) => supportOf(e) >= options.minSupport)
  const nodeIds = new Set(nodes.map((n) => n.id))
  const allEdges = [...cooEdges, ...semantic].filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
  )

  // 著色：source／first_year／community／ipc 都沿用既有規則（以子集為準）。
  if (options.colorMode === 'first_year') {
    nodes = applyTimeColour(nodes, graph.methodology?.time_window)
  } else if (options.colorMode === 'community_applicants') {
    nodes = applyCommunityApplicantsColour(nodes, graph.communities_applicants ?? [])
  } else if (options.colorMode === 'source') {
    nodes = applySourceColour(graph, nodes, fileList)
  } else if (options.colorMode === 'ipc') {
    nodes = applyIpcColour(graph, nodes, options.ipcLevel ?? DEFAULT_IPC_LEVEL)
  }

  const activeCommunityIds = new Set(
    nodes
      .map((node) => (options.colorMode === 'community_applicants' ? node.community_id_applicants : node.community_id))
      .filter((id): id is number => typeof id === 'number'),
  )
  const communities = (options.colorMode === 'community_applicants'
    ? graph.communities_applicants ?? []
    : graph.communities
  ).filter((community) => activeCommunityIds.has(community.id))

  return {
    nodes,
    edges: allEdges,
    communities,
    stats: {
      ...graph.stats,
      applicant_count: applicantConcepts.size,
      patent_count: rawSel.size,
      concept_count: nodes.length,
      community_count: communities.length,
    },
    maxSupport,
    capabilityWarning: capabilityWarning(graph),
  }
}
function intersectSize(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let n = 0
  for (const x of small) if (big.has(x)) n += 1
  return n
}

function labelOf(id: string): string {
  return id.replace(/^concept:/, '')
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
  const rawSel = selectedRawIds(graph, options)
  const visiblePatents = graph.nodes.filter(
    (node) =>
      node.type === 'patent' &&
      (!rawSel || rawSel.has(node.id.replace(/^patent:/, ''))) &&
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
  const rawSel = selectedRawIds(graph, options)
  const appPatents = new Map<string, Set<string>>()
  const patentConcepts = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'structural') continue
    if (edge.relation === '申請了') {
      if (rawSel && !rawSel.has(edge.to.replace(/^patent:/, ''))) continue
      const s = appPatents.get(edge.from) ?? new Set()
      s.add(edge.to)
      appPatents.set(edge.from, s)
    } else if (edge.relation === '包含') {
      if (rawSel && !rawSel.has(edge.from.replace(/^patent:/, ''))) continue
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
