// lib/concept-time.ts — PRD v2 / P3 概念時間
//
// 給每個概念節點算出時間元資料（first/last/median_year、year_counts），
// 並提供「依首次出現年份漸層著色」的純函式。全部純函式、可測、不碰 DOM/DB。
//
// 設計要點（docs/PRD-v2-P3-概念時間.md）：
//  - 母體 = 多重集合：每個有「有效年份」的專利各貢獻一個年份，重複必須保留。
//    不是 year_counts 的鍵集，否則中位數算錯（[2015,2020,2020,2020] → 2020）。
//  - 有效年份 = [1990, 今年+1]，與 P0 §3.1 的 date_out_of_range 門檻同源；
//    防止單筆髒資料把漸層窗綁架（B5）。
//  - 漸層映射 = sRGB 逐通道線性插值 + Math.round；9 個錨色為常數（B4）。
//  - GraphNode.color / concepts.color 永遠是社群色，漸層只活在 view 層（B1）。

import type { ConceptNetworkResult } from './concept-network'
import { leaveOneOutMedianSpan, medianStandard, quartiles } from './temporal'

/** sequential_blue：9 個錨色（常數，方法圖例要印名稱）。 */
export const SEQUENTIAL_BLUE = [
  '#EFF6FF',
  '#DBEAFE',
  '#BFDBFE',
  '#93C5FD',
  '#60A5FA',
  '#3B82F6',
  '#2563EB',
  '#1D4ED8',
  '#1E3A8A',
] as const

/** 年份未知概念 / 社群模式缺省的灰色。 */
export const UNKNOWN_YEAR_COLOR = '#BAB0AC'

export const VALID_YEAR_MIN = 1990
export const VALID_YEAR_MAX = () => new Date().getFullYear() + 1

/**
 * 申請年解析：取 filing_date 前 4 碼為整數年。純解析，不做值域過濾
 * （值域由 isValidYear 決定），與 graph-builder 共用同一實作（N3）。
 */
export function parseFilingYear(filingDate?: string): number | undefined {
  if (!filingDate) return undefined
  const match = /^(\d{4})/.exec(filingDate)
  if (!match) return undefined
  const year = Number(match[1])
  return Number.isFinite(year) ? year : undefined
}

/** 有效年份判準：[1990, 今年+1]，與 P0 §3.1 門檻同源（B5）。 */
export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= VALID_YEAR_MIN && year <= VALID_YEAR_MAX()
}

export interface ConceptYearStats {
  /** 首次有效申請年。 */
  first_year?: number
  /** 最近有效申請年。 */
  last_year?: number
  /** 第一／第三四分位數（nearest-rank，多重集合）。 */
  q1_year?: number
  q3_year?: number
  /** 中位有效申請年（標準 median，偶數篇取中間兩值平均）。 */
  median_year?: number
  /** leave-one-out median 的可能範圍；v1 僅保存、不改箭頭。 */
  median_loo_min?: number
  median_loo_max?: number
  /** 年度分布 {year: count}；count = 該年不同專利數。 */
  year_counts?: Record<string, number>
}

/**
 * 由合併後的概念網路 + 「專利 id → 申請年」計算每個概念的統計。
 * 母體為多重集合（相同申請年保留）；有效年份之外、無年份者不參與。
 */
export function computeConceptStats(
  conceptNetwork: ConceptNetworkResult,
  yearsByPatent: Map<string, number>,
): Map<string, ConceptYearStats> {
  const out = new Map<string, ConceptYearStats>()
  for (const [label, aggregate] of conceptNetwork.concepts) {
    const years: number[] = []
    const counts = new Map<number, number>()
    for (const patentId of aggregate.source_patents) {
      const year = yearsByPatent.get(patentId)
      if (year === undefined || !isValidYear(year)) continue
      years.push(year)
      counts.set(year, (counts.get(year) ?? 0) + 1)
    }
    if (years.length === 0) {
      out.set(label, {})
      continue
    }
    const yearCounts: Record<string, number> = {}
    for (const [y, c] of counts) yearCounts[String(y)] = c
    const qs = quartiles(years)
    const loo = leaveOneOutMedianSpan(years)
    out.set(label, {
      first_year: Math.min(...years),
      q1_year: qs.q1,
      median_year: medianStandard(years),
      q3_year: qs.q3,
      last_year: Math.max(...years),
      median_loo_min: loo?.min,
      median_loo_max: loo?.max,
      year_counts: yearCounts,
    })
  }
  return out
}

/** 漸層窗 = 所有有 first_year 概念的最小/最大；無任何概念有年份 → null。 */
export function computeTimeWindow(stats: Map<string, ConceptYearStats>): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const stat of stats.values()) {
    if (stat.first_year === undefined) continue
    if (stat.first_year < min) min = stat.first_year
    if (stat.first_year > max) max = stat.first_year
  }
  return Number.isFinite(min) ? [min, max] : null
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')
  )
}

/**
 * first_year → 色。sRGB 逐通道線性插值 + Math.round。
 * window 為 null 或無年份 → 灰（UNKNOWN_YEAR_COLOR）。
 * 純函式：相同 t 兩次呼叫結果相同；t == 錨點座標時精確命中該錨色（B4）。
 */
export function gradientColor(
  firstYear: number | undefined,
  window: [number, number] | null,
): string {
  if (window === null || firstYear === undefined) return UNKNOWN_YEAR_COLOR
  const n = SEQUENTIAL_BLUE.length
  const span = window[1] - window[0]
  const t = span > 0 ? Math.min(1, Math.max(0, (firstYear - window[0]) / span)) : 0
  const pos = t * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(n - 1, lo + 1)
  const f = pos - lo
  const a = hexToRgb(SEQUENTIAL_BLUE[lo]!)
  const b = hexToRgb(SEQUENTIAL_BLUE[hi]!)
  return rgbToHex([
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ])
}