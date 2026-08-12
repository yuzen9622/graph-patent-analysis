import { describe, expect, it } from 'vitest'
import type { ConceptAggregate, ConceptNetworkResult } from '../lib/concept-network'
import {
  computeConceptStats,
  computeTimeWindow,
  gradientColor,
  isValidYear,
  parseFilingYear,
  RAINBOW_COLORS,
  UNKNOWN_YEAR_COLOR,
} from '../lib/concept-time'

function network(concepts: Record<string, string[]>): ConceptNetworkResult {
  const map = new Map<string, ConceptAggregate>()
  for (const [label, sourcePats] of Object.entries(concepts)) {
    map.set(label, { label, frequency: sourcePats.length, source_patents: [...sourcePats].sort() })
  }
  return { concepts: map, cooccurrenceEdges: [], semanticEdges: [] }
}

function years(pairs: Array<[string, number]>): Map<string, number> {
  return new Map(pairs)
}

describe('parseFilingYear / isValidYear', () => {
  it('取出前 4 碼；無申請日或非年開頭 → undefined', () => {
    expect(parseFilingYear('2020/01/01')).toBe(2020)
    expect(parseFilingYear('2020-03-05')).toBe(2020)
    expect(parseFilingYear(undefined)).toBeUndefined()
    expect(parseFilingYear('2020')).toBe(2020)
    expect(parseFilingYear('')).toBeUndefined()
  })
  it('isValidYear 限定 [1990, 今年+1]', () => {
    const current = new Date().getFullYear()
    expect(isValidYear(1990)).toBe(true)
    expect(isValidYear(current + 1)).toBe(true)
    expect(isValidYear(1989)).toBe(false)
    expect(isValidYear(current + 2)).toBe(false)
  })
})

describe('computeConceptStats', () => {
  it('偶數篇標準 median（[2015,2016,2018,2020] → 2017）', () => {
    const stats = computeConceptStats(
      network({ A: ['P1', 'P2', 'P3', 'P4'] }),
      years([['P1', 2015], ['P2', 2016], ['P3', 2018], ['P4', 2020]]),
    )
    expect(stats.get('A')).toMatchObject({
      first_year: 2015,
      last_year: 2020,
      q1_year: 2015,
      median_year: 2017,
      q3_year: 2018,
      median_loo_min: 2016,
      median_loo_max: 2018,
      year_counts: { '2015': 1, '2016': 1, '2018': 1, '2020': 1 },
    })
  })

  it('多重集合標準 median：重複年份保留（[2015,2020,2020,2020] → 2020，非 2015）', () => {
    const stats = computeConceptStats(
      network({ A: ['P1', 'P2', 'P3', 'P4'] }),
      years([['P1', 2015], ['P2', 2020], ['P3', 2020], ['P4', 2020]]),
    )
    expect(stats.get('A')?.median_year).toBe(2020)
    expect(stats.get('A')?.median_year).not.toBe(2015)
    expect(stats.get('A')?.year_counts).toEqual({ '2020': 3, '2015': 1 })
  })

  it('P1 合併後 source_patents 聯集的時間（同義詞兩篇年份併進）', () => {
    const stats = computeConceptStats(
      network({ A: ['P1', 'P2'] }),
      years([['P1', 2019], ['P2', 2021]]),
    )
    expect(stats.get('A')).toMatchObject({ first_year: 2019, last_year: 2021, median_year: 2020 })
  })

  it('有效年份之外不參與；全部無效 → 空統計', () => {
    const farFuture = new Date().getFullYear() + 9
    const stats = computeConceptStats(
      network({ A: ['P1', 'P2'], B: ['P3'] }),
      years([['P1', 1880], ['P2', farFuture], ['P3', 2020]]),
    )
    expect(stats.get('A')).toEqual({})
    expect(stats.get('B')).toMatchObject({ first_year: 2020 })
  })

  it('無年份專利不參與統計', () => {
    const stats = computeConceptStats(
      network({ A: ['P1', 'P2'] }),
      years([['P1', 2018]]), // P2 無年份
    )
    expect(stats.get('A')).toMatchObject({ first_year: 2018, last_year: 2018 })
  })
})

describe('computeTimeWindow', () => {
  it('取所有有 first_year 概念的最小/最大', () => {
    const stats = computeConceptStats(
      network({ A: ['P1'], B: ['P2'], C: ['P3'] }),
      years([['P1', 2007], ['P2', 2025], ['P3', 2019]]),
    )
    expect(computeTimeWindow(stats)).toEqual([2007, 2025])
  })
  it('無任何概念有年份 → null', () => {
    expect(computeTimeWindow(computeConceptStats(network({ A: [] }), years([])))).toBeNull()
  })
})

describe('gradientColor', () => {
  const window: [number, number] = [2007, 2025]

  it('首/尾年精確命中錨色[0]／[6]', () => {
    expect(gradientColor(2007, window)).toBe(RAINBOW_COLORS[0])
    expect(gradientColor(2025, window)).toBe(RAINBOW_COLORS[6])
  })
  it('first_year=2016 → t=0.5 → 錨色[3]（中間色）', () => {
    expect(gradientColor(2016, window)).toBe(RAINBOW_COLORS[3])
  })
  it('t 越界 clamp；window null 或無年份 → 灰', () => {
    expect(gradientColor(1800, window)).toBe(RAINBOW_COLORS[0])
    expect(gradientColor(3000, window)).toBe(RAINBOW_COLORS[6])
    expect(gradientColor(undefined, window)).toBe(UNKNOWN_YEAR_COLOR)
    expect(gradientColor(2016, null)).toBe(UNKNOWN_YEAR_COLOR)
  })
  it('span=0（全部同一年）→ 全落錨色[0]', () => {
    expect(gradientColor(2020, [2020, 2020])).toBe(RAINBOW_COLORS[0])
  })
  it('錨點之間是漸變中間色（OKLab 插值，不是任一錨色）', () => {
    // window [2007,2025] span=18：2011 → t=(2011-2007)/18=0.2222 → pos=1.333
    // → 在錨色[1]（橙）與錨色[2]（黃）之間；2013 → t=1/3 → pos=2 → 精確命中錨色[2]
    const between = gradientColor(2011, window)
    expect(between).not.toBe(RAINBOW_COLORS[1])
    expect(between).not.toBe(RAINBOW_COLORS[2])
    expect(gradientColor(2013, window)).toBe(RAINBOW_COLORS[2])
    // 同一錨點區間內，年份越近中間色越接近錨色（漸變單調）
    const nearOrange = gradientColor(2008, window)
    const nearYellow = gradientColor(2012, window)
    expect(nearOrange).not.toBe(nearYellow)
  })
  it('純函式：相同輸入兩次結果相同', () => {
    expect(gradientColor(2016, window)).toBe(gradientColor(2016, window))
  })
  it('換一組資料 → window 隨之改變（不寫死）', () => {
    const a = computeTimeWindow(computeConceptStats(network({ A: ['P1'] }), years([['P1', 2010]])))
    const b = computeTimeWindow(computeConceptStats(network({ A: ['P1'] }), years([['P1', 2019]])))
    expect(a).toEqual([2010, 2010])
    expect(b).toEqual([2019, 2019])
  })
})