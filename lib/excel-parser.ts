/**
 * excel-parser.ts
 *
 * Parses .xlsx files into PatentRow[].
 *
 * Two input formats are supported (PRD v2 / P0 §1):
 *
 *   Format A ("爬蟲版"): single `專利清單` sheet, 9 columns, string dates.
 *   Format B ("老師版"): 10 sheets, data in `原始資料`, 83 columns,
 *                        Excel serial-number dates.
 *
 * Format A's parse path is deliberately left byte-for-byte as it was in v1.2
 * (PRD v2 §7-5): the same read options, the same synonym map, the same
 * `cleanApplicantName()`, the same row filter. The only intentional change to
 * format A output is `PatentRow.id`, whose semantics moved from
 * `${filename}-${rowIndex}` to the content hash of §4.5.
 *
 * Everything in this module is synchronous and free of Node built-ins, because
 * it runs in the browser (`components/UploadZone.tsx`) as well as under vitest.
 */

import * as XLSX from 'xlsx'
import type { PatentRow } from '@/types/graph'

// ---------------------------------------------------------------------------
// FIELD_SYNONYMS — matches PRD F-01 table exactly (format A)
// Keys are canonical field names; values are recognised column header variants
// (all comparisons are case-insensitive and whitespace-trimmed)
// ---------------------------------------------------------------------------
export const FIELD_SYNONYMS: Record<string, string[]> = {
  title: ['專利名稱(中)', 'title', '專利名稱', 'name', '題名'],
  abstract: ['摘要', 'abstract', 'summary', '內容'],
  applicant: ['申請人', 'applicant', 'assignee'],
  filing_date: ['申請日', 'filing_date', 'application_date'],
  application_number: ['申請號', 'application_number'],
  // Sub-domain label from the crawler ("金控"/"保險"/"銀行"…). Stored on the
  // patent row so analyses can be broken down by sub-domain in SQL.
  search_keyword: ['搜尋關鍵字', 'search_keyword', 'keyword'],
  title_en: ['專利名稱(英)', 'title_en'],
  publication_number: ['公開公告號', 'publication_number'],
  publication_date: ['公開公告日', 'publication_date'],
}

// Format B canonical single-value columns.
const FORMAT_B_COLUMNS = {
  title: '專利名稱',
  abstract: '摘要',
  application_number: '申請號',
  patent_number: '專利編號',
  filing_date: '申請日',
  publication_date: '公告/公開日',
  cited_by_count: '被參考次數',
  case_status: '案件狀態',
  design_class: '設計分類號',
} as const

/** Sheets that must never be chosen as the format-B data sheet (§1-3). */
const SHEET_BLACKLIST_EXACT = ['發明人合併', '雷達圖分析', 'IPC3分析', 'IPC5分析']
const SHEET_BLACKLIST_PREFIX = ['專利件數分析']
const SHEET_BLACKLIST_SUFFIX = ['別分析']

/** Minimum non-empty data rows for a sheet to qualify via fallback (§1-3). */
export const FORMAT_B_FALLBACK_MIN_ROWS = 500

/** Sheet whose name identifies the format-B data sheet without any guessing. */
export const FORMAT_B_SHEET_NAME = '原始資料'

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type ExcelFormat = 'A' | 'B'

/** Result of matching a single canonical field against the spreadsheet headers */
export interface FieldMapping {
  field: string
  matched_column: string | null
  required: boolean
}

/** Data-quality findings. Never fatal — every list is informational (§3, §4). */
export interface DataQualityWarnings {
  /** Filing/publication date outside [1990, currentYear + 1] (§3.1) */
  date_out_of_range: Array<{ patent: string; field: string; value: string }>
  /** publication_date earlier than filing_date (§3.1) */
  publication_before_filing: Array<{ patent: string; filing_date: string; publication_date: string }>
  /** IPC5 cell that failed anchored validation (§3.2-6) */
  ipc_unparseable: Array<{ patent: string; column: string; value: string }>
  /** IPC3-n disagrees with the L3 set derived from IPC5-n (§3.2) */
  ipc3_mismatch: Array<{ patent: string; from_ipc5: string[]; from_ipc3: string[] }>
  /** 參考文獻 cell that normalises to nothing usable (§3.5) */
  reference_unparseable: Array<{ patent: string; column: string; value: string }>
  /** Rule 1b: same patent_number, different title_key → NOT merged (§4.3) */
  patno_title_conflicts: Array<{ patent_number: string; titles: string[] }>
  /** Rules 1c / 2b: same application_number but not merged (§4.3) */
  appno_collisions: Array<{ application_number: string; titles: string[]; patent_numbers: string[] }>
  /** §4.4: merged group holds two different non-null application numbers */
  appno_conflicts: Array<{ chosen: string; rejected: string[]; title: string }>
  /** Rule 3: neither patent_number nor application_number present (§4.3) */
  no_identifier: Array<{ title: string; source_files: string[] }>
  /** §4.4: merged group disagrees on 案件狀態 */
  case_status_conflicts: Array<{ patent: string; values: string[]; resolved: string }>
  /** §4.6: merged group's applicant sets do not intersect after normalisation */
  applicant_identity_conflicts: Array<{
    patent: string
    sides: Array<{ applicants: string[]; source_files: string[] }>
  }>
}

export function emptyWarnings(): DataQualityWarnings {
  return {
    date_out_of_range: [],
    publication_before_filing: [],
    ipc_unparseable: [],
    ipc3_mismatch: [],
    reference_unparseable: [],
    patno_title_conflicts: [],
    appno_collisions: [],
    appno_conflicts: [],
    no_identifier: [],
    case_status_conflicts: [],
    applicant_identity_conflicts: [],
  }
}

/** The complete result returned by parseExcel() */
export interface ParseResult {
  patents: PatentRow[]
  field_mappings: FieldMapping[]
  total_rows: number
  filename: string
  errors: string[]
  // --- P0 additions ---
  format: ExcelFormat
  sheet_name: string
  /** Valid data rows before de-duplication (§5.1) */
  valid_rows: number
  /** Header columns that mapped to no canonical field — shown in the UI panel */
  unmapped_columns: string[]
  warnings: DataQualityWarnings
  /** Internal 參考文獻 links, as PatentRow.id pairs (§3.5) */
  citations: Array<{ from: string; to: string }>
}

export interface ParseOptions {
  /**
   * Merge duplicate rows per §4.3 before returning (default `true`).
   *
   * Set to `false` only to inspect the raw one-row-per-spreadsheet-row output —
   * the format-A snapshot regression of §7-5 uses it to compare against the
   * pre-v2 behaviour. With `dedupe: false` the returned rows keep the sheet's
   * order, `references[]` is not yet split into internal/external, and
   * `PatentRow.id` values are NOT guaranteed unique (149 groups of the crawler
   * export share an 申請號), so such output must never be persisted.
   */
  dedupe?: boolean
}

/** Result of merging several files' rows (§5.1, §5.3) */
export interface MultiParseResult {
  results: ParseResult[]
  patents: PatentRow[]
  /** Sum of every file's valid rows, before de-duplication */
  original_count: number
  /** Rows remaining after §4.3 merging */
  deduped_count: number
  warnings: DataQualityWarnings
  citations: Array<{ from: string; to: string }>
  errors: string[]
}

// Required canonical fields (title and abstract per PRD)
const REQUIRED_FIELDS = new Set(['title', 'abstract'])

