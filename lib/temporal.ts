// lib/temporal.ts — PRD v2 / P6 依中位申請年排序的技術關聯圖
// Pure temporal rules. These predicates deliberately never inspect labels or hashes.

export interface Quartiles {
  q1?: number
  q3?: number
}

/** Standard statistical median; even-sized populations use the mean of the two middle values. */
export function medianStandard(years: readonly number[]): number | undefined {
  if (years.length === 0) return undefined
  const sorted = [...years].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Nearest-rank quartiles, as declared in the P6 methodology. */
export function quartiles(years: readonly number[]): Quartiles {
  if (years.length === 0) return {}
  const sorted = [...years].sort((a, b) => a - b)
  const rank = (p: number) => sorted[Math.ceil(p * sorted.length) - 1]
  return { q1: rank(0.25), q3: rank(0.75) }
}

export interface LeaveOneOutMedianSpan {
  min: number
  max: number
}

/** Range of medians obtained by removing each individual observation once. */
export function leaveOneOutMedianSpan(years: readonly number[]): LeaveOneOutMedianSpan | undefined {
  if (years.length < 2) return undefined
  const medians: number[] = []
  for (let i = 0; i < years.length; i += 1) {
    const median = medianStandard([...years.slice(0, i), ...years.slice(i + 1)])
    if (median !== undefined) medians.push(median)
  }
  return medians.length > 0 ? { min: Math.min(...medians), max: Math.max(...medians) } : undefined
}

/** Fixed visual mapping; tau=5 is a visualization heuristic, not a confidence value. */
export function supportStrengthOpacity(support: number, tau = 5): number {
  const s = Math.max(0, Number.isFinite(support) ? support : 0)
  return 0.30 + 0.70 * (1 - Math.exp(-s / tau))
}

/** The only temporal rank key. Missing medians are intentionally incomparable. */
export function timeRankOf(median: number | undefined): number | null {
  return typeof median === 'number' && Number.isFinite(median) ? median : null
}

export interface TemporalOrientation {
  from: 'a' | 'b'
  to: 'a' | 'b'
}

/**
 * Orient solely by the two medians. Equal or unknown values have no direction;
 * labels, IDs and hashes must never be consulted for this predicate (I3).
 */
export function orientPair(
  medianA: number | undefined,
  medianB: number | undefined,
): TemporalOrientation | undefined {
  const a = timeRankOf(medianA)
  const b = timeRankOf(medianB)
  if (a === null || b === null || a === b) return undefined
  return a < b ? { from: 'a', to: 'b' } : { from: 'b', to: 'a' }
}

export type CitationState = 'absent' | 'insufficient' | 'aligned' | 'conflicting'

export interface CitationAdjudication {
  state: CitationState
  net: number
  ratio: number
}

/** Citation support never decides temporal direction; it only classifies evidence. */
export function citationAdjudication(forward: number, reverse: number): CitationAdjudication {
  const f = Math.max(0, forward)
  const r = Math.max(0, reverse)
  if (f === 0 && r === 0) return { state: 'absent', net: 0, ratio: 0 }
  const winner = Math.max(f, r)
  const loser = Math.min(f, r)
  const net = winner - loser
  const ratio = loser === 0 ? Infinity : winner / loser
  const supported = net >= 2 && ratio >= 2
  if (!supported) return { state: 'insufficient', net, ratio }
  return { state: f > r ? 'aligned' : 'conflicting', net, ratio }
}

export interface LegacyTemporalEdge {
  edge_id: string
  source: string
  target: string
  support: number
  delta_median: number
}

export interface TemporalCycleWarning {
  edge_id: string
  old_source: string
  target: string
  support: number
  delta_median: number
  reason: 'legacy_or_corrupt_graph'
}

/** Deterministically choose one legacy/corrupt edge to demote to undirected. */
export function fallbackCycleBreak(edges: readonly LegacyTemporalEdge[]): TemporalCycleWarning | undefined {
  const chosen = [...edges].sort(
    (a, b) =>
      a.support - b.support ||
      Math.abs(a.delta_median) - Math.abs(b.delta_median) ||
      a.edge_id.localeCompare(b.edge_id),
  )[0]
  return chosen
    ? {
        edge_id: chosen.edge_id,
        old_source: chosen.source,
        target: chosen.target,
        support: chosen.support,
        delta_median: chosen.delta_median,
        reason: 'legacy_or_corrupt_graph',
      }
    : undefined
}

export interface TemporalLayoutNode {
  id: string
  median_year?: number
}
export interface TemporalLayoutPosition { x: number; y: number }

/** Shared online/offline ordinal layout. IDs influence X only inside a Y band. */
export function computeTemporalLayout(nodes: readonly TemporalLayoutNode[]): Map<string, TemporalLayoutPosition> {
  const ranks = Array.from(new Set(nodes.flatMap((node) => timeRankOf(node.median_year) === null ? [] : [node.median_year!]))).sort((a, b) => a - b)
  const rankIndex = new Map(ranks.map((rank, index) => [rank, index]))
  const stableUnit = (value: string): number => {
    let hash = 0x811c9dc5
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0) / 0xffffffff
  }
  return new Map(nodes.map((node) => {
    const rank = timeRankOf(node.median_year)
    const index = rank === null ? ranks.length : rankIndex.get(rank)!
    return [node.id, { x: (stableUnit(node.id) - 0.5) * 700, y: index * 220 }]
  }))
}

