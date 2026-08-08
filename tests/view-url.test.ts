import { describe, expect, it } from 'vitest'
import { parseViewQuery, toViewQueryString, type ViewState } from '../lib/view-url'

const FULL: ViewState = {
  mode: 'concept',
  showSemantic: true,
  paperMode: false,
  colorMode: 'first_year',
  minSupport: 3,
  yearRange: [2010, 2020],
}

describe('toViewQueryString', () => {
  it('完整 view state 可被序列化，colorMode/minSupport/年份俱在', () => {
    const q = toViewQueryString(FULL)
    expect(q).toContain('mode=concept')
    expect(q).toContain('colorMode=first_year')
    expect(q).toContain('minSupport=3')
    expect(q).toContain('yearStart=2010')
    expect(q).toContain('yearEnd=2020')
    expect(q).toContain('llm=1')
  })
})

describe('parseViewQuery 與 toViewQueryString 互逆', () => {
  it('serialize → parse 再回原 view state', () => {
    const parsed = parseViewQuery(`?${toViewQueryString(FULL)}`)
    expect(parsed).toEqual(FULL)
  })
  it('可解析含前導 ? 的完整查詢字串', () => {
    expect(
      parseViewQuery(
        '?mode=context&colorMode=first_year&llm=0&minSupport=2&yearStart=2007&yearEnd=2025&paper=1',
      ),
    ).toEqual({
      mode: 'context',
      showSemantic: false,
      colorMode: 'first_year',
      minSupport: 2,
      yearRange: [2007, 2025],
      paperMode: true,
    })
  })
})

describe('parseViewQuery 容錯', () => {
  it('空字串／無關參數 → 空白', () => {
    expect(parseViewQuery('')).toEqual({})
    expect(parseViewQuery('?foo=bar')).toEqual({})
  })
  it('無效 mode／colorMode 不套用', () => {
    expect(parseViewQuery('?mode=banana')).toEqual({})
    expect(parseViewQuery('?colorMode=bubbles')).toEqual({})
    expect(parseViewQuery('?mode=context&colorMode=nope')).toEqual({ mode: 'context' })
  })
  it('minSupport 需 ≥1 的整數（0/負/小數/非數字不套用）', () => {
    expect(parseViewQuery('?minSupport=0')).toEqual({})
    expect(parseViewQuery('?minSupport=-3')).toEqual({})
    expect(parseViewQuery('?minSupport=1.5')).toEqual({})
    expect(parseViewQuery('?minSupport=abc')).toEqual({})
    expect(parseViewQuery('?minSupport=4')).toEqual({ minSupport: 4 })
  })
  it('yearRange 需兩有限數字且 start ≤ end（逆序不套用）', () => {
    expect(parseViewQuery('?yearStart=2025&yearEnd=2020')).toEqual({})
    expect(parseViewQuery('?yearStart=x&yearEnd=2020')).toEqual({})
    expect(parseViewQuery('?yearStart=2020&yearEnd=2025')).toEqual({
      yearRange: [2020, 2025],
    })
  })
  it('llm／paper 只接受明確 1／0', () => {
    expect(parseViewQuery('?llm=yes')).toEqual({})
    expect(parseViewQuery('?llm=1')).toEqual({ showSemantic: true })
    expect(parseViewQuery('?paper=1')).toEqual({ paperMode: true })
  })
})
describe('edgeWeight（線寬指標）', () => {
  it('缺省 jaccard 不掛 URL；npmi 掛 ew=NPMI 並可 round-trip', () => {
    const base = toViewQueryString({ ...fullDefaults(), edgeWeight: 'jaccard' })
    expect(base).not.toContain('ew=')
    const withNpmi = toViewQueryString({ ...fullDefaults(), edgeWeight: 'npmi' })
    expect(withNpmi).toContain('ew=npmi')
    const parsed = parseViewQuery(`?${withNpmi}`)
    expect(parsed.edgeWeight).toBe('npmi')
  })
  it('無效 edgeWeight 不套用', () => {
    expect(parseViewQuery('?ew=weight')).toEqual({})
  })
})

function fullDefaults(): import('./../lib/view-url').ViewState {
  return {
    mode: 'concept',
    showSemantic: false,
    paperMode: true,
    colorMode: 'community',
    minSupport: 2,
    yearRange: [2007, 2025],
  }
}

describe('unit（分析單位）', () => {
  it('缺省 patent 不掛 URL；applicant 掛 unit=applicant 並可 round-trip', () => {
    const base = toViewQueryString({ ...fullDefaults(), unit: 'patent' })
    expect(base).not.toContain('unit=')
    const withApp = toViewQueryString({ ...fullDefaults(), unit: 'applicant' })
    expect(withApp).toContain('unit=applicant')
    expect(parseViewQuery(`?${withApp}`).unit).toBe('applicant')
  })
  it('無效 unit 不套用', () => {
    expect(parseViewQuery('?unit=family')).toEqual({})
  })
})
describe('P2 來源檔（source= 多值）', () => {
  it('選定的來源檔 round-trip；未選不掛 URL', () => {
    const withSrc = toViewQueryString({ ...fullDefaults(), sourceFiles: ['fileA', 'fileB'] } as any)
    expect(withSrc).toContain('source=fileA')
    expect(withSrc).toContain('source=fileB')
    expect(parseViewQuery(`?${withSrc}`).sourceFiles).toEqual(['fileA', 'fileB'])
    const none = toViewQueryString(fullDefaults())
    expect(none).not.toContain('source=')
  })
})