// ---------------------------------------------------------------------------
// sha1hex — dependency-free, synchronous, works in Node and in the browser.
//
// `node:crypto` cannot be imported here (this module is bundled into the client
// component that parses the upload) and Web Crypto's digest() is async, so the
// stable-ID computation of §4.5 needs its own implementation.
// ---------------------------------------------------------------------------
export function sha1hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const blockCount = ((bytes.length + 8) >> 6) + 1
  const padded = new Uint8Array(blockCount << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = bytes.length * 8
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Int32Array(80)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4)
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (n << 1) | (n >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = t
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }

  return [h0, h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

// ---------------------------------------------------------------------------
// cleanApplicantName
//
// Cleaning rules (PRD F-05 / section 3.2):
//  1. Truncate at the first U+3000 (IDEOGRAPHIC SPACE) or ASCII space; keep
//     the prefix as the company name.
//  2. If the result still contains a trailing parenthetical (「（…）」or「(…)」),
//     truncate before it.
//  3. Trim residual whitespace.
//
// UNCHANGED from v1.2 and must stay so: PRD v2 §7-5 requires format A's
// `applicant` values to remain byte-identical. In particular there is no
// full-width/half-width folding here — adding one would rewrite
// `ＪＸ金屬股份有限公司` to `JX金屬股份有限公司`.
// ---------------------------------------------------------------------------
export function cleanApplicantName(raw: string): string {
  // Step 1: truncate at full-width space (U+3000) or half-width space
  // Find the earliest occurrence of either
  const ideographicSpace = raw.indexOf('　')
  const asciiSpace = raw.indexOf(' ')

  let cut = raw.length
  if (ideographicSpace !== -1) cut = Math.min(cut, ideographicSpace)
  if (asciiSpace !== -1) cut = Math.min(cut, asciiSpace)

  let name = raw.slice(0, cut).trim()

  // Step 2: remove trailing parentheticals — both full-width （…） and half-width (…)
  // Keep stripping from the right as long as a closing bracket is present
  name = name.replace(/[（(][^）)]*[）)]$/, '').trim()

  return name
}

// ---------------------------------------------------------------------------
// normalizeApplicantName (§3.4)
//
// Produces a MERGE KEY only. The caller must never write the result back onto
// `applicant` / `applicants[]`: those keep their original spelling, and the
// node label is picked by §3.4's "smallest application_number" rule so it does
// not depend on upload order.
// ---------------------------------------------------------------------------
export function normalizeApplicantName(raw: string): string {
  let s = String(raw ?? '')
  // Unify full-width / half-width (ＪＸ → JX, １２ → 12, ： → :)
  s = s.normalize('NFKC')
  // Drop every kind of whitespace, including U+3000 and stray \r\n from the cell
  s = s.replace(/[\s　]+/g, '')
  s = s.toUpperCase()
  // Unify company-suffix spellings. 股份有限公司 / 有限公司 / Co., Ltd. all
  // collapse to 公司 so the same organisation spelled two ways merges.
  s = s.replace(/(股份)?有限公司$/, '公司')
  s = s.replace(/CO\.?,?\s*LTD\.?$/, '公司')
  s = s.replace(/(CORPORATION|CORP\.?|INC\.?|LLC\.?|LIMITED)$/, '公司')
  return s
}

// ---------------------------------------------------------------------------
// Identifier normalisation (§4.1)
// ---------------------------------------------------------------------------

/** Upper-case → strip a leading `TW` → drop everything outside [A-Z0-9]. */
export function normalizeApplicationNumber(raw: unknown): string | null {
  let s = String(raw ?? '').trim().toUpperCase()
  if (!s) return null
  s = s.replace(/^TW/, '')
  s = s.replace(/[^A-Z0-9]/g, '')
  return s.length > 0 ? s : null
}

/**
 * Upper-case → strip `TW` → drop non-[A-Z0-9] → strip a trailing `U`.
 * The D / M / I type letter is KEPT: dropping it would fuse `D199419`
 * (design) with `M199419` (utility model).
 */
export function normalizePatentNumber(raw: unknown): string | null {
  let s = String(raw ?? '').trim().toUpperCase()
  if (!s) return null
  s = s.replace(/^TW/, '')
  s = s.replace(/[^A-Z0-9]/g, '')
  s = s.replace(/U$/, '')
  return s.length > 0 ? s : null
}

/** Drop all whitespace → unify full/half width → drop punctuation. */
export function normalizeTitleKey(raw: unknown): string {
  let s = String(raw ?? '')
  s = s.replace(/[\s　]+/g, '')
  s = s.normalize('NFKC')
  // Punctuation: ASCII specials plus the CJK punctuation block and full-width forms
  s = s.replace(/[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u2000-\u206f\u3000-\u303f\uff01-\uff20\uff3b-\uff40\uff5b-\uff65]/g, '')
  return s.toUpperCase()
}

/**
 * 參考文獻 normalisation (§3.5). The comparison key is 專利編號, never 申請號.
 * Upper-case → strip `TW` → drop non-[A-Z0-9/] → strip a trailing `U`.
 * `/` survives so that malformed foreign values such as `美國60/168,894…`
 * remain visibly malformed instead of silently turning into a Taiwanese number.
 */
export function normalizeReference(raw: unknown): string | null {
  let s = String(raw ?? '').trim().toUpperCase()
  if (!s) return null
  s = s.replace(/^TW/, '')
  s = s.replace(/[^A-Z0-9/]/g, '')
  s = s.replace(/U$/, '')
  return s.length > 0 ? s : null
}

// ---------------------------------------------------------------------------
// IPC normalisation (§3.2)
//
// The step order below is fixed by the spec and must not be rearranged; in
// particular step 5 (strip the main group's leading zeros) is what makes
// `G06K-09/00` and `G06K-009/00` — both present in the sample — land on the
// same key `G06K9/00` instead of splitting into two groups.
// ---------------------------------------------------------------------------

/** `^([A-H]\d{2}[A-Z])-?(\d{1,4})/(\d{1,6})$` — must match the WHOLE string. */
const IPC5_ANCHORED = /^([A-H]\d{2}[A-Z])-?(\d{1,4})\/(\d{1,6})$/
/** Subclass-only value, e.g. `G06Q` → ipc_depth 3. */
const IPC3_ANCHORED = /^[A-H]\d{2}[A-Z]$/

export interface NormalizedIpc {
  /** Internal key: `G06Q10/10` (L5) or `G06Q` (L3) */
  key: string
  /** 5 for a full main-group/sub-group value, 3 for a subclass-only value */
  depth: number
}

export function normalizeIpc5(raw: unknown): NormalizedIpc | null {
  // Step 2 — trim, then strip a parenthesised edition suffix, then strip
  // trailing illegal characters.  The edition suffix has to go first: running
  // `[^A-Z0-9/]+$` on `G06Q-040/00 (2012.01)` would eat the `)` and leave
  // `G06Q-040/00 (2012.01`, which no later step can recover.
  let s = String(raw ?? '').trim().toUpperCase()
  if (!s) return null
  s = s.replace(/\s*\((?:19|20)\d{2}\.\d{2}\)\s*$/, '')
  s = s.replace(/[^A-Z0-9/]+$/, '')
  // Step 3 — remove every internal space (`H02M -001/42` is real sample data)
  s = s.replace(/[\s　]+/g, '')
  if (!s) return null

  // Step 4 — anchored, whole-string validation
  const m5 = IPC5_ANCHORED.exec(s)
  if (m5) {
    // Step 5 — strip the main group's zero padding (`010` → `10`, `09` → `9`)
    const mainGroup = String(Number.parseInt(m5[2], 10))
    return { key: `${m5[1]}${mainGroup}/${m5[3]}`, depth: 5 }
  }
  if (IPC3_ANCHORED.test(s)) return { key: s, depth: 3 }

  // Step 6 — caller records warnings.ipc_unparseable
  return null
}