export interface TemporalDirectedEdge {
  edge_id: string
  source: string
  target: string
  support: number
  delta_median: number
}

/**
 * Demote a deterministic edge from every detected directed cycle. New P6
 * graphs are rank-oriented DAGs, so this is only exercised by legacy/corrupt
 * payloads; each detection itself is linear in the active graph.
 */
export function breakTemporalCycles(edges: readonly TemporalDirectedEdge[]): {
  demotedEdgeIds: Set<string>
  warnings: TemporalCycleWarning[]
} {
  const active = new Map(edges.map((edge) => [edge.edge_id, edge]))
  const warnings: TemporalCycleWarning[] = []
  const findCycle = (): TemporalDirectedEdge[] | undefined => {
    const outgoing = new Map<string, TemporalDirectedEdge[]>()
    for (const edge of active.values()) {
      const list = outgoing.get(edge.source) ?? []
      list.push(edge)
      outgoing.set(edge.source, list)
    }
    const state = new Map<string, 0 | 1 | 2>()
    const stack: TemporalDirectedEdge[] = []
    const visit = (node: string): TemporalDirectedEdge[] | undefined => {
      state.set(node, 1)
      for (const edge of outgoing.get(node) ?? []) {
        const next = state.get(edge.target) ?? 0
        if (next === 1) {
          const start = stack.findIndex((item) => item.source === edge.target)
          return [...stack.slice(Math.max(0, start)), edge]
        }
        if (next === 0) {
          stack.push(edge)
          const cycle = visit(edge.target)
          if (cycle) return cycle
          stack.pop()
        }
      }
      state.set(node, 2)
      return undefined
    }
    for (const node of outgoing.keys()) if ((state.get(node) ?? 0) === 0) {
      const cycle = visit(node)
      if (cycle) return cycle
    }
    return undefined
  }
  for (let cycle = findCycle(); cycle; cycle = findCycle()) {
    const warning = fallbackCycleBreak(cycle)
    if (!warning) break
    active.delete(warning.edge_id)
    warnings.push(warning)
  }
  return { demotedEdgeIds: new Set(warnings.map((warning) => warning.edge_id)), warnings }
}

export interface AnalysisScopeInput {
  dataset?: readonly string[]
  source?: readonly string[]
  ipc?: readonly string[]
  unit?: string
  year?: readonly [number, number]
}

/** Stable, explicit analysis-scope material: each set is sorted before serialisation. */
/**
 * PRD v2 / P6 §2/§4/§8 — 時間模式圖說與方法學聲明文字。
 * 螢幕圖例（GraphLegend）與離線匯出（export-html）共用同一來源，避免雙份漂移。
 */
export const TEMPORAL_LEGEND_SENTENCE =
  'Vertical position indicates the ordinal ranking of median application year and does not imply causality or proportional temporal distance.'

/** §4 三窗名詞；`layout_time_band` 一詞與欄位命名一致。 */
export const TEMPORAL_YEAR_TERMS_LINE =
  'quality_year_bounds＝資料清理合法年份；analysis_year_filter＝目前分析 cohort；layout_time_band＝純 UI 序數 band。'

/** §8 opacity 是視覺 heuristic（τ=5），不是統計 confidence。 */
export const TEMPORAL_OPACITY_LINE =
  'Edge opacity increases monotonically with supporting patent count; τ=5 is a visualization heuristic.'

export function analysisScopeKeyOf(input: AnalysisScopeInput): string {
  const sorted = (values: readonly string[] | undefined) => [...(values ?? [])].sort().join(',')
  const year = input.year ? `${input.year[0]}-${input.year[1]}` : ''
  return `dataset=${sorted(input.dataset)}|source=${sorted(input.source)}|ipc=${sorted(input.ipc)}|unit=${input.unit ?? ''}|year=${year}`
}
