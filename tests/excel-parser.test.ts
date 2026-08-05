/**
 * excel-parser.test.ts — PRD v2 / P0 §8
 *
 * ===========================================================================
 * FIXTURES
 * ===========================================================================
 *
 * `tests/fixtures/format-a-baseline.json`
 *   The first 50 `PatentRow`s produced by the PRE-CHANGE (v1.2) parser from
 *   `專利爬蟲.xlsx`, with `id` omitted because §4.5 deliberately redefines it.
 *   Captured BEFORE lib/excel-parser.ts was touched — capturing it afterwards
 *   would make the regression test tautological.
 *
 * `tests/fixtures/format-b-sample.xlsx`
 *   A 45-data-row slice of the teacher's `專利彙整(全) (1).xlsx` (`原始資料`
 *   sheet, all 83 columns preserved), written by a one-shot script that is NOT
 *   part of the repository. The workbook also carries a 6-row `雷達圖分析`
 *   decoy — whose header genuinely contains `IPC5-1` — placed BEFORE
 *   `原始資料`, plus a stub `發明人合併`, so that sheet selection is exercised
 *   for real. Rows were picked (source row index → what it proves):
 *
 *     0    M628244  申請日 44196 → 2020-12-31 (the §3.1 baseline); IPC5-2 has a
 *                   leading space; IPC3-1/2 have leading spaces
 *     1    M627502  摘要 begins with U+FEFF (BOM case 1)
 *     2    M625319  申請日 44558 → 2021-12-28 (latest serial in the file)
 *     3    M626491  21 populated 發明人 columns — the numbered-column scan must
 *                   not hard-code 13/21; BOM case 2
 *     9    M624541  IPC5-3 = `G06K-09/00`   (2-digit main group)
 *     31   M622932  IPC5-3 = `G06K-009/00`  (3-digit main group) — must collapse
 *                   onto the same key as row 9; BOM case 3
 *     54   M616135  IPC5-5 = `H02M -001/42` (space between subclass and group)
 *     77   I748919  IPC5-1 = `H04L-0009/12` (4-digit main group)
 *     80   D206382  設計專利 1: D-prefixed 專利編號 AND a 設計分類號 (11-02);
 *                   参考文獻 mix of `TWD199419` + foreign CN/JP values
 *     120  M603593  IPC5-1 prefixed with a TAB
 *     127  M602259  參考文獻 `美國60/168,89419991203` (irregular, contains CJK)
 *     128  M601439  rule 1a pair (a) — same 專利編號 and title as row 129 but
 *     129  M601439  different IPC5-1, applicant and abstract length; merging
 *                   must union the IPC set, union the applicants, keep the
 *                   longest abstract, and raise applicant_identity_conflicts
 *     136  M601398  申請號 109208236 — the cross-format merge partner of the
 *                   format-A fixture row
 *     213  M599438  設計分類號 47-22 while 專利編號 is NOT D-prefixed
 *     285  M598996  rule 1b pair — same 專利編號 (申請號 109202820), different
 *     286  M598996  title, same 申請日 → must NOT merge, must not share an id
 *     320  M596401  IPC5-1 ends with a stray `\`
 *     333  M596933  被參考次數 = 1
 *     374  I691863  參考文獻 `TWM563592U` → resolves internally after the `U`
 *                   suffix is stripped (target is row 1148)
 *     378  D207415  設計專利 2: D-prefixed 專利編號 with an EMPTY 設計分類號
 *     595  M588287  rule 1b pair — same 專利編號 (申請號 108211626), different
 *     596  M588287  title AND different 申請日 → must NOT merge
 *     776  M589855  two populated 申請人 columns
 *     848  M580734  IPC5-3 ends with a stray `.`
 *     859  M580752  three 參考文獻 that all resolve internally (rows 1585/1538/1090)
 *     1017 M572519  設計分類號 with a leading TAB
 *     1090 M568445  citation target of row 859
 *     1148 M563592  citation target of row 374
 *     1270 I699723  IPC5-1 ends with a stray `(`
 *     1511 M555518  案件狀態 = 消滅; 專利編號 and IPC5-1 both end with a TAB
 *     1538 M547716  citation target of row 859
 *     1575 M546543  rule 1c pair — 申請號 106201453 shared with row 1576 but a
 *     1576 M541619  DIFFERENT 專利編號 and a different real patent → must NOT
 *                   merge, must not share an id, must raise appno_collisions
 *     1585 M545320  citation target of row 859
 *     1620 I636415  申請人1 ends with `\r\n`, 申請人2 populated
 *     1752 M530992  參考文獻 `中華民國10520737020160519` (irregular, CJK)
 *     1847 D157355  設計專利 whose IPC5-1 is whitespace only → no ipc5 at all
 *     1851 D149298  案件狀態 = 消滅 on a design patent
 *     1861 I470569  參考文獻 `新加坡10201801787S20180305` (irregular, CJK)
 *     1868 I254869  申請日 38016 → 2004-01-30 (earliest serial in the file)
 *     1869 (blank)  trailing blank row: only 案件狀態 = 未審查/公開
 *     1870 (blank)  trailing blank row: only 案件狀態 = 未審查/公開
 *     1886 (blank)  trailing blank row: only 案件狀態 = 核駁
 *
 *   Plus ONE clearly-marked SYNTHETIC row (`M900001`, 專利名稱 prefixed
 *   「【合成列】」): none of the 3081 non-empty IPC5 values in the real file is
 *   subclass-only, so `ipc_depth === 3` has no natural representative and would
 *   otherwise be untestable end-to-end.
 *
 * `tests/fixtures/format-a-sample.xlsx`
 *   Three rows of `專利爬蟲.xlsx` (`專利清單`), including 申請號 `TW109208236`,
 *   the cross-format merge partner of format-B row 136.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import applicantMergeFixture from './fixtures/t2-applicant-merge-regression.json'
import {
  parseExcel,
  parseExcelFiles,
  dedupePatents,
  cleanApplicantName,
  normalizeApplicantName,
  normalizeApplicationNumber,
  normalizePatentNumber,
  normalizeTitleKey,
  normalizeReference,
  isUsableReference,
  normalizeIpc5,
  excelSerialToISODate,
  stripBom,
  sha1hex,
  numberedColumns,
  selectFormatBSheet,
  qualifiesAsFormatBSheet,
  isBlacklistedSheet,
  decideMerge,
  stablePatentId,
  type ParseResult,
} from '@/lib/excel-parser'
import { buildConceptNetwork } from '@/lib/concept-network'
import { detectCommunities } from '@/lib/community'
import { buildGraph } from '@/lib/graph-builder'
import type { PatentRow } from '@/types/graph'

const ROOT = path.resolve(__dirname, '..')
const FIXTURES = path.join(ROOT, 'tests', 'fixtures')

function buffer(file: string): ArrayBuffer {
  const b = fs.readFileSync(file)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

const formatBBuffer = () => buffer(path.join(FIXTURES, 'format-b-sample.xlsx'))
const formatABuffer = () => buffer(path.join(FIXTURES, 'format-a-sample.xlsx'))

let cachedB: ParseResult | undefined
function parsedB(): ParseResult {
  cachedB ??= parseExcel(formatBBuffer(), 'format-b-sample.xlsx')
  return cachedB
}

const byPatentNumber = (r: ParseResult, pn: string) =>
  r.patents.filter(p => p.patent_number === pn)
const onePatent = (r: ParseResult, pn: string) => {
  const hits = byPatentNumber(r, pn)
  expect(hits, `expected exactly one row for ${pn}`).toHaveLength(1)
  return hits[0]
}

// ===========================================================================
// sha1 (§4.5 depends on it being a real SHA-1)
// ===========================================================================
describe('sha1hex', () => {
  it('matches node:crypto for ASCII, CJK and multi-block inputs', () => {
    const cases = [
      '',
      'abc',
      '在地生活即時行銷系統',
      'pn|M628244|智能綜合風險資訊分析及警示系統',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'x'.repeat(1000),
      '摘要'.repeat(500),
    ]
    for (const s of cases) {
      expect(sha1hex(s), s.slice(0, 20)).toBe(crypto.createHash('sha1').update(s, 'utf8').digest('hex'))
    }
  })
})

// ===========================================================================
// §3.1 dates
// ===========================================================================
describe('excelSerialToISODate (§3.1)', () => {
  it('uses the three cross-checked baselines', () => {
    // 44196 is 2020-12-31, NOT 2021-01-01. Verified against
    // XLSX.SSF.parse_date_code() and the cell's cached display value "12/31/20".
    expect(excelSerialToISODate(44196)).toBe('2020-12-31')
    expect(excelSerialToISODate(38016)).toBe('2004-01-30')
    expect(excelSerialToISODate(44558)).toBe('2021-12-28')
  })

  it('rejects non-dates', () => {
    expect(excelSerialToISODate(0)).toBeUndefined()
    expect(excelSerialToISODate(-1)).toBeUndefined()
    expect(excelSerialToISODate(Number.NaN)).toBeUndefined()
  })
})

// ===========================================================================
// §3.2 IPC normalisation
// ===========================================================================
describe('normalizeIpc5 (§3.2)', () => {
  it('normalises every sample pattern', () => {
    expect(normalizeIpc5('G06Q-010/10')).toEqual({ key: 'G06Q10/10', depth: 5 })
    expect(normalizeIpc5('G06Q-010/103')).toEqual({ key: 'G06Q10/103', depth: 5 })
    expect(normalizeIpc5('G06Q-010/1035')).toEqual({ key: 'G06Q10/1035', depth: 5 })
    expect(normalizeIpc5('G06Q-010/1')).toEqual({ key: 'G06Q10/1', depth: 5 })
    expect(normalizeIpc5('H04L-0009/12')).toEqual({ key: 'H04L9/12', depth: 5 })
  })

  it('collapses the two zero-padding spellings of the same class (step 5)', () => {
    // Both spellings really are present in the sample file (rows 9 and 31).
    // Without the leading-zero strip they split into two IPC groups.
    expect(normalizeIpc5('G06K-09/00')!.key).toBe('G06K9/00')
    expect(normalizeIpc5('G06K-009/00')!.key).toBe('G06K9/00')
    expect(normalizeIpc5('G06K-09/00')!.key).toBe(normalizeIpc5('G06K-009/00')!.key)
  })

  it('strips trailing junk, leading whitespace and internal spaces (steps 2-3)', () => {
    expect(normalizeIpc5('G06Q-020/38\\')!.key).toBe('G06Q20/38')
    expect(normalizeIpc5('H04L-009/32.')!.key).toBe('H04L9/32')
    expect(normalizeIpc5('G06Q-040/00(')!.key).toBe('G06Q40/00')
    expect(normalizeIpc5(' G06Q-040/04')!.key).toBe('G06Q40/04')
    expect(normalizeIpc5('\tG06Q-050/26')!.key).toBe('G06Q50/26')
    expect(normalizeIpc5('H02M -001/42')!.key).toBe('H02M1/42')
  })

  it('strips a parenthesised edition suffix before the trailing-junk pass', () => {
    // Defensive: absent from this sample, but stripping `[^A-Z0-9/]+$` first
    // would eat the `)` and leave an unrecoverable `G06Q-040/00 (2012.01`.
    expect(normalizeIpc5('G06Q-040/00 (2012.01)')!.key).toBe('G06Q40/00')
  })

  it('accepts subclass-only values at depth 3', () => {
    expect(normalizeIpc5('G06Q')).toEqual({ key: 'G06Q', depth: 3 })
    expect(normalizeIpc5(' g06q ')).toEqual({ key: 'G06Q', depth: 3 })
  })

  it('validates against the WHOLE string, not a prefix', () => {
    expect(normalizeIpc5('G06Q-010/10 and more')).toBeNull()
    expect(normalizeIpc5('XG06Q-010/10')).toBeNull()
    expect(normalizeIpc5('G06Q-010/10/10')).toBeNull()
    expect(normalizeIpc5('Z99Z-010/10')).toBeNull()   // Z is outside [A-H]
    expect(normalizeIpc5('')).toBeNull()
    expect(normalizeIpc5('   ')).toBeNull()
    expect(normalizeIpc5('ZZZ')).toBeNull()
  })
})

// ===========================================================================
// §3.3 BOM
// ===========================================================================
describe('stripBom (§3.3)', () => {
  it('removes a leading BOM and zero-width run only', () => {
    expect(stripBom('﻿本新型提供')).toBe('本新型提供')
    expect(stripBom('﻿​本新型')).toBe('本新型')
    expect(stripBom('本新型﻿提供')).toBe('本新型﻿提供')
    expect(stripBom('本新型提供')).toBe('本新型提供')
  })
})

// ===========================================================================
// §3.5 references
// ===========================================================================
describe('normalizeReference (§3.5)', () => {
  it('strips TW and a trailing U', () => {
    expect(normalizeReference('TWM563592U')).toBe('M563592')
    expect(normalizeReference('M563592')).toBe('M563592')
    expect(normalizeReference('TWD199419')).toBe('D199419')
  })

  it('never fuses two patent types that share a number', () => {
    // Dropping the D/M/I type letter would make these the same citation.
    expect(normalizeReference('D199419')).not.toBe(normalizeReference('M199419'))
    expect(normalizeReference('D199419')).toBe('D199419')
    expect(normalizeReference('M199419')).toBe('M199419')
    expect(normalizeReference('I199419')).toBe('I199419')
  })

  it('treats CJK free-text citations as unusable but keeps foreign numbers', () => {
    expect(isUsableReference('美國60/168,89419991203')).toBe(false)
    expect(isUsableReference('中華民國10520737020160519')).toBe(false)
    expect(isUsableReference('新加坡10201801787S20180305')).toBe(false)
    expect(isUsableReference('CN304408049')).toBe(true)
    expect(isUsableReference('US2017/0041332A1')).toBe(true)
    expect(isUsableReference('TW201502845A')).toBe(true)
    expect(isUsableReference('')).toBe(false)
  })
})

// ===========================================================================
// §4.1 identifier normalisation
// ===========================================================================
describe('identifier normalisation (§4.1)', () => {
  it('makes format A and format B application numbers comparable', () => {
    expect(normalizeApplicationNumber('TW109208236')).toBe('109208236')
    expect(normalizeApplicationNumber('109208236')).toBe('109208236')
    expect(normalizeApplicationNumber('TW109208236')).toBe(normalizeApplicationNumber('109208236'))
    expect(normalizeApplicationNumber('  ')).toBeNull()
    expect(normalizeApplicationNumber(undefined)).toBeNull()
  })

  it('keeps the patent type letter but drops TW and the U suffix', () => {
    expect(normalizePatentNumber('TWM628244U')).toBe('M628244')
    expect(normalizePatentNumber('M555518\t')).toBe('M555518')
    expect(normalizePatentNumber('D199419')).not.toBe(normalizePatentNumber('M199419'))
  })

  it('folds whitespace, width and punctuation into the title key', () => {
    expect(normalizeTitleKey('在地生活 即時行銷系統')).toBe(normalizeTitleKey('在地生活即時行銷系統'))
    expect(normalizeTitleKey('ＢＣＡ記錄裝置')).toBe(normalizeTitleKey('BCA記錄裝置'))
    expect(normalizeTitleKey('公仔（三）')).toBe(normalizeTitleKey('公仔三'))
  })

  it('produces merge keys for applicants without touching the display value', () => {
    expect(normalizeApplicantName('臺灣銀行股份有限公司')).toBe(normalizeApplicantName('臺灣銀行有限公司'))
    expect(normalizeApplicantName('台新金融控股股份有限公司\r\n')).toBe(
      normalizeApplicantName('台新金融控股股份有限公司'),
    )
    expect(normalizeApplicantName('ＪＸ金屬股份有限公司')).toBe(normalizeApplicantName('JX金屬股份有限公司'))
    // …but cleanApplicantName(), which DOES feed the display value, must not fold width.
    expect(cleanApplicantName('ＪＸ金屬股份有限公司')).toBe('ＪＸ金屬股份有限公司')
  })
})

// ===========================================================================
// §1 sheet selection
// ===========================================================================
describe('format-B sheet selection (§1)', () => {
  const radar: string[] = ['申請號', '證書號', '申請年', '申請人1', 'IPC5-1', 'IPC5-2', 'IPC3-1']
  const real: string[] = ['專利編號', '公告/公開日', '申請號', '專利名稱', '申請日', 'IPC5-1', '摘要', '案件狀態']

  it('blacklists the sheets that must never be read or chosen', () => {
    for (const n of [
      '發明人合併', '雷達圖分析', 'IPC3分析', 'IPC5分析',
      '專利件數分析-專利歷年趨勢分析-申請年', '專利權人別分析', '發明人別分析',
    ]) {
      expect(isBlacklistedSheet(n), n).toBe(true)
    }
    expect(isBlacklistedSheet('原始資料')).toBe(false)
    expect(isBlacklistedSheet('專利清單')).toBe(false)
  })

  it('rejects 雷達圖分析 even though its header really does contain IPC5-1', () => {
    // All four §1-3 conditions must hold at once. Only checking the IPC5-1
    // fingerprint would select this sheet and the user would be told
    // "缺少必要欄位" with no clue why.
    expect(qualifiesAsFormatBSheet({ name: '雷達圖分析', headers: radar, nonEmptyRows: 1559 })).toBe(false)
    // Even renamed, it still fails on the missing 摘要/專利名稱 columns.
    expect(qualifiesAsFormatBSheet({ name: '某分析表', headers: radar, nonEmptyRows: 1559 })).toBe(false)
  })

  it('requires more than 500 non-empty rows in the fallback', () => {
    expect(qualifiesAsFormatBSheet({ name: '匯出', headers: real, nonEmptyRows: 501 })).toBe(true)
    expect(qualifiesAsFormatBSheet({ name: '匯出', headers: real, nonEmptyRows: 500 })).toBe(false)
  })

  it('prefers 原始資料 by name over any fallback candidate', () => {
    expect(selectFormatBSheet([
      { name: '雷達圖分析', headers: radar, nonEmptyRows: 1559 },
      { name: '原始資料', headers: real, nonEmptyRows: 1888 },
      { name: '匯出', headers: real, nonEmptyRows: 900 },
    ])).toBe('原始資料')
  })

  it('falls back to the only qualifying sheet when 原始資料 is absent', () => {
    expect(selectFormatBSheet([
      { name: '發明人合併', headers: real, nonEmptyRows: 1048576 },
      { name: '雷達圖分析', headers: radar, nonEmptyRows: 1559 },
      { name: '匯出', headers: real, nonEmptyRows: 900 },
    ])).toBe('匯出')
  })

  it('returns null when nothing qualifies', () => {
    expect(selectFormatBSheet([{ name: '雷達圖分析', headers: radar, nonEmptyRows: 1559 }])).toBeNull()
  })

  it('picks 原始資料 out of the real fixture, past the 雷達圖分析 decoy', () => {
    const r = parsedB()
    expect(r.format).toBe('B')
    expect(r.sheet_name).toBe('原始資料')
    expect(r.errors).toEqual([])
  })
})

// ===========================================================================
// §2 numbered column groups
// ===========================================================================
describe('numberedColumns (§2)', () => {
  it('orders numerically and never assumes a fixed width', () => {
    expect(numberedColumns(['發明人1', '發明人10', '發明人2', '發明人21', '摘要'], '發明人'))
      .toEqual(['發明人1', '發明人2', '發明人10', '發明人21'])
    expect(numberedColumns(['IPC5-1', 'IPC5-13', 'IPC5-2', 'IPC3-1'], 'IPC5'))
      .toEqual(['IPC5-1', 'IPC5-2', 'IPC5-13'])
    // must not be confused by a repeated-header suffix
    expect(numberedColumns(['專利編號', '專利編號_1'], '專利編號')).toEqual([])
  })
})

// ===========================================================================
// §4.3 the ordered decision procedure, all nine branches
// ===========================================================================
describe('decideMerge — §4.3 first-match-wins', () => {
  const S = (pn: string | null, an: string | null, tk: string) => ({ pn, an, tk })

  it('1a: same pn, same title → merge', () => {
    expect(decideMerge(S('M601439', '109208662', 'T'), S('M601439', '109208662', 'T')))
      .toEqual({ merge: true })
  })

  it('1b: same pn, different title → no merge + patno_title_conflicts', () => {
    expect(decideMerge(S('M588287', '108211626', 'T1'), S('M588287', '108211626', 'T2')))
      .toEqual({ merge: false, warn: 'patno_title_conflicts' })
  })

  it('1c: different pn → no merge, and an collision is reported', () => {
    expect(decideMerge(S('M546543', '106201453', 'T1'), S('M541619', '106201453', 'T2')))
      .toEqual({ merge: false, warn: 'appno_collisions' })
    // Rule 1 is evaluated before rule 2, so a shared title cannot rescue it.
    expect(decideMerge(S('M546543', '106201453', 'T'), S('M541619', '106201453', 'T')))
      .toEqual({ merge: false, warn: 'appno_collisions' })
    // Different pn AND different an → silent, this is the normal case.
    expect(decideMerge(S('M1', 'A1', 'T'), S('M2', 'A2', 'T')))
      .toEqual({ merge: false, warn: null })
  })

  it('2a: one side has no pn, same an, same title → merge (the cross-format path)', () => {
    expect(decideMerge(S(null, '109208236', 'T'), S('M601398', '109208236', 'T')))
      .toEqual({ merge: true })
    expect(decideMerge(S(null, '109208236', 'T'), S(null, '109208236', 'T')))
      .toEqual({ merge: true })
  })

  it('2b: same an, different title → no merge + appno_collisions', () => {
    expect(decideMerge(S(null, '094124377', 'T1'), S(null, '094124377', 'T2')))
      .toEqual({ merge: false, warn: 'appno_collisions' })
  })

  it('2c: different an → no merge, no warning', () => {
    expect(decideMerge(S(null, 'A1', 'T'), S(null, 'A2', 'T')))
      .toEqual({ merge: false, warn: null })
  })

  it('3: at least one side has neither identifier → no merge', () => {
    expect(decideMerge(S(null, null, 'T'), S(null, 'A1', 'T'))).toEqual({ merge: false, warn: null })
    expect(decideMerge(S(null, null, 'T'), S(null, null, 'T'))).toEqual({ merge: false, warn: null })
    expect(decideMerge(S(null, null, 'T'), S('M1', 'A1', 'T'))).toEqual({ merge: false, warn: null })
  })
})

// ===========================================================================
// §4.5 stable ids
// ===========================================================================
describe('stablePatentId (§4.5)', () => {
  const base = (over: Partial<PatentRow> = {}): PatentRow => ({
    id: '', title: 'T', abstract: 'A', applicant: '', ...over,
  })

  it('hashes the WHOLE identity key, not just the identifier', () => {
    expect(stablePatentId(base({ patent_number: 'M628244' })))
      .toBe(sha1hex(`pn|M628244|${normalizeTitleKey('T')}`))
    expect(stablePatentId(base({ application_number: 'TW109208236' })))
      .toBe(sha1hex(`an|109208236|${normalizeTitleKey('T')}`))
  })

  it('rule 1b: same patent number, different title → DIFFERENT id', () => {
    // Sharing an id here would collide on patents UNIQUE (analysis_id, node_id),
    // and insertRows() has no ON CONFLICT clause, so the whole analysis would
    // roll back after the LLM cost had already been paid.
    const a = stablePatentId(base({ patent_number: 'M588287', title: '程式版本管理系統' }))
    const b = stablePatentId(base({ patent_number: 'M588287', title: '用於計算臉部辨識的FAR及FRR的系統' }))
    expect(a).not.toBe(b)
  })

  it('noid branch: same title, different abstract → DIFFERENT id', () => {
    const a = stablePatentId(base({ title: '同名', abstract: '摘要一' }))
    const b = stablePatentId(base({ title: '同名', abstract: '摘要二' }))
    expect(a).not.toBe(b)
  })

  it('noid branch: applicants and filing date also enter the key', () => {
    const a = stablePatentId(base({ applicants: ['甲公司'] }))
    const b = stablePatentId(base({ applicants: ['乙公司'] }))
    const c = stablePatentId(base({ applicants: ['甲公司'], filing_date: '2020-01-01' }))
    expect(new Set([a, b, c]).size).toBe(3)
    // applicant order must not matter
    expect(stablePatentId(base({ applicants: ['甲', '乙'] })))
      .toBe(stablePatentId(base({ applicants: ['乙', '甲'] })))
  })

  it('prefers pn over an over noid, and normalises before hashing', () => {
    expect(stablePatentId(base({ patent_number: 'TWM628244U', application_number: 'TW111201471' })))
      .toBe(stablePatentId(base({ patent_number: 'M628244' })))
  })

  it('is a 40-hex-digit sha1, with the patent: prefix added by the graph builder', () => {
    expect(stablePatentId(base({ patent_number: 'M1' }))).toMatch(/^[0-9a-f]{40}$/)
  })
})

// ===========================================================================
// §7-5 format A regression
// ===========================================================================
describe('format A regression (§7-5)', () => {
  const CRAWLER = path.join(ROOT, '專利爬蟲.xlsx')
  const KEYS = [
    'title', 'abstract', 'applicant', 'applicant_raw',
    'filing_date', 'application_number', 'search_keyword',
  ] as const

  it.skipIf(!fs.existsSync(CRAWLER))(
    'reproduces the pre-v2 first 50 rows byte for byte',
    () => {
      const baseline = JSON.parse(
        fs.readFileSync(path.join(FIXTURES, 'format-a-baseline.json'), 'utf8'),
      ) as Array<Record<string, string>>
      // dedupe:false is the pre-v2 shape: one row per spreadsheet row, sheet order.
      const r = parseExcel(buffer(CRAWLER), '專利爬蟲.xlsx', { dedupe: false })
      expect(r.format).toBe('A')
      expect(r.sheet_name).toBe('專利清單')
      expect(r.total_rows).toBe(1500)
      expect(r.valid_rows).toBe(1500)
      expect(r.errors).toEqual([])
      expect(baseline).toHaveLength(50)

      const actual = r.patents.slice(0, 50).map(p => {
        const o: Record<string, string> = {}
        for (const k of KEYS) if (p[k] !== undefined) o[k] = p[k] as string
        return o
      })
      expect(actual).toEqual(baseline)
    },
  )

  it('keeps the v1.2 applicant cleaning rules', () => {
    expect(cleanApplicantName('臺灣新光商業銀行股份有限公司 臺北市信義區松仁路36號 (中華民國) (TW)'))
      .toBe('臺灣新光商業銀行股份有限公司')
    expect(cleanApplicantName('某公司（子公司）')).toBe('某公司')
    expect(cleanApplicantName('某公司　地址')).toBe('某公司')
  })

  it('splits, cleans and rejoins multi-applicant cells with ；', () => {
    const r = parseExcel(formatABuffer(), 'format-a-sample.xlsx', { dedupe: false })
    expect(r.format).toBe('A')
    for (const p of r.patents) {
      expect(p.applicant).not.toMatch(/[ 　]/)
      expect(p.applicant_raw).toBeDefined()
    }
  })
})

// ===========================================================================
// §1 / §2 / §3 format B parsing
// ===========================================================================
describe('format B parsing', () => {
  it('drops the trailing blank rows before any statistic is taken (§1)', () => {
    const r = parsedB()
    // 45 spreadsheet rows: 42 real patents + 3 trailing blanks.
    expect(r.total_rows).toBe(45)
    expect(r.valid_rows).toBe(42)
    // Had the blanks been counted, 案件狀態 would show 未審查/公開 and 核駁 —
    // two values no real patent in the source file has.
    expect([...new Set(r.patents.map(p => p.case_status))].sort()).toEqual(['核准', '消滅'])
  })

  it('maps the 83 columns and reports the ones it deliberately ignores (§2)', () => {
    const r = parsedB()
    // 專利編號 appears twice; sheet_to_json renames the second to 專利編號_1 and
    // §2 says to take one of the two identical columns.
    expect(r.unmapped_columns).toEqual(['專利編號_1', '公報分卷期', '優先權'])
    const mapped = Object.fromEntries(r.field_mappings.map(m => [m.field, m.matched_column]))
    expect(mapped.title).toBe('專利名稱')
    expect(mapped.abstract).toBe('摘要')
    expect(mapped.application_number).toBe('申請號')
    expect(mapped.filing_date).toBe('申請日')
  })

  it('converts Excel serial dates (§3.1)', () => {
    const r = parsedB()
    expect(onePatent(r, 'M628244').filing_date).toBe('2020-12-31')
    expect(onePatent(r, 'M625319').filing_date).toBe('2021-12-28')
    expect(onePatent(r, 'I254869').filing_date).toBe('2004-01-30')
    expect(onePatent(r, 'M628244').publication_date).toBe('2022-06-11')
    // Nothing in this window is out of range or published before filing.
    expect(r.warnings.date_out_of_range).toEqual([])
    expect(r.warnings.publication_before_filing).toEqual([])
  })

  it('normalises IPC5 and merges the two zero-padding spellings (§3.2)', () => {
    const r = parsedB()
    expect(onePatent(r, 'M628244').ipc5).toEqual(['G06Q10/10', 'G06Q40/04'])
    expect(onePatent(r, 'M624541').ipc5).toContain('G06K9/00')   // from G06K-09/00
    expect(onePatent(r, 'M622932').ipc5).toContain('G06K9/00')   // from G06K-009/00
    expect(onePatent(r, 'M616135').ipc5).toContain('H02M1/42')   // from "H02M -001/42"
    expect(onePatent(r, 'I748919').ipc_primary).toBe('H04L9/12') // from H04L-0009/12
    expect(onePatent(r, 'M596401').ipc5).toContain('G06Q20/38')  // trailing \
    expect(onePatent(r, 'M580734').ipc5).toContain('H04L9/32')   // trailing .
    expect(onePatent(r, 'I699723').ipc5).toContain('G06Q40/00')  // trailing (
    expect(onePatent(r, 'M603593').ipc5).toContain('G06Q50/26')  // leading tab
    // Every sample value is recoverable, so nothing is reported unparseable.
    expect(r.warnings.ipc_unparseable).toEqual([])
    // The whitespace-only IPC5-1 of a design patent yields no IPC at all.
    expect(onePatent(r, 'D157355').ipc5).toBeUndefined()
    expect(onePatent(r, 'D157355').ipc_depth).toBeUndefined()
  })

  it('records ipc_depth 3 for a subclass-only value', () => {
    // Synthetic fixture row — see the fixture notes at the top of this file.
    const synthetic = onePatent(parsedB(), 'M900001')
    expect(synthetic.ipc5).toEqual(['G06Q'])
    expect(synthetic.ipc_primary).toBe('G06Q')
    expect(synthetic.ipc_depth).toBe(3)
  })

  it('keeps the raw IPC cells alongside the normalised keys', () => {
    const r = parsedB()
    expect(onePatent(r, 'M624541').ipc5_raw).toContain('G06K-09/00')
    expect(onePatent(r, 'M622932').ipc5_raw).toContain('G06K-009/00')
    // The leading character of this cell is U+00A0 (NO-BREAK SPACE), not an
    // ordinary space — which is exactly why ipc5_raw keeps the untrimmed text.
    expect(onePatent(r, 'M628244').ipc5_raw).toContain('\u00a0G06Q-040/04')
  })

  it('normalises a no-break space the same as an ordinary space', () => {
    expect(normalizeIpc5('\u00a0G06Q-040/04')!.key).toBe('G06Q40/04')
    expect(normalizeIpc5('H02M -001/42')!.key).toBe('H02M1/42')
  })

  it('strips the abstract BOM (§3.3)', () => {
    const r = parsedB()
    for (const p of r.patents) expect(p.abstract.charCodeAt(0)).not.toBe(0xfeff)
    // The four fixture rows that carry one still have their text intact.
    expect(onePatent(r, 'M627502').abstract.startsWith('本新型')).toBe(true)
  })

  it('takes 申請人1..n verbatim, without the format A space truncation (§3.4)', () => {
    const r = parsedB()
    expect(onePatent(r, 'M589855').applicants)
      .toEqual(['和安保險代理人股份有限公司', '和泰產物保險股份有限公司'])
    // 申請人1 of this row ends with \r\n in the source; trimming is fine,
    // truncating at a space is not.
    expect(onePatent(r, 'I636415').applicants)
      .toEqual(['台新金融控股股份有限公司', '現代財富控股有限公司'])
  })

  it('scans the numbered inventor group without a hard-coded width (§2)', () => {
    // The source row has 21 populated 發明人 columns; §2 says values are
    // de-duplicated, so the array is shorter than the column count.
    const inventors = onePatent(parsedB(), 'M626491').inventors!
    expect(inventors.length).toBeGreaterThan(13)
    expect(new Set(inventors).size).toBe(inventors.length)
  })

  it('parses 案件狀態 and 設計分類號 as ordinary fields, with no exclusion (§5.4)', () => {
    const r = parsedB()
    // Design patents are present in both shapes and neither is filtered out.
    expect(onePatent(r, 'D206382').design_class).toBe('11-02')   // D prefix + 設計分類號
    expect(onePatent(r, 'M599438').design_class).toBe('47-22')   // 設計分類號 without D prefix
    expect(onePatent(r, 'D207415').design_class).toBeUndefined() // D prefix, no 設計分類號
    expect(onePatent(r, 'M572519').design_class).toBe('46-01')   // leading tab in the cell
    expect(onePatent(r, 'M555518').case_status).toBe('消滅')
    expect(onePatent(r, 'D149298').case_status).toBe('消滅')
    // 消滅 / design rows are still in the output.
    expect(r.patents.filter(p => p.case_status === '消滅')).toHaveLength(2)
  })

  it('reads 被參考次數', () => {
    expect(onePatent(parsedB(), 'M596933').cited_by_count).toBe(1)
  })

  it('resolves references against 專利編號 and files the rest externally (§3.5)', () => {
    const r = parsedB()
    // TWM563592U → M563592, which is row 1148 of the fixture.
    expect(onePatent(r, 'I691863').references).toEqual(['M563592'])
    expect(onePatent(r, 'I691863').external_references).toEqual(['M526724', 'M539667'])
    expect(onePatent(r, 'M580752').references).toEqual(['M545320', 'M547716', 'M568445'])
    // A design reference that matches nothing in the set stays external and
    // creates no node — and it is NOT confused with M199419.
    expect(onePatent(r, 'D206382').external_references).toContain('D199419')
    expect(onePatent(r, 'D206382').references).toBeUndefined()

    // Internal links become citation rows, keyed by PatentRow.id.
    const ids = new Set(r.patents.map(p => p.id))
    expect(r.citations).toHaveLength(4)
    for (const c of r.citations) {
      expect(ids.has(c.from)).toBe(true)
      expect(ids.has(c.to)).toBe(true)
    }
    const from = onePatent(r, 'M580752').id
    expect(r.citations.filter(c => c.from === from)).toHaveLength(3)
  })

  it('reports exactly the CJK free-text references as unparseable (§3.5)', () => {
    const values = parsedB().warnings.reference_unparseable.map(w => w.value)
    expect(values).toHaveLength(3)
    expect(values).toContain('美國60/168,89419991203')
    expect(values).toContain('中華民國10520737020160519')
    expect(values).toContain('新加坡10201801787S20180305')
  })
})

// ===========================================================================
// §4.2 / §4.3 / §4.4 merging on the real fixture
// ===========================================================================
describe('de-duplication on the fixture (§4)', () => {
  it('merges the rule 1a pair and unions its list fields (§4.4)', () => {
    const r = parsedB()
    const p = onePatent(r, 'M601439')
    // The two source rows differ in IPC, applicant and abstract length.
    expect(p.ipc5).toEqual(['G06Q30/02', 'G06Q40/00', 'G09B5/06'])
    expect(p.applicants).toEqual([
      '臺灣中小企業銀行股份有限公司',
      '臺灣新光商業銀行股份有限公司',
    ])
    expect(p.abstract.length).toBe(253)   // the longer of 253 / 191
    expect(r.valid_rows - r.patents.length).toBe(1)
  })

  it('does NOT merge 106201453, the one 申請號 that names two real patents (§4.2)', () => {
    const r = parsedB()
    const pair = r.patents.filter(p => p.application_number === '106201453')
    expect(pair).toHaveLength(2)
    expect(pair.map(p => p.patent_number).sort()).toEqual(['M541619', 'M546543'])
    expect(pair[0].id).not.toBe(pair[1].id)
    expect(new Set(pair.map(p => p.id)).size).toBe(2)
    expect(r.warnings.appno_collisions).toEqual([{
      application_number: '106201453',
      titles: ['匯款系統平台', '車聯網事故資料紀錄與舉證系統'],
      patent_numbers: ['M541619', 'M546543'],
    }])
  })

  it('does NOT merge rule 1b pairs and gives them distinct ids (§4.3, §4.5)', () => {
    const r = parsedB()
    for (const pn of ['M588287', 'M598996']) {
      const rows = byPatentNumber(r, pn)
      expect(rows, pn).toHaveLength(2)
      expect(new Set(rows.map(p => p.id)).size, pn).toBe(2)
    }
    expect(r.warnings.patno_title_conflicts.map(w => w.patent_number).sort())
      .toEqual(['M588287', 'M598996'])
  })

  it('every emitted id is unique', () => {
    const r = parsedB()
    expect(new Set(r.patents.map(p => p.id)).size).toBe(r.patents.length)
    for (const p of r.patents) expect(p.id).toMatch(/^[0-9a-f]{40}$/)
  })

  it('takes the most conservative 案件狀態, never the lexicographic minimum (§4.4)', () => {
    // 核准 (U+6838) sorts before 消滅 (U+6D88): a lexicographic pick would turn
    // a group where one file says 消滅 into 核准.
    const merged = dedupePatents([
      { id: '', title: 'T', abstract: 'A1', applicant: '', patent_number: 'M1', case_status: '消滅' },
      { id: '', title: 'T', abstract: 'A2', applicant: '', patent_number: 'M1', case_status: '核准' },
    ])
    expect(merged.patents).toHaveLength(1)
    expect(merged.patents[0].case_status).toBe('消滅')
    expect(merged.warnings.case_status_conflicts).toEqual([
      { patent: 'M1', values: ['核准', '消滅'], resolved: '消滅' },
    ])
  })

  it('keeps the earliest date and the longest text (§4.4)', () => {
    const merged = dedupePatents([
      { id: '', title: '短', abstract: 'AA', applicant: '', patent_number: 'M1', filing_date: '2020-05-05' },
      { id: '', title: '短', abstract: 'A', applicant: '', patent_number: 'M1', filing_date: '2019/01/01' },
    ])
    expect(merged.patents[0].filing_date).toBe('2019/01/01')
    expect(merged.patents[0].abstract).toBe('AA')
  })

  it('reports rows with neither identifier (rule 3)', () => {
    const merged = dedupePatents([
      { id: '', title: '無識別碼', abstract: 'A', applicant: '', source_files: ['x.xlsx'] },
    ])
    expect(merged.patents).toHaveLength(1)
    expect(merged.warnings.no_identifier).toEqual([{ title: '無識別碼', source_files: ['x.xlsx'] }])
  })
})

// ===========================================================================
// §4.6 / §9-6 cross-format merging
// ===========================================================================
describe('cross-format merging (§4.6)', () => {
  it('merges TW109208236 with 109208236, unions applicants and records the conflict', () => {
    const files = [
      { buffer: formatBBuffer(), filename: 'B.xlsx' },
      { buffer: formatABuffer(), filename: 'A.xlsx' },
    ]
    const m = parseExcelFiles(files)
    expect(m.errors).toEqual([])
    // 42 format-B rows + 3 format-A rows; two pairs merge — M601439 inside the
    // format-B file (rule 1a) and 109208236 across the two files (rule 2a).
    expect(m.original_count).toBe(45)
    expect(m.deduped_count).toBe(43)
    expect(m.patents.filter(p => (p.source_files ?? []).length > 1)).toHaveLength(1)

    const hits = m.patents.filter(p => normalizeApplicationNumber(p.application_number) === '109208236')
    expect(hits).toHaveLength(1)
    const p = hits[0]
    expect(p.source_files).toEqual(['A.xlsx', 'B.xlsx'])
    // Rule 2a: format A has no 專利編號, so format B's survives.
    expect(p.patent_number).toBe('M601398')
    // 公開公告號 is a different namespace and is only recorded, never matched.
    expect(p.publication_number).toBe('TWM601398U')
    expect(p.applicants).toEqual([
      '臺灣中小企業銀行股份有限公司',
      '臺灣新光商業銀行股份有限公司',
    ])
    expect(m.warnings.applicant_identity_conflicts).toEqual(
      expect.arrayContaining([{
        patent: 'M601398',
        sides: [
          { applicants: ['臺灣中小企業銀行股份有限公司'], source_files: ['B.xlsx'] },
          { applicants: ['臺灣新光商業銀行股份有限公司'], source_files: ['A.xlsx'] },
        ],
      }]),
    )
    // A genuine cross-row merge must not let pickLongest() silently drop the
    // applicant that didn't win: the legacy string now unions the same two
    // companies as `applicants[]`, joined with the full-width semicolon.
    expect(p.applicant).toBe('臺灣中小企業銀行股份有限公司；臺灣新光商業銀行股份有限公司')

    // Building the graph from this merged patent must yield two applicant
    // nodes and two "申請了" edges into it — not one of each, which is what
    // the pre-fix pickLongest() behaviour produced.
    const network = buildConceptNetwork([])
    const communities = detectCommunities(network)
    const graph = buildGraph(
      m.patents,
      network,
      communities.assignments,
      communities.colors,
      communities.names,
      { prompt_version: 'test', model_provider: 'test', model_id: 'test' },
    )
    const patentNodeId = `patent:${p.id}`
    expect(graph.nodes.find(n => n.id === 'applicant:臺灣中小企業銀行股份有限公司')).toBeDefined()
    expect(graph.nodes.find(n => n.id === 'applicant:臺灣新光商業銀行股份有限公司')).toBeDefined()
    const edgesToPatent = graph.edges.filter(e => e.relation === '申請了' && e.to === patentNodeId)
    expect(edgesToPatent).toHaveLength(2)
  })

  it('graph-builder 對 patent.applicants 內部重複自行去重，不重複計算 patent_count 或邊 (T1b)', () => {
    const patents: PatentRow[] = [
      {
        id: 'DUPE1',
        title: '重複申請人測試',
        abstract: '',
        // Deliberately left blank/wrong: this proves the graph is built from
        // `applicants[]`, not by falling back to splitting the legacy
        // `applicant` string (which would already be deduped by
        // splitApplicants()'s own Set and mask a regression here).
        applicant: '',
        applicants: ['宋', '呂', '宋', '宋'],
      },
    ]
    const network = buildConceptNetwork([])
    const communities = detectCommunities(network)
    const graph = buildGraph(
      patents,
      network,
      communities.assignments,
      communities.colors,
      communities.names,
      { prompt_version: 'test', model_provider: 'test', model_id: 'test' },
    )

    const applicantNodes = graph.nodes.filter(n => n.type === 'applicant')
    expect(applicantNodes).toHaveLength(2)
    expect(graph.nodes.find(n => n.id === 'applicant:宋')?.patent_count).toBe(1)
    expect(graph.nodes.find(n => n.id === 'applicant:呂')?.patent_count).toBe(1)

    const patentNodeId = 'patent:DUPE1'
    const edgesToPatent = graph.edges.filter(e => e.relation === '申請了' && e.to === patentNodeId)
    expect(edgesToPatent).toHaveLength(2)
  })
})

// ===========================================================================
// T2 — real-file regression (19 vs 19): the legacy `applicant` string must
// list every company `applicants[]` has, not just the one pickLongest() kept.
// Extracted from `專利彙整(全) (1).xlsx` (not read here — see
// tests/fixtures/t2-applicant-merge-regression.json) into a portable fixture
// so this runs in CI without the source spreadsheet.
// ===========================================================================
describe('applicant legacy-string regression (T2, extracted real-file fixture)', () => {
  it('for each of the 3 known real cases, merging two single-applicant rows keeps both companies in applicant and applicants[]', () => {
    const cases = applicantMergeFixture as Array<{
      title: string
      patent_number: string
      application_number: string
      applicants: string[]
      applicant: string
    }>
    expect(cases).toHaveLength(3)

    for (const c of cases) {
      const rows: PatentRow[] = c.applicants.map((name, i) => ({
        id: '',
        title: c.title,
        abstract: '',
        patent_number: c.patent_number,
        application_number: c.application_number,
        applicant: name,
        applicants: [name],
      }))

      const result = dedupePatents(rows)
      expect(result.deduped_count).toBe(1)
      const merged = result.patents[0]

      expect(merged.applicants).toBeDefined()
      expect(merged.applicants!.length).toBe(2)

      const splitCount = merged.applicant.split(/；|;/).filter(Boolean).length
      expect(splitCount).toBe(merged.applicants!.length)
    }
  })
})

// ===========================================================================
// §8 order invariance
// ===========================================================================
describe('order invariance (§8, §9-4)', () => {
  it('produces identical rows, warnings and citations when the upload order is reversed', () => {
    const a = { buffer: formatABuffer(), filename: 'A.xlsx' }
    const b = { buffer: formatBBuffer(), filename: 'B.xlsx' }
    const forward = parseExcelFiles([a, b])
    const reversed = parseExcelFiles([b, a])

    const sortById = (rows: PatentRow[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id))
    expect(sortById(reversed.patents)).toEqual(sortById(forward.patents))
    expect(reversed.warnings).toEqual(forward.warnings)
    expect(reversed.citations).toEqual(forward.citations)
    expect(reversed.deduped_count).toBe(forward.deduped_count)
    expect(reversed.original_count).toBe(forward.original_count)
  })

  it('is also invariant when the same file is supplied twice', () => {
    const b = formatBBuffer()
    const once = parseExcelFiles([{ buffer: b, filename: 'B.xlsx' }])
    const twice = parseExcelFiles([
      { buffer: b, filename: 'B.xlsx' },
      { buffer: b, filename: 'B2.xlsx' },
    ])
    // Every row merges with its twin, so the row count is unchanged; only the
    // provenance grows.
    expect(twice.deduped_count).toBe(once.deduped_count)
    for (const p of twice.patents) expect(p.source_files).toEqual(['B.xlsx', 'B2.xlsx'])
  })
})

// ===========================================================================
// Error reporting
// ===========================================================================
describe('unrecognised input', () => {
  it('names every sheet and its headers when no fingerprint matches', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['甲', '乙'], [1, 2]]), '亂表')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const r = parseExcel(buf, 'junk.xlsx')
    expect(r.patents).toEqual([])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('亂表')
    expect(r.errors[0]).toContain('甲')
  })
})