/**
 * Whether a 參考文獻 cell can be compared with 專利編號 at all (§3.5).
 *
 * The 12 irregular values in the sample are free text that merely *mentions* a
 * foreign filing (`美國60/168,89419991203`, `中華民國10520737020160519`,
 * whole paragraphs with URLs). Every one of them contains a CJK character,
 * whereas all 620 genuine foreign references (`CN304408049`, `JPD1280047`,
 * `US2017/0041332A1`) are pure ASCII — so the presence of non-ASCII text is the
 * discriminator, and it selects exactly the 12 irregular values of §3.5.
 *
 * Do NOT additionally demand a `<letters><digits>` shape: real references carry
 * kind codes (`TW201502845A`, `US6327656B2`) and US publication numbers embed a
 * `/`. Those are perfectly parseable — they simply match no 專利編號 in the
 * dataset and end up in `external_references[]`.
 */
export function isUsableReference(raw: unknown): boolean {
  const s = String(raw ?? '').trim()
  if (!s) return false
  if (/[^\u0020-\u007e]/.test(s)) return false
  return normalizeReference(s) !== null
}

/** L3 subclass of a normalised IPC key, for the IPC3 cross-check. */
export function ipcSubclass(key: string): string | null {
  const m = /^([A-H]\d{2}[A-Z])/.exec(key)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Dates (§3.1)
// ---------------------------------------------------------------------------

/**
 * Excel serial number → `YYYY-MM-DD`.
 *
 * `44196` is **2020-12-31**, not 2021-01-01. Cross-checked two ways against the
 * sample file: `XLSX.SSF.parse_date_code(44196)` → `{y:2020,m:12,d:31}` and the
 * cached display string on the cell is `12/31/20`. Do not "fix" this with a
 * `+1`: that would push all 1869 format-B dates forward one day and move every
 * year-boundary patent into the wrong year.
 */
export function excelSerialToISODate(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial <= 0) return undefined
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
  if (Number.isNaN(d.getTime())) return undefined
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Comparable form of a date string in either `YYYY/MM/DD` or `YYYY-MM-DD`. */
function dateSortKey(value: string | undefined): string | undefined {
  if (!value) return undefined
  const m = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(value.trim())
  if (!m) return undefined
  return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// BOM / zero-width stripping (§3.3)
// ---------------------------------------------------------------------------

/** Strip leading U+FEFF and zero-width characters (32/1869 abstracts have one). */
export function stripBom(value: string): string {
  return value.replace(/^[\ufeff\u200b-\u200f\u2060\ufffe]+/, '')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalise a raw header string for synonym matching */
function normaliseHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase()
}

/**
 * Build a map from canonical field name → actual spreadsheet column header.
 * Matching is case-insensitive; the first synonym hit wins.
 */
function buildColumnMap(headers: string[]): Map<string, string> {
  const normHeaders = headers.map(h => ({ original: h, normalised: normaliseHeader(h) }))
  const result = new Map<string, string>()

  for (const [canonical, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    for (const synonym of synonyms) {
      const target = normaliseHeader(synonym)
      const match = normHeaders.find(h => h.normalised === target)
      if (match) {
        result.set(canonical, match.original)
        break
      }
    }
  }

  return result
}

/**
 * Extract a cell value as a trimmed string, or undefined if absent/blank.
 */
function cellString(row: Record<string, unknown>, col: string): string | undefined {
  const val = row[col]
  if (val === null || val === undefined) return undefined
  const s = String(val).trim()
  return s.length > 0 ? s : undefined
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Numbered column group scan (§2): every header matching
 * `^<prefix>-?\d+$`, ordered by the number. Never hard-code 13 or 21 — the
 * teacher's export widens these groups whenever a patent needs more slots.
 */
export function numberedColumns(headers: string[], prefix: string): string[] {
  const re = new RegExp(`^${escapeRegExp(prefix)}-?(\\d+)$`)
  const hits: Array<{ header: string; n: number }> = []
  for (const h of headers) {
    const m = re.exec(String(h).trim())
    if (m) hits.push({ header: h, n: Number(m[1]) })
  }
  hits.sort((a, b) => a.n - b.n)
  return hits.map(h => h.header)
}

/** Non-empty, trimmed, de-duplicated values of a numbered column group. */
function numberedValues(row: Record<string, unknown>, cols: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of cols) {
    const v = cellString(row, c)
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

function uniqSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

// ---------------------------------------------------------------------------
// Format-B sheet selection (§1)
// ---------------------------------------------------------------------------

export interface SheetDescriptor {
  name: string
  headers: string[]
  /** Non-empty data rows; only consulted when the header conditions pass. */
  nonEmptyRows: number
}

export function isBlacklistedSheet(name: string): boolean {
  const n = name.trim()
  if (SHEET_BLACKLIST_EXACT.includes(n)) return true
  if (SHEET_BLACKLIST_PREFIX.some(p => n.startsWith(p))) return true
  if (SHEET_BLACKLIST_SUFFIX.some(s => n.endsWith(s))) return true
  return false
}

function hasHeader(headers: string[], name: string): boolean {
  return headers.some(h => String(h).trim() === name)
}

/** The format-B fingerprint: the header row carries a literal `IPC5-1`. */
export function looksLikeFormatB(headers: string[]): boolean {
  return hasHeader(headers, 'IPC5-1')
}

/** The format-A fingerprint (§1): `搜尋關鍵字` or `專利名稱(中)`. */
export function looksLikeFormatA(headers: string[]): boolean {
  return hasHeader(headers, '搜尋關鍵字') || hasHeader(headers, '專利名稱(中)')
}

/**
 * All four fallback conditions of §1-3 must hold SIMULTANEOUSLY.
 *
 * Checking only the `IPC5-1` fingerprint is not enough: the `雷達圖分析` sheet
 * of the real sample also has a literal `IPC5-1` header (1559 rows) while
 * lacking 專利名稱 / 摘要 / 申請日, so it would be selected and the user would
 * be told "缺少必要欄位" with no hint as to why.
 */
export function qualifiesAsFormatBSheet(d: SheetDescriptor): boolean {
  if (isBlacklistedSheet(d.name)) return false
  if (!looksLikeFormatB(d.headers)) return false
  if (!hasHeader(d.headers, '摘要')) return false
  if (!hasHeader(d.headers, '專利名稱')) return false
  if (!hasHeader(d.headers, '申請號')) return false
  return d.nonEmptyRows > FORMAT_B_FALLBACK_MIN_ROWS
}

/**
 * Pure sheet-selection decision (§1-1 … §1-3), separated from workbook I/O so
 * it can be unit-tested without building a >500-row workbook.
 *
 * `原始資料` wins by name whenever it carries the format-B fingerprint; only
 * then is the four-condition fallback consulted.
 */
export function selectFormatBSheet(descriptors: SheetDescriptor[]): string | null {
  const named = descriptors.find(d => d.name.trim() === FORMAT_B_SHEET_NAME)
  if (named && looksLikeFormatB(named.headers)) return named.name
  for (const d of descriptors) {
    if (qualifiesAsFormatBSheet(d)) return d.name
  }
  return null
}

// ---------------------------------------------------------------------------
// Workbook access
//
// A format-B workbook must NEVER be read whole: `發明人合併` has 1048576 rows
// (Excel's limit, filled with formulas) and reading it exhausts memory. Every
// read below therefore names the sheet it wants, and header probing caps the
// parse at one row.
// ---------------------------------------------------------------------------

function readSheetNames(buffer: ArrayBuffer): string[] {
  return XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames ?? []
}

function readHeaders(buffer: ArrayBuffer, sheetName: string): string[] {
  const wb = XLSX.read(buffer, { type: 'array', sheets: [sheetName], sheetRows: 1 })
  const sheet = wb.Sheets[sheetName]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
  return (rows[0] ?? []).map(h => String(h ?? ''))
}

function readSheetRows(
  buffer: ArrayBuffer,
  sheetName: string,
  raw: boolean,
): Array<Record<string, unknown>> {
  const wb = XLSX.read(buffer, { type: 'array', sheets: [sheetName], cellDates: false })
  const sheet = wb.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw })
}

// ---------------------------------------------------------------------------
// Intermediate row shape used between parsing and de-duplication
// ---------------------------------------------------------------------------

interface StagedRow {
  row: PatentRow
  /** normalised patent_number, or null */
  pn: string | null
  /** normalised application_number, or null */
  an: string | null
  /** normalised title key (always present) */
  tk: string
}

function emptyFieldMappings(): FieldMapping[] {
  return Object.keys(FIELD_SYNONYMS).map(field => ({
    field,
    matched_column: null,
    required: REQUIRED_FIELDS.has(field),
  }))
}

function emptyResult(filename: string, errors: string[]): ParseResult {
  return {
    patents: [],
    field_mappings: emptyFieldMappings(),
    total_rows: 0,
    filename,
    errors,
    format: 'A',
    sheet_name: '',
    valid_rows: 0,
    unmapped_columns: [],
    warnings: emptyWarnings(),
    citations: [],
  }
}

// ---------------------------------------------------------------------------
// parseExcel
//
// Parses ONE file. The returned rows are already de-duplicated against each
// other (a single format-B file contains 128 mergeable rows on its own), so
// `PatentRow.id` is final for single-file uploads. For multi-file uploads use
// parseExcelFiles(), which re-runs the merge across all files.
// ---------------------------------------------------------------------------
export function parseExcel(
  buffer: ArrayBuffer,
  filename: string,
  options: ParseOptions = {},
): ParseResult {
  const dedupe = options.dedupe !== false
  const sheetNames = readSheetNames(buffer)
  if (sheetNames.length === 0) {
    return emptyResult(filename, ['試算表中找不到任何工作表。'])
  }

  // 1. `原始資料` by name → format B.
  const namedHeaders = sheetNames.includes(FORMAT_B_SHEET_NAME)
    ? readHeaders(buffer, FORMAT_B_SHEET_NAME)
    : null
  if (namedHeaders && looksLikeFormatB(namedHeaders)) {
    return parseFormatB(buffer, filename, FORMAT_B_SHEET_NAME, dedupe)
  }

  // 2. Format-A fingerprint on the first sheet.
  const firstHeaders = readHeaders(buffer, sheetNames[0])
  if (looksLikeFormatA(firstHeaders)) {
    return parseFormatA(buffer, filename, sheetNames[0], dedupe)
  }

  // 3. Format-B fallback: four conditions, evaluated one sheet at a time so the
  //    blacklisted million-row sheets are never materialised.
  for (const name of sheetNames) {
    if (isBlacklistedSheet(name)) continue
    const headers = readHeaders(buffer, name)
    if (!looksLikeFormatB(headers)) continue
    if (!hasHeader(headers, '摘要') || !hasHeader(headers, '專利名稱') || !hasHeader(headers, '申請號')) continue
    const rows = readSheetRows(buffer, name, true)
    const nonEmpty = rows.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== '')).length
    if (qualifiesAsFormatBSheet({ name, headers, nonEmptyRows: nonEmpty })) {
      return parseFormatB(buffer, filename, name, dedupe)
    }
  }

  // 4. Neither fingerprint matched. Anything with an abstract column is still
  //    tried as format A (pre-v2 files with renamed headers keep working);
  //    otherwise report every sheet and its headers so the real cause is visible.
  if (hasHeader(firstHeaders, '摘要') || firstHeaders.some(h => normaliseHeader(h) === 'abstract')) {
    return parseFormatA(buffer, filename, sheetNames[0], dedupe)
  }

  const detail = sheetNames
    .map(n => `「${n}」：${readHeaders(buffer, n).filter(h => h.trim() !== '').join('、') || '（無表頭）'}`)
    .join('\n')
  return emptyResult(
    filename,
    [`無法判定檔案格式：找不到格式 A（搜尋關鍵字／專利名稱(中)）或格式 B（IPC5-1 + 摘要 + 專利名稱 + 申請號）的工作表。\n各工作表表頭如下：\n${detail}`],
  )
}

// ---------------------------------------------------------------------------
// Format A — the v1.2 path, deliberately unchanged (§7-5)
// ---------------------------------------------------------------------------
function parseFormatA(
  buffer: ArrayBuffer,
  filename: string,
  sheetName: string,
  dedupe: boolean,
): ParseResult {
  const errors: string[] = []
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: true, sheets: [sheetName] })
  const sheet = workbook.Sheets[sheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })

  if (rawRows.length === 0) {
    const r = emptyResult(filename, ['試算表沒有資料列。'])
    r.sheet_name = sheetName
    return r
  }

  const headers = Object.keys(rawRows[0])
  const columnMap = buildColumnMap(headers)

  const field_mappings: FieldMapping[] = Object.keys(FIELD_SYNONYMS).map(field => ({
    field,
    matched_column: columnMap.get(field) ?? null,
    required: REQUIRED_FIELDS.has(field),
  }))

  const missingRequired = field_mappings.filter(fm => fm.required && fm.matched_column === null)
  if (missingRequired.length > 0) {
    const names = missingRequired.map(fm => fm.field).join('、')
    errors.push(`缺少必要欄位：${names}。請確認試算表包含以下欄位之一：${missingRequired.map(fm => FIELD_SYNONYMS[fm.field].join(' / ')).join('；')}`)
  }

  const warnings = emptyWarnings()
  const staged: StagedRow[] = []
  const currentYear = new Date().getFullYear()

  rawRows.forEach((row, rowIndex) => {
    const titleCol = columnMap.get('title')
    const abstractCol = columnMap.get('abstract')

    if (missingRequired.length > 0) return

    const title = titleCol ? cellString(row, titleCol) : undefined
    const abstract = abstractCol ? cellString(row, abstractCol) : undefined

    if (!title || !abstract) {
      const hasAnyData = headers.some(h => cellString(row, h) !== undefined)
      if (hasAnyData) {
        errors.push(`第 ${rowIndex + 2} 列缺少必要欄位（title 或 abstract），已略過。`)
      }
      return
    }

    // Applicant: split on ；or ;, clean each part, rejoin with ；
    const applicantCol = columnMap.get('applicant')
    let applicant = ''
    let applicantRaw = ''
    let applicantList: string[] = []
    if (applicantCol) {
      const rawApplicant = cellString(row, applicantCol) ?? ''
      applicantRaw = rawApplicant
      applicantList = rawApplicant
        .split(/；|;/)
        .map(part => cleanApplicantName(part.trim()))
        .filter(part => part.length > 0)
      applicant = applicantList.join('；')
    }

    const filingDateCol = columnMap.get('filing_date')
    const appNumberCol = columnMap.get('application_number')

    const patent: PatentRow = {
      id: '',   // assigned by dedupePatents() from the merged fields (§4.5)
      title,
      abstract,
      applicant,
    }

    // Keep the untouched cell: cleanApplicantName() drops the address and the
    // trailing country, which the applicants table needs.
    if (applicantRaw && applicantRaw !== applicant) patent.applicant_raw = applicantRaw

    if (filingDateCol) {
      const fd = cellString(row, filingDateCol)
      if (fd) patent.filing_date = fd
    }

    if (appNumberCol) {
      const an = cellString(row, appNumberCol)
      if (an) patent.application_number = an
    }

    const keywordCol = columnMap.get('search_keyword')
    if (keywordCol) {
      const kw = cellString(row, keywordCol)
      if (kw) patent.search_keyword = kw
    }

    // --- P0 additions. None of these touch a v1.2 field. ---
    if (applicantList.length > 0) patent.applicants = applicantList
    const titleEnCol = columnMap.get('title_en')
    if (titleEnCol) {
      const te = cellString(row, titleEnCol)
      if (te) patent.title_en = te
    }
    const pubNoCol = columnMap.get('publication_number')
    if (pubNoCol) {
      const pn = cellString(row, pubNoCol)
      // Format A's 公開公告號 is NOT the same namespace as format B's 專利編號
      // (§2) — it is recorded but never used as a merge key.
      if (pn) patent.publication_number = pn
    }
    const pubDateCol = columnMap.get('publication_date')
    if (pubDateCol) {
      const pd = cellString(row, pubDateCol)
      if (pd) patent.publication_date = pd
    }
    patent.source_files = [filename]
    if (patent.search_keyword) patent.search_keywords = [patent.search_keyword]

    const patentLabel = patent.application_number ?? title
    checkDateRange(warnings, patentLabel, 'filing_date', patent.filing_date, currentYear)
    checkDateRange(warnings, patentLabel, 'publication_date', patent.publication_date, currentYear)
    checkPublicationOrder(warnings, patentLabel, patent)

    const an = normalizeApplicationNumber(patent.application_number)
    if (an === null) {
      // Rule 3 (§4.3): format A carries no 專利編號, so a row without a usable
      // 申請號 has no identifier at all and can never merge with anything.
      warnings.no_identifier.push({ title, source_files: patent.source_files ?? [] })
    }

    staged.push({
      row: patent,
      // Format A never carries 專利編號; 公開公告號 lives in a different
      // namespace (§2), so pn stays null and cross-format merging goes via rule 2.
      pn: null,
      an,
      tk: normalizeTitleKey(title),
    })
  })

  const unmapped = headers.filter(h => ![...columnMap.values()].includes(h))
  const merged = finalizeStaged(staged, warnings, dedupe)

  return {
    patents: merged.patents,
    field_mappings,
    total_rows: rawRows.length,
    filename,
    errors,
    format: 'A',
    sheet_name: sheetName,
    valid_rows: staged.length,
    unmapped_columns: unmapped,
    warnings: merged.warnings,
    citations: merged.citations,
  }
}

