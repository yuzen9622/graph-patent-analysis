import { applicantSize, conceptSize, PATENT_NODE_SIZE, stableEdgeId } from './concept-network'
import { computeUnitMetrics, pairApplicantSupport } from './concept-metrics'
import { gradientColor, isValidYear } from './concept-time'
import { analysisScopeKeyOf, breakTemporalCycles, citationAdjudication, leaveOneOutMedianSpan, medianStandard, orientPair, quartiles, supportStrengthOpacity, type TemporalCycleWarning } from './temporal'
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
  /** P6 temporal reference is explicit; active-scope is the default (I1). */
  temporalReference?: 'active' | 'full'
  /** P6 independent citation-only evidence layer; hidden by default. */
  showCitations?: boolean
  /** Optional dataset identity when the caller has one; this app currently uses sourceFiles. */
  dataset?: string[]
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
  /** P6 active-scope identity shared by all derived concept metrics. */
  scopeId?: string
  citationEdges: import('../types/graph').CitationEdge[]
  warnings?: GraphData['warnings']
}

function scopeIdOf(graph: GraphData, options: GraphViewOptions): string {
  // A full view still needs its owning dataset identity. This application has
  // no separate dataset-id field, so the complete patent source-file set is
  // the existing stable identity; a source filter narrows that identity.
  const selectedSources = options.sourceFiles?.filter(Boolean)
  const datasetIdentity = options.dataset?.length
    ? options.dataset
    : selectedSources?.length
      ? selectedSources
      : sourceFilesOf(graph)
  return analysisScopeKeyOf({
    dataset: datasetIdentity,
    source: selectedSources,
    ipc: options.ipcFilter,
    unit: options.unit ?? 'patent',
    // Full-range carries its explicit [min,max] tuple, not an omitted value.
    year: options.yearRange,
  })
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

/**
 * 決定是否用「家」單位社群著色：明確選 'community_applicants'，或缺省色（未指定／
 * 'community'）且分析單位為「家」——後者讓顏色自動跟著單位走，不必額外選一次。
 */
function usesApplicantCommunityColour(options: GraphViewOptions): boolean {
  if (options.colorMode === 'community_applicants') return true
  const isDefaultColour = options.colorMode === undefined || options.colorMode === 'community'
  return isDefaultColour && options.unit === 'applicant'
}

function capabilityWarning(graph: GraphData, extra?: string): string | undefined {
  const warnings: string[] = []
  if (graph.methodology.cooccurrence_data === 'unavailable') {
    warnings.push('舊資料缺少可重建的專利—概念成員關係，無法產生共現統計。')
  } else if (graph.methodology.cooccurrence_data === 'reconstructed') {
    warnings.push('共現統計由舊資料保存的專利—概念成員關係重建；正式分析建議使用新版重新產生。')
  }
  if (graph.methodology.semantic_provenance === 'partial') {
    warnings.push('舊資料只保留部分 LLM 關係來源；目前顯示的是可觀測來源，不代表完整支持篇數。')
  }
  if (extra) warnings.push(extra)
  return warnings.length > 0 ? warnings.join(' ') : undefined
}

/**
 * 家單位（applicant）資料可用性：這個圖能不能產出「家」單位的概念視圖，以及數據從哪來。
 *
 * - 'stored'      — 圖內建（P4）時已儲存家單位欄位（concept.applicant_count 或
 *                  edge.support_applicants），直接讀用。
 * - 'rebuildable' — 舊格式（schema v2 備份）沒有家單位欄位，但仍存有結構邊
 *                  （申請了 專利↔機構），view 層可像已篩選路徑那樣由結構重建家計量。
 * - 'none'        — 既無儲存也無從重建；切到「家」會畫出一張邊數 0、大小誤讀成篇數的空圖。
 */
export type ApplicantAvailability = 'stored' | 'rebuildable' | 'none'

export function applicantAvailability(graph: GraphData): ApplicantAvailability {
  const stored =
    graph.nodes.some(
      (node) => node.type === 'concept' && typeof node.applicant_count === 'number',
    ) ||
    graph.edges.some(
      (edge) =>
        edge.kind === 'cooccurrence' && typeof edge.support_applicants === 'number',
    )
  if (stored) return 'stored'
  const rebuildable = graph.edges.some(
    (edge) => edge.kind === 'structural' && edge.relation === '申請了',
  )
  return rebuildable ? 'rebuildable' : 'none'
}

/** 舊格式分析在「家」單位下由結構重建時的說明文字（圖例/離線匯出共用）。 */
export const APPLICANT_REBUILD_NOTE =
  '此分析為舊格式（未儲存機構單位統計）；「家」計量由專利—機構結構重建。重新執行分析即可取得已儲存的機構統計。'

function legacyCycleInfo(edges: GraphEdge[], nodes: GraphNode[]) {
  const medianById = new Map(nodes.map((node) => [node.id, node.median_year] as const))
  return breakTemporalCycles(
    edges
      .filter((edge) => edge.kind === 'cooccurrence' && edge.temporal_directed)
      .map((edge) => ({
        edge_id: edge.id,
        source: edge.from,
        target: edge.to,
        support: edge.support_count ?? 0,
        delta_median: (medianById.get(edge.to) ?? 0) - (medianById.get(edge.from) ?? 0),
      })),
  )
}

function legacyIndeterminateCount(nodes: GraphNode[]): number {
  return nodes.filter((node) => node.type === 'concept' && node.temporal_legacy_unverified).length
}

function temporalWarnings(
  cycleWarnings: readonly TemporalCycleWarning[],
  indeterminate: number,
  conflicts?: Array<{ edge_id: string; forward: number; reverse: number }>,
): GraphData['warnings'] | undefined {
  if (!cycleWarnings?.length && indeterminate === 0 && !conflicts?.length) return undefined
  return {
    ...(cycleWarnings?.length ? { temporal_cycles_broken: [...cycleWarnings] } : {}),
    ...(indeterminate > 0 ? { legacy_temporal_indeterminate: indeterminate } : {}),
    ...(conflicts?.length ? { temporal_direction_conflict: conflicts } : {}),
  }
}

function selectConceptView(graph: GraphData, options: GraphViewOptions): GraphViewData {
  // PRD v2 / P2 + P5: 來源檔／IPC 篩選 → 由子集重推導概念視圖（不重跑 LLM）。
  const rawSel = selectedRawIds(graph, options)
  // P9: 舊格式分析（schema v2 備份）在「家」單位下由結構邊重建，圖例同步說明。
  const availability = applicantAvailability(graph)
  const rebuildNote =
    options.unit === 'applicant' && availability === 'rebuildable'
      ? APPLICANT_REBUILD_NOTE
      : undefined
  if (rawSel) {
    return selectConceptViewFiltered(
      graph,
      options,
      sourceFilesOf(graph),
      rawSel,
      rebuildNote,
    )
  }
  // P9 核心：未篩選時，家單位不得靜默讀 NULL——把它當成「全量 cohort 的重建」（與上方
  // 已篩選路徑同一條 申請了/包含 結構重推導，只是不篩）。否則舊資料在「家」單位下會得到
  // 0 條邊、節點大小誤退回篇數，而圖例正聲稱「大小＝機構家數」。
  if (options.unit === 'applicant' && availability === 'rebuildable') {
    const fullCohort = new Set(
      graph.nodes
        .filter((node) => node.type === 'patent')
        .map((node) => node.id.replace(/^patent:/, '')),
    )
    return selectConceptViewFiltered(
      graph,
      options,
      sourceFilesOf(graph),
      fullCohort,
      rebuildNote,
    )
  }
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
  // （色盤 key = unit + id，兩單位同 id 不共享色）。缺省顏色（'community'／未指定）
  // 跟著分析單位走：unit='applicant' 時自動改用家單位社群色，避免「大小講家、顏色講篇」互相打架。
  const useApplicantCommunity = usesApplicantCommunityColour(options)
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
  // Never reuse build-time graph.scope_id here: a view scope is defined by
  // current options, including a unit switch (I1).
  const scopeId = scopeIdOf(graph, options)
  const cycleInfo = legacyCycleInfo(edges, nodes)
  const indeterminate = legacyIndeterminateCount(nodes)
  nodes = nodes.map((node) => ({ ...node, scope_id: scopeId }))
  const medianById = new Map(nodes.map((node) => [node.id, node.temporal_legacy_unverified ? undefined : node.median_year] as const))
  const scopedEdges = edges.map((edge) => {
    if (edge.kind !== 'cooccurrence') return edge
    const orientation = cycleInfo.demotedEdgeIds.has(edge.id)
      ? undefined
      : orientPair(medianById.get(edge.from), medianById.get(edge.to))
    const projected = {
      ...edge,
      temporal_directed: orientation !== undefined,
      opacity: edge.opacity ?? supportStrengthOpacity(edge.support_count ?? 0),
      scope_id: scopeId,
    }
    if (orientation?.from === 'b') [projected.from, projected.to] = [projected.to, projected.from]
    return projected
  })
  const allRaw = new Set(
    graph.nodes.filter((node) => node.type === 'patent').map((node) => node.id.replace(/^patent:/, '')),
  )
  const citationProjection = graph.patent_citations
    ? projectCitationEvidence(graph, allRaw, nodes, scopedEdges.filter((edge) => edge.kind === 'cooccurrence'), scopeId)
    : undefined
  if (citationProjection) {
    for (const edge of scopedEdges) {
      if (edge.kind !== 'cooccurrence' || !edge.temporal_directed) continue
      const evidence = citationProjection.byPair.get(`${edge.from}\u0000${edge.to}`)
      edge.citation_supported = evidence?.supported ?? false
      edge.citation_direction_conflict = evidence?.direction_conflict ?? false
    }
  }
  return {
    nodes,
    edges: scopedEdges,
    citationEdges: options.showCitations
      ? citationProjection?.citationEdges ?? (graph.citation_edges ?? []).map((edge) => ({ ...edge, scope_id: scopeId }))
      : [],
    scopeId,
    warnings: temporalWarnings(cycleInfo.warnings, indeterminate, citationProjection?.conflicts) ?? graph.warnings,
    communities,
    stats: {
      ...graph.stats,
      concept_count: nodes.length,
      community_count: communities.length,
    },
    maxSupport,
    capabilityWarning: capabilityWarning(graph, rebuildNote),
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
  const [yearStart, yearEnd] = options.yearRange
  // Full range is intentionally a no-projection short circuit; any active
  // year window participates in the same raw-patent cohort as source/IPC.
  const isFullRange = yearStart === graph.stats.year_range[0] && yearEnd === graph.stats.year_range[1]
  if ((!files || files.length === 0) && (!ipcKeys || ipcKeys.length === 0) && isFullRange) return null
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
    const year = node.year
    const okYear = isFullRange || (typeof year === 'number' && year >= yearStart && year <= yearEnd)
    if (okFile && okIpc && okYear) raw.add(node.id.replace(/^patent:/, ''))
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
  extraCapabilityNote?: string,
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

  // I1: every temporal value shown in an active window is recomputed from the
  // exact selected patent cohort. Full-history is an explicit reference mode.
  if (options.temporalReference !== 'full') {
    const yearByRaw = new Map(
      graph.nodes
        .filter((node) => node.type === 'patent' && typeof node.year === 'number')
        .map((node) => [node.id.replace(/^patent:/, ''), node.year!] as const),
    )
    nodes = nodes.map((node) => {
      const years = (node.source_patents ?? [])
        .map((raw) => yearByRaw.get(raw))
        .filter((year): year is number => year !== undefined && isValidYear(year))
      const qs = quartiles(years)
      const loo = leaveOneOutMedianSpan(years)
      return {
        ...node,
        first_year: years.length ? Math.min(...years) : undefined,
        q1_year: qs.q1,
        median_year: medianStandard(years),
        q3_year: qs.q3,
        last_year: years.length ? Math.max(...years) : undefined,
        median_loo_min: loo?.min,
        median_loo_max: loo?.max,
      }
    })
  }

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
  const scopeId = scopeIdOf(graph, options)
  const cycleInfo = legacyCycleInfo(co as GraphEdge[], nodes)
  const indeterminate = legacyIndeterminateCount(nodes)
  const medianById = new Map(nodes.map((node) => [node.id, node.temporal_legacy_unverified ? undefined : node.median_year] as const))
  const allEdges = [...cooEdges, ...semantic]
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((edge) => {
      if (edge.kind !== 'cooccurrence') return edge
      const orientation = cycleInfo.demotedEdgeIds.has(edge.id)
        ? undefined
        : orientPair(medianById.get(edge.from), medianById.get(edge.to))
      const oriented = { ...edge, temporal_directed: orientation !== undefined, opacity: supportStrengthOpacity(edge.support_count ?? 0), scope_id: scopeId }
      if (orientation?.from === 'b') [oriented.from, oriented.to] = [oriented.to, oriented.from]
      return oriented
    })
  const citationProjection = projectCitationEvidence(
    graph,
    rawSel,
    nodes,
    allEdges.filter((edge) => edge.kind === 'cooccurrence'),
    scopeId,
  )
  for (const edge of allEdges) {
    if (edge.kind !== 'cooccurrence' || !edge.temporal_directed) continue
    const evidence = citationProjection.byPair.get(`${edge.from}\u0000${edge.to}`)
    edge.citation_supported = evidence?.supported ?? false
    edge.citation_direction_conflict = evidence?.direction_conflict ?? false
  }

  // 著色：source／first_year／community／ipc 都沿用既有規則（以子集為準）。
  const useApplicantCommunity = usesApplicantCommunityColour(options)
  if (options.colorMode === 'first_year') {
    nodes = applyTimeColour(nodes, graph.methodology?.time_window)
  } else if (useApplicantCommunity) {
    nodes = applyCommunityApplicantsColour(nodes, graph.communities_applicants ?? [])
  } else if (options.colorMode === 'source') {
    nodes = applySourceColour(graph, nodes, fileList)
  } else if (options.colorMode === 'ipc') {
    nodes = applyIpcColour(graph, nodes, options.ipcLevel ?? DEFAULT_IPC_LEVEL)
  }

  const communityIdOf = (node: GraphNode) =>
    useApplicantCommunity
      ? node.community_id_applicants
      : node.community_id
  const communityNodeCounts = new Map<number, number>()
  for (const node of nodes) {
    const communityId = communityIdOf(node)
    if (typeof communityId !== 'number') continue
    communityNodeCounts.set(communityId, (communityNodeCounts.get(communityId) ?? 0) + 1)
  }
  const communities = (useApplicantCommunity
    ? graph.communities_applicants ?? []
    : graph.communities
  )
    .filter((community) => communityNodeCounts.has(community.id))
    .map((community) => ({
      ...community,
      node_count: communityNodeCounts.get(community.id) ?? 0,
    }))

  nodes = nodes.map((node) => ({ ...node, scope_id: scopeId }))
  return {
    nodes,
    edges: allEdges,
    citationEdges: options.showCitations ? citationProjection.citationEdges : [],
    scopeId,
    warnings: temporalWarnings(cycleInfo.warnings, indeterminate, citationProjection.conflicts),
    communities,
    stats: {
      ...graph.stats,
      applicant_count: applicantConcepts.size,
      patent_count: rawSel.size,
      concept_count: nodes.length,
      community_count: communities.length,
      year_range: options.yearRange,
    },
    maxSupport,
    capabilityWarning: capabilityWarning(graph, extraCapabilityNote),
  }
}
function projectCitationEvidence(
  graph: GraphData,
  rawSel: Set<string>,
  nodes: GraphNode[],
  relationEdges: GraphEdge[],
  scopeId: string,
): {
  byPair: Map<string, { supported: boolean; direction_conflict: boolean }>
  citationEdges: import('../types/graph').CitationEdge[]
  conflicts: Array<{ edge_id: string; forward: number; reverse: number }>
} {
  const labelsByRaw = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.type !== 'concept') continue
    for (const raw of node.source_patents ?? []) {
      const labels = labelsByRaw.get(raw) ?? []
      labels.push(node.label)
      labelsByRaw.set(raw, labels)
    }
  }
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const citation of graph.patent_citations ?? []) {
    if (!rawSel.has(citation.from) || !rawSel.has(citation.to)) continue
    const link = `${citation.from}\u0000${citation.to}`
    if (seen.has(link)) continue
    seen.add(link)
    for (const from of labelsByRaw.get(citation.from) ?? []) for (const to of labelsByRaw.get(citation.to) ?? []) {
      if (from === to) continue
      const key = `${from}\u0000${to}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const byPair = new Map<string, { supported: boolean; direction_conflict: boolean }>()
  const conflicts: Array<{ edge_id: string; forward: number; reverse: number }> = []
  const relationPairs = new Set<string>()
  for (const edge of relationEdges) {
    const from = edge.from.replace(/^concept:/, '')
    const to = edge.to.replace(/^concept:/, '')
    relationPairs.add([from, to].sort().join('\u0000'))
    if (!edge.temporal_directed) continue
    const forward = counts.get(`${from}\u0000${to}`) ?? 0
    const reverse = counts.get(`${to}\u0000${from}`) ?? 0
    const state = citationAdjudication(forward, reverse).state
    const supported = state === 'aligned' || state === 'conflicting'
    const direction_conflict = state === 'conflicting'
    byPair.set(`${edge.from}\u0000${edge.to}`, { supported, direction_conflict })
    if (direction_conflict) conflicts.push({ edge_id: edge.id, forward, reverse })
  }
  const medianByLabel = new Map(nodes.filter((node) => node.type === 'concept').map((node) => [node.label, node.median_year] as const))
  const citationEdges: import('../types/graph').CitationEdge[] = []
  const seenPairs = new Set<string>()
  for (const key of counts.keys()) {
    const [a, b] = key.split('\u0000')
    const pair = [a!, b!].sort().join('\u0000')
    if (seenPairs.has(pair) || relationPairs.has(pair)) continue
    seenPairs.add(pair)
    const orientation = orientPair(medianByLabel.get(a!), medianByLabel.get(b!))
    if (!orientation) continue
    const from = orientation.from === 'a' ? a! : b!
    const to = orientation.to === 'b' ? b! : a!
    const forward = counts.get(`${from}\u0000${to}`) ?? 0
    const reverse = counts.get(`${to}\u0000${from}`) ?? 0
    const state = citationAdjudication(forward, reverse).state
    if (state !== 'aligned' && state !== 'conflicting') continue
    citationEdges.push({
      id: stableEdgeId('citation', [from, to]),
      from: `concept:${from}`,
      to: `concept:${to}`,
      forward_count: forward,
      reverse_count: reverse,
      supported: true,
      direction_conflict: state === 'conflicting',
      scope_id: scopeId,
    })
  }
  return { byPair, citationEdges, conflicts }
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
    citationEdges: [],
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
    citationEdges: [],
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