// ---------------------------------------------------------------------------
// Format B — the teacher's 83-column export
// ---------------------------------------------------------------------------
function parseFormatB(
  buffer: ArrayBuffer,
  filename: string,
  sheetName: string,
  dedupe: boolean,
): ParseResult {
  const errors: string[] = []
  // raw:true — 申請日 / 公告/公開日 must arrive as Excel serial NUMBERS (§3.1).
  const rawRows = readSheetRows(buffer, sheetName, true)
  if (rawRows.length === 0) {
    const r = emptyResult(filename, ['試算表沒有資料列。'])
    r.format = 'B'
    r.sheet_name = sheetName
    return r
  }

  // sheet_to_json's object keys de-duplicate repeated headers (`專利編號` →
  // `專利編號_1`), which is exactly what §2 asks for: the column appears twice
  // with identical values in all 1869 rows, so take one.
  const headers = Object.keys(rawRows[0])
  const C = FORMAT_B_COLUMNS
  const applicantCols = numberedColumns(headers, '申請人')
  const inventorCols = numberedColumns(headers, '發明人')
  const ipc5Cols = numberedColumns(headers, 'IPC5')
  const ipc3Cols = numberedColumns(headers, 'IPC3')
  const referenceCols = numberedColumns(headers, '參考文獻')
  const agentCols = numberedColumns(headers, '代理人')

  const field_mappings: FieldMapping[] = Object.keys(FIELD_SYNONYMS).map(field => {
    const direct = (C as Record<string, string | undefined>)[field]
    let matched: string | null = null
    if (direct && hasHeader(headers, direct)) matched = direct
    if (field === 'applicant' && applicantCols.length > 0) matched = applicantCols.join('、')
    return { field, matched_column: matched, required: REQUIRED_FIELDS.has(field) }
  })

  const missingRequired = field_mappings.filter(fm => fm.required && fm.matched_column === null)
  if (missingRequired.length > 0) {
    errors.push(`缺少必要欄位：${missingRequired.map(fm => fm.field).join('、')}（工作表「${sheetName}」）。`)
  }

  const warnings = emptyWarnings()
  const staged: StagedRow[] = []
  const currentYear = new Date().getFullYear()

  for (const row of rawRows) {
    // §1: trailing blank rows are dropped BEFORE any column statistic is taken.
    // Rows 1870–1887 of the sample have all 82 columns empty except 案件狀態;
    // counting first would invent two 案件狀態 values (未審查/公開, 核駁) that
    // no real patent in the file has.
    const patentNumberRaw = cellString(row, C.patent_number)
    if (!patentNumberRaw) continue

    const title = stripBom(cellString(row, C.title) ?? '')
    const abstract = stripBom(cellString(row, C.abstract) ?? '')
    if (!title || !abstract) {
      errors.push(`專利 ${patentNumberRaw} 缺少必要欄位（專利名稱 或 摘要），已略過。`)
      continue
    }

    const applicationNumberRaw = cellString(row, C.application_number)
    // §3.4 format B: 申請人1..5 are already clean names — do NOT run
    // cleanApplicantName()'s space truncation on them.
    const applicants = numberedValues(row, applicantCols)
    const inventors = numberedValues(row, inventorCols)

    const patent: PatentRow = {
      id: '',   // assigned by dedupePatents() from the merged fields (§4.5)
      title,
      abstract,
      applicant: applicants.join('；'),
    }
    if (applicants.length > 0) {
      patent.applicants = applicants
      patent.applicant_raw = applicants.join('；')
    }
    if (inventors.length > 0) patent.inventors = inventors
    patent.patent_number = patentNumberRaw
    if (applicationNumberRaw) patent.application_number = applicationNumberRaw

    // --- dates (§3.1) ---
    const filing = coerceDate(row[C.filing_date])
    const publication = coerceDate(row[C.publication_date])
    if (filing) patent.filing_date = filing
    if (publication) patent.publication_date = publication

    // --- IPC (§3.2) ---
    // Step 1 keeps the ORIGINAL cell text, untrimmed: the leading-space and
    // trailing-junk anomalies are exactly what makes this column auditable.
    const ipc5Raw: string[] = []
    for (const c of ipc5Cols) {
      const v = row[c]
      if (v === null || v === undefined) continue
      const s = String(v)
      if (s.trim() === '' || ipc5Raw.includes(s)) continue
      ipc5Raw.push(s)
    }
    const ipc5: string[] = []
    let primary: NormalizedIpc | null = null
    for (const col of ipc5Cols) {
      const value = cellString(row, col)
      if (!value) continue
      const norm = normalizeIpc5(value)
      if (!norm) {
        warnings.ipc_unparseable.push({ patent: patentNumberRaw, column: col, value })
        continue
      }
      if (!ipc5.includes(norm.key)) ipc5.push(norm.key)
      // ipc_primary comes from IPC5-1, i.e. the first column that yields a value
      if (!primary) primary = norm
    }
    if (ipc5Raw.length > 0) patent.ipc5_raw = ipc5Raw
    if (ipc5.length > 0) patent.ipc5 = ipc5
    if (primary) {
      patent.ipc_primary = primary.key
      patent.ipc_depth = primary.depth
    }

    // IPC3-n cross-check: the L3 set cut from IPC5-n should match IPC3-n.
    const fromIpc5 = uniqSorted(ipc5.map(ipcSubclass).filter((s): s is string => s !== null))
    const fromIpc3 = uniqSorted(
      numberedValues(row, ipc3Cols).map(v => v.replace(/[\s　]+/g, '').toUpperCase()),
    )
    if (fromIpc5.join(',') !== fromIpc3.join(',')) {
      warnings.ipc3_mismatch.push({ patent: patentNumberRaw, from_ipc5: fromIpc5, from_ipc3: fromIpc3 })
    }

    // --- references (§3.5) ---
    const references: string[] = []
    for (const col of referenceCols) {
      const value = cellString(row, col)
      if (!value) continue
      const norm = isUsableReference(value) ? normalizeReference(value) : null
      if (!norm) {
        warnings.reference_unparseable.push({ patent: patentNumberRaw, column: col, value })
        continue
      }
      if (!references.includes(norm)) references.push(norm)
    }
    if (references.length > 0) patent.references = references

    // --- remaining scalar columns (parsed and stored only, §5.4) ---
    const citedBy = cellString(row, C.cited_by_count)
    if (citedBy) {
      const n = Number.parseInt(citedBy.replace(/[^0-9-]/g, ''), 10)
      if (Number.isFinite(n)) patent.cited_by_count = n
    }
    const caseStatus = cellString(row, C.case_status)
    if (caseStatus) patent.case_status = caseStatus
    const designClass = cellString(row, C.design_class)
    if (designClass) patent.design_class = designClass

    patent.source_files = [filename]

    checkDateRange(warnings, patentNumberRaw, 'filing_date', patent.filing_date, currentYear)
    checkDateRange(warnings, patentNumberRaw, 'publication_date', patent.publication_date, currentYear)
    checkPublicationOrder(warnings, patentNumberRaw, patent)

    staged.push({
      row: patent,
      pn: normalizePatentNumber(patentNumberRaw),
      an: normalizeApplicationNumber(applicationNumberRaw),
      tk: normalizeTitleKey(title),
    })
  }

  const mappedColumns = new Set<string>([
    ...Object.values(C),
    ...applicantCols, ...inventorCols, ...ipc5Cols, ...ipc3Cols, ...referenceCols, ...agentCols,
  ])
  const unmapped = headers.filter(h => !mappedColumns.has(h))
  const merged = finalizeStaged(staged, warnings, dedupe)

  return {
    patents: merged.patents,
    field_mappings,
    total_rows: rawRows.length,
    filename,
    errors,
    format: 'B',
    sheet_name: sheetName,
    valid_rows: staged.length,
    unmapped_columns: unmapped,
    warnings: merged.warnings,
    citations: merged.citations,
  }
}

/** Accept an Excel serial (format B), a Date (cellDates), or a date string. */
function coerceDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return excelSerialToISODate(value)
  if (value instanceof Date) return excelSerialToISODate((value.getTime() - Date.UTC(1899, 11, 30)) / 86400000)
  const s = String(value).trim()
  if (!s) return undefined
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToISODate(Number(s))
  return s
}

function checkDateRange(
  warnings: DataQualityWarnings,
  patent: string,
  field: string,
  value: string | undefined,
  currentYear: number,
): void {
  if (!value) return
  const m = /^(\d{4})/.exec(value.trim())
  if (!m) {
    warnings.date_out_of_range.push({ patent, field, value })
    return
  }
  const y = Number(m[1])
  if (y < 1990 || y > currentYear + 1) {
    warnings.date_out_of_range.push({ patent, field, value })
  }
}

function checkPublicationOrder(warnings: DataQualityWarnings, patent: string, row: PatentRow): void {
  const f = dateSortKey(row.filing_date)
  const p = dateSortKey(row.publication_date)
  if (f && p && p < f) {
    warnings.publication_before_filing.push({
      patent,
      filing_date: row.filing_date!,
      publication_date: row.publication_date!,
    })
  }
}

// ---------------------------------------------------------------------------
// De-duplication (§4)
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]
      x = this.parent[x]
    }
    return x
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
}

/** Severity ladder for 案件狀態 (§4.4). Higher wins the merge. */
const CASE_STATUS_SEVERITY: Array<[RegExp, number]> = [
  [/核駁|不予專利|撤回|放棄|消滅|失效/, 3],
  [/未審查|公開/, 2],
]

function caseStatusSeverity(value: string): number {
  for (const [re, sev] of CASE_STATUS_SEVERITY) if (re.test(value)) return sev
  return 1
}

/**
 * §4.3's ordered decision procedure, evaluated for one pair.
 * FIRST MATCH WINS — the rules are not a parallel lookup table.
 */
type PairDecision =
  | { merge: true }
  | { merge: false; warn: 'patno_title_conflicts' | 'appno_collisions' | null }

export function decideMerge(a: StagedLike, b: StagedLike): PairDecision {
  // Rule 1 — both sides have a patent number.
  if (a.pn !== null && b.pn !== null) {
    if (a.pn === b.pn) {
      if (a.tk === b.tk) return { merge: true }                       // 1a
      return { merge: false, warn: 'patno_title_conflicts' }          // 1b
    }
    // 1c — different patent numbers never merge, even if 申請號 collides.
    if (a.an !== null && a.an === b.an) return { merge: false, warn: 'appno_collisions' }
    return { merge: false, warn: null }
  }
  // Rule 2 — at least one side lacks a patent number, both have 申請號.
  if (a.an !== null && b.an !== null) {
    if (a.an === b.an) {
      if (a.tk === b.tk) return { merge: true }                       // 2a
      return { merge: false, warn: 'appno_collisions' }               // 2b
    }
    return { merge: false, warn: null }                               // 2c
  }
  // Rule 3 — not enough identifiers on at least one side.
  return { merge: false, warn: null }
}

export interface StagedLike {
  pn: string | null
  an: string | null
  tk: string
}

interface DedupeOutcome {
  patents: PatentRow[]
  warnings: DataQualityWarnings
  citations: Array<{ from: string; to: string }>
}

/**
 * De-duplicate an already-parsed row set (§4.3 / §4.4 / §4.5).
 *
 * Exported so that the multi-file upload path — and the next stage's
 * persistence layer — can merge rows that came from different files without
 * re-reading the spreadsheets.
 */
export function dedupePatents(rows: PatentRow[]): DedupeOutcome & {
  original_count: number
  deduped_count: number
} {
  const warnings = emptyWarnings()
  const staged: StagedRow[] = rows.map(row => {
    const pn = normalizePatentNumber(row.patent_number)
    const an = normalizeApplicationNumber(row.application_number)
    if (pn === null && an === null) {
      warnings.no_identifier.push({ title: row.title, source_files: row.source_files ?? [] })
    }
    return { row, pn, an, tk: normalizeTitleKey(row.title) }
  })
  const outcome = dedupeStaged(staged, warnings)
  return {
    ...outcome,
    original_count: rows.length,
    deduped_count: outcome.patents.length,
  }
}

/** Either merge per §4.3, or just stamp per-row ids and keep the sheet order. */
function finalizeStaged(
  staged: StagedRow[],
  warnings: DataQualityWarnings,
  dedupe: boolean,
): DedupeOutcome {
  if (!dedupe) {
    const patents = staged.map(s => {
      const row = { ...s.row }
      row.id = stablePatentId(row)
      return row
    })
    sortWarnings(warnings)
    return { patents, warnings, citations: [] }
  }
  return dedupeStaged(staged, warnings)
}

function dedupeStaged(staged: StagedRow[], warnings: DataQualityWarnings): DedupeOutcome {
  const uf = new UnionFind(staged.length)

  // Only rows sharing a pn or an can ever merge (every other pair falls into
  // rule 1c / 2c / 3), so bucket first instead of comparing all pairs.
  const buckets = new Map<string, number[]>()
  const push = (key: string, i: number) => {
    const b = buckets.get(key)
    if (b) b.push(i)
    else buckets.set(key, [i])
  }
  staged.forEach((s, i) => {
    if (s.pn !== null) push(`pn:${s.pn}`, i)
    if (s.an !== null) push(`an:${s.an}`, i)
    // warnings.no_identifier is raised while staging (see parseFormatA), not
    // here, so that parseExcelFiles() does not record it twice.
  })

  const patnoConflicts = new Map<string, Set<string>>()
  const appnoCollisions = new Map<string, { titles: Set<string>; patent_numbers: Set<string> }>()

  for (const indices of buckets.values()) {
    for (let x = 0; x < indices.length; x++) {
      for (let y = x + 1; y < indices.length; y++) {
        const a = staged[indices[x]]
        const b = staged[indices[y]]
        const decision = decideMerge(a, b)
        if (decision.merge) {
          uf.union(indices[x], indices[y])
          continue
        }
        if (decision.warn === 'patno_title_conflicts') {
          const key = a.pn!
          const set = patnoConflicts.get(key) ?? new Set<string>()
          set.add(a.row.title)
          set.add(b.row.title)
          patnoConflicts.set(key, set)
        } else if (decision.warn === 'appno_collisions') {
          const key = a.an!
          const entry = appnoCollisions.get(key) ?? { titles: new Set<string>(), patent_numbers: new Set<string>() }
          entry.titles.add(a.row.title)
          entry.titles.add(b.row.title)
          if (a.row.patent_number) entry.patent_numbers.add(a.row.patent_number)
          if (b.row.patent_number) entry.patent_numbers.add(b.row.patent_number)
          appnoCollisions.set(key, entry)
        }
      }
    }
  }

  for (const [pn, titles] of patnoConflicts) {
    warnings.patno_title_conflicts.push({ patent_number: pn, titles: uniqSorted(titles) })
  }
  for (const [an, entry] of appnoCollisions) {
    warnings.appno_collisions.push({
      application_number: an,
      titles: uniqSorted(entry.titles),
      patent_numbers: uniqSorted(entry.patent_numbers),
    })
  }

  // Group and merge
  const groups = new Map<number, StagedRow[]>()
  staged.forEach((s, i) => {
    const root = uf.find(i)
    const g = groups.get(root)
    if (g) g.push(s)
    else groups.set(root, [s])
  })

  const patents: PatentRow[] = []
  for (const group of groups.values()) {
    patents.push(mergeGroup(group, warnings))
  }

  // §3.5 — resolve references against the FINAL patent set.
  const byPatentNumber = new Map<string, PatentRow>()
  for (const p of patents) {
    const key = normalizePatentNumber(p.patent_number)
    if (key && !byPatentNumber.has(key)) byPatentNumber.set(key, p)
  }
  const citations: Array<{ from: string; to: string }> = []
  for (const p of patents) {
    if (!p.references || p.references.length === 0) continue
    const internal: string[] = []
    const external: string[] = []
    for (const ref of p.references) {
      const target = byPatentNumber.get(ref)
      if (target && target.id !== p.id) {
        internal.push(ref)
        citations.push({ from: p.id, to: target.id })
      } else {
        external.push(ref)
      }
    }
    if (internal.length > 0) p.references = internal
    else delete p.references
    if (external.length > 0) p.external_references = external
  }

  sortWarnings(warnings)
  citations.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))
  patents.sort((a, b) => a.id.localeCompare(b.id))

  return { patents, warnings, citations }
}

/** Longest value wins; ties broken lexicographically (§4.4). */
function pickLongest(values: string[]): string {
  let best = values[0]
  for (const v of values.slice(1)) {
    if (v.length > best.length || (v.length === best.length && v < best)) best = v
  }
  return best
}

function pickEarliestDate(values: string[]): string | undefined {
  let best: string | undefined
  let bestKey: string | undefined
  for (const v of values) {
    const k = dateSortKey(v)
    if (!k) continue
    if (bestKey === undefined || k < bestKey || (k === bestKey && v < best!)) {
      best = v
      bestKey = k
    }
  }
  return best
}

function mergeGroup(group: StagedRow[], warnings: DataQualityWarnings): PatentRow {
  const rows = group.map(g => g.row)
  const label = () =>
    merged.patent_number ?? merged.application_number ?? merged.title

  const nonEmpty = (pick: (r: PatentRow) => string | undefined): string[] =>
    rows.map(pick).filter((v): v is string => typeof v === 'string' && v.length > 0)

  const merged: PatentRow = {
    id: '',
    title: pickLongest(rows.map(r => r.title)),
    abstract: pickLongest(rows.map(r => r.abstract)),
    applicant: '',
  }

  // patent_number — §4.4: take the non-empty one; when both are non-empty the
  // group only exists because rule 1a found them equal.
  const pns = nonEmpty(r => r.patent_number)
  if (pns.length > 0) merged.patent_number = pickLongest(uniqSorted(pns))

  // application_number — §4.4
  const ans = uniqSorted(nonEmpty(r => r.application_number))
  if (ans.length === 1) {
    merged.application_number = ans[0]
  } else if (ans.length > 1) {
    // Distinct raw spellings may still normalise to the same value (TW109208236
    // vs 109208236); only a genuine normalised disagreement is a conflict.
    const normalised = uniqSorted(
      ans.map(a => normalizeApplicationNumber(a)).filter((v): v is string => v !== null),
    )
    merged.application_number = ans[0]
    if (normalised.length > 1) {
      warnings.appno_conflicts.push({ chosen: ans[0], rejected: ans.slice(1), title: merged.title })
    }
  }

  const pubNos = uniqSorted(nonEmpty(r => r.publication_number))
  if (pubNos.length > 0) merged.publication_number = pubNos[0]

  const titleEns = nonEmpty(r => r.title_en)
  if (titleEns.length > 0) merged.title_en = pickLongest(titleEns)

  const filing = pickEarliestDate(nonEmpty(r => r.filing_date))
  if (filing) merged.filing_date = filing
  const publication = pickEarliestDate(nonEmpty(r => r.publication_date))
  if (publication) merged.publication_date = publication

  // --- list unions (§4.4) ---
  const applicants = uniqSorted(rows.flatMap(r => r.applicants ?? []))
  if (applicants.length > 0) merged.applicants = applicants
  const inventors = uniqSorted(rows.flatMap(r => r.inventors ?? []))
  if (inventors.length > 0) merged.inventors = inventors
  const ipc5 = uniqSorted(rows.flatMap(r => r.ipc5 ?? []))
  if (ipc5.length > 0) merged.ipc5 = ipc5
  const ipc5Raw = uniqSorted(rows.flatMap(r => r.ipc5_raw ?? []))
  if (ipc5Raw.length > 0) merged.ipc5_raw = ipc5Raw
  const refs = uniqSorted(rows.flatMap(r => r.references ?? []))
  if (refs.length > 0) merged.references = refs
  const extRefs = uniqSorted(rows.flatMap(r => r.external_references ?? []))
  if (extRefs.length > 0) merged.external_references = extRefs
  const sourceFiles = uniqSorted(rows.flatMap(r => r.source_files ?? []))
  if (sourceFiles.length > 0) merged.source_files = sourceFiles
  const keywords = uniqSorted(rows.flatMap(r => r.search_keywords ?? []))
  if (keywords.length > 0) merged.search_keywords = keywords

  // ipc_primary follows the winning group's IPC5-1: pick deterministically by
  // the smallest raw application number, so upload order cannot change it.
  const primarySource = [...group]
    .filter(g => g.row.ipc_primary !== undefined)
    .sort((a, b) => {
      const ka = a.row.application_number ?? ''
      const kb = b.row.application_number ?? ''
      if (ka !== kb) return ka.localeCompare(kb)
      if (a.tk !== b.tk) return a.tk.localeCompare(b.tk)
      // Final tiebreak so two rows that are indistinguishable by identifier
      // still resolve the same way regardless of which file came first.
      return a.row.ipc_primary!.localeCompare(b.row.ipc_primary!)
    })[0]
  if (primarySource) {
    merged.ipc_primary = primarySource.row.ipc_primary
    merged.ipc_depth = primarySource.row.ipc_depth
  }

  // applicant / applicant_raw — the legacy single-string fields.
  // For an unmerged group this reproduces the v1.2 value exactly (§7-5).
  // When a genuine cross-row merge happened (group.length > 1), pickLongest()
  // would silently drop every applicant that didn't win — instead join the
  // already-deduped applicants[] union so no company is lost.
  const applicantStrings = nonEmpty(r => r.applicant)
  if (group.length > 1 && merged.applicants && merged.applicants.length > 0) {
    merged.applicant = merged.applicants.join('；')
  } else {
    merged.applicant = applicantStrings.length > 0 ? pickLongest(applicantStrings) : ''
  }
  const applicantRaws = nonEmpty(r => r.applicant_raw)
  if (applicantRaws.length > 0) merged.applicant_raw = pickLongest(applicantRaws)
  const searchKeywords = nonEmpty(r => r.search_keyword)
  if (searchKeywords.length > 0) merged.search_keyword = pickLongest(uniqSorted(searchKeywords))

  const citedBy = rows.map(r => r.cited_by_count).filter((v): v is number => typeof v === 'number')
  if (citedBy.length > 0) merged.cited_by_count = Math.max(...citedBy)

  const designClasses = uniqSorted(nonEmpty(r => r.design_class))
  if (designClasses.length > 0) merged.design_class = designClasses[0]

  // case_status — §4.4: MOST CONSERVATIVE wins, never lexicographic.
  // 核准(U+6838) < 消滅(U+6D88), so a lexicographic minimum would turn a group
  // where one file says 消滅 and the other 核准 into 核准.
  const statuses = uniqSorted(nonEmpty(r => r.case_status))
  if (statuses.length > 0) {
    let best = statuses[0]
    for (const s of statuses.slice(1)) {
      if (caseStatusSeverity(s) > caseStatusSeverity(best)) best = s
    }
    merged.case_status = best
    if (statuses.length > 1) {
      warnings.case_status_conflicts.push({ patent: label(), values: statuses, resolved: best })
    }
  }

  // §4.6 — applicants are always unioned; a merged group whose two sides share
  // no normalised applicant at all is recorded for later inspection.
  if (group.length > 1) {
    const sides = group
      .filter(g => (g.row.applicants ?? []).length > 0)
      .map(g => ({
        applicants: uniqSorted(g.row.applicants ?? []),
        source_files: uniqSorted(g.row.source_files ?? []),
        keys: new Set((g.row.applicants ?? []).map(normalizeApplicantName)),
      }))
    let disjoint = false
    for (let i = 0; i < sides.length && !disjoint; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        if (![...sides[i].keys].some(k => sides[j].keys.has(k))) {
          disjoint = true
          break
        }
      }
    }
    if (disjoint) {
      const seen = new Set<string>()
      const uniqueSides: Array<{ applicants: string[]; source_files: string[] }> = []
      for (const s of sides) {
        const k = s.applicants.join('|')
        if (seen.has(k)) continue
        seen.add(k)
        uniqueSides.push({ applicants: s.applicants, source_files: s.source_files })
      }
      uniqueSides.sort((a, b) => a.applicants.join('|').localeCompare(b.applicants.join('|')))
      warnings.applicant_identity_conflicts.push({ patent: label(), sides: uniqueSides })
    }
  }

  merged.id = stablePatentId(merged)
  return merged
}

/**
 * §4.5 — stable content-derived id.
 *
 * `title_key` MUST be part of the key: without it the two rows of rule 1b
 * (same 專利編號, different title, deliberately NOT merged — 108211626 and
 * 109202820 in the sample) would receive the same id and collide on
 * `patents UNIQUE (analysis_id, node_id)`. insertRows() has no ON CONFLICT
 * clause, so withTransaction() would roll the whole analysis back after the
 * LLM cost had already been paid.
 *
 * The `noid` branch MUST also hash abstract / applicants / filing_date, or two
 * identifier-less rows that happen to share a title collide the same way.
 * sha1hex() wraps the WHOLE key string, not just the identifier.
 */
export function stablePatentId(row: PatentRow): string {
  const pn = normalizePatentNumber(row.patent_number)
  const an = normalizeApplicationNumber(row.application_number)
  const tk = normalizeTitleKey(row.title)
  const identityKey = pn
    ? `pn|${pn}|${tk}`
    : an
      ? `an|${an}|${tk}`
      : `noid|${tk}|${sha1hex(row.abstract)}|${[...(row.applicants ?? [])].sort().join(';')}|${row.filing_date ?? ''}`
  return sha1hex(identityKey)
}

/** Deterministic warning order, so reversing the upload order changes nothing. */
function sortWarnings(w: DataQualityWarnings): void {
  const byJson = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b))
  for (const key of Object.keys(w) as Array<keyof DataQualityWarnings>) {
    ;(w[key] as unknown[]).sort(byJson)
  }
}

function mergeWarningLists(target: DataQualityWarnings, source: DataQualityWarnings): void {
  for (const key of Object.keys(target) as Array<keyof DataQualityWarnings>) {
    ;(target[key] as unknown[]).push(...(source[key] as unknown[]))
  }
}

// ---------------------------------------------------------------------------
// parseExcelFiles — multi-file upload (§5.3)
//
// Per-file parsing happens independently, then §4.3's merge runs once over the
// union so that a patent appearing in both a format-A and a format-B file
// becomes one row with `source_files` listing both.
// ---------------------------------------------------------------------------
export function parseExcelFiles(
  files: Array<{ buffer: ArrayBuffer; filename: string }>,
): MultiParseResult {
  // Parse without per-file merging: the merge has to see all files at once
  // (a patent present in both a format-A and a format-B export merges via
  // rule 2a), and running it twice would double-record every warning.
  const results = files.map(f => parseExcel(f.buffer, f.filename, { dedupe: false }))
  const warnings = emptyWarnings()
  const rows: PatentRow[] = []

  for (const r of results) {
    // Per-row findings (dates, IPC, references, missing identifiers) are
    // file-local and already final. Identity findings are produced by the
    // combined merge below.
    warnings.date_out_of_range.push(...r.warnings.date_out_of_range)
    warnings.publication_before_filing.push(...r.warnings.publication_before_filing)
    warnings.ipc_unparseable.push(...r.warnings.ipc_unparseable)
    warnings.ipc3_mismatch.push(...r.warnings.ipc3_mismatch)
    warnings.reference_unparseable.push(...r.warnings.reference_unparseable)
    warnings.no_identifier.push(...r.warnings.no_identifier)
    rows.push(...r.patents)
  }

  const merged = dedupePatents(rows)
  mergeWarningLists(warnings, merged.warnings)
  // dedupePatents() re-derives no_identifier from the rows it was handed, so
  // drop its copy and keep the per-file one recorded above.
  warnings.no_identifier.splice(
    warnings.no_identifier.length - merged.warnings.no_identifier.length,
    merged.warnings.no_identifier.length,
  )
  sortWarnings(warnings)

  return {
    results,
    patents: merged.patents,
    original_count: results.reduce((n, r) => n + r.valid_rows, 0),
    deduped_count: merged.patents.length,
    warnings,
    citations: merged.citations,
    errors: results.flatMap(r => r.errors),
  }
}
