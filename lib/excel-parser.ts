/**
 * excel-parser.ts
 *
 * Parses .xlsx files into PatentRow[], performing automatic column detection
 * using synonym maps (PRD F-01) and applicant name cleaning (PRD F-05).
 */

import * as XLSX from 'xlsx'
import type { PatentRow } from '@/types/graph'

// ---------------------------------------------------------------------------
// FIELD_SYNONYMS — matches PRD F-01 table exactly
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
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Result of matching a single canonical field against the spreadsheet headers */
export interface FieldMapping {
  field: string
  matched_column: string | null
  required: boolean
}

/** The complete result returned by parseExcel() */
export interface ParseResult {
  patents: PatentRow[]
  field_mappings: FieldMapping[]
  total_rows: number
  filename: string
  errors: string[]
}

// Required canonical fields (title and abstract per PRD)
const REQUIRED_FIELDS = new Set(['title', 'abstract'])

// ---------------------------------------------------------------------------
// cleanApplicantName
//
// Cleaning rules (PRD F-05 / section 3.2):
//  1. Truncate at the first U+3000 (IDEOGRAPHIC SPACE) or ASCII space; keep
//     the prefix as the company name.
//  2. If the result still contains a trailing parenthetical (「（…）」or「(…)」),
//     truncate before it.
//  3. Trim residual whitespace.
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

// ---------------------------------------------------------------------------
// parseExcel
//
// Parses the first sheet of the supplied ArrayBuffer and returns a ParseResult.
//
// Multi-applicant handling:
//   Split the raw applicant cell on ；(full-width) or ;(half-width), clean each
//   part individually, then rejoin with ；.
// ---------------------------------------------------------------------------
export function parseExcel(buffer: ArrayBuffer, filename: string): ParseResult {
  const errors: string[] = []

  // Parse workbook
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return {
      patents: [],
      field_mappings: Object.keys(FIELD_SYNONYMS).map(field => ({
        field,
        matched_column: null,
        required: REQUIRED_FIELDS.has(field),
      })),
      total_rows: 0,
      filename,
      errors: ['試算表中找不到任何工作表。'],
    }
  }

  const sheet = workbook.Sheets[sheetName]
  // sheet_to_json with header:1 gives rows as arrays; we use defval:'' so all
  // cells are present.  The first element of the result is the header row.
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })

  if (rawRows.length === 0) {
    return {
      patents: [],
      field_mappings: Object.keys(FIELD_SYNONYMS).map(field => ({
        field,
        matched_column: null,
        required: REQUIRED_FIELDS.has(field),
      })),
      total_rows: 0,
      filename,
      errors: ['試算表沒有資料列。'],
    }
  }

  // Extract headers from the first data row's keys
  const headers = Object.keys(rawRows[0])
  const columnMap = buildColumnMap(headers)

  // Build field_mappings for UI display (PRD F-01: show which columns matched)
  const field_mappings: FieldMapping[] = Object.keys(FIELD_SYNONYMS).map(field => ({
    field,
    matched_column: columnMap.get(field) ?? null,
    required: REQUIRED_FIELDS.has(field),
  }))

  // Validate required fields
  const missingRequired = field_mappings.filter(fm => fm.required && fm.matched_column === null)
  if (missingRequired.length > 0) {
    const names = missingRequired.map(fm => fm.field).join('、')
    errors.push(`缺少必要欄位：${names}。請確認試算表包含以下欄位之一：${missingRequired.map(fm => FIELD_SYNONYMS[fm.field].join(' / ')).join('；')}`)
  }

  const patents: PatentRow[] = []

  rawRows.forEach((row, rowIndex) => {
    const titleCol = columnMap.get('title')
    const abstractCol = columnMap.get('abstract')

    // Skip rows where required fields are absent after mapping
    if (missingRequired.length > 0) return

    const title = titleCol ? cellString(row, titleCol) : undefined
    const abstract = abstractCol ? cellString(row, abstractCol) : undefined

    if (!title || !abstract) {
      // Skip blank rows silently; only log if data appears partially present
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
    if (applicantCol) {
      const rawApplicant = cellString(row, applicantCol) ?? ''
      applicantRaw = rawApplicant
      applicant = rawApplicant
        .split(/；|;/)
        .map(part => cleanApplicantName(part.trim()))
        .filter(part => part.length > 0)
        .join('；')
    }

    // Optional fields
    const filingDateCol = columnMap.get('filing_date')
    const appNumberCol = columnMap.get('application_number')

    const patent: PatentRow = {
      id: `${filename}-${rowIndex}`,
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

    patents.push(patent)
  })

  return {
    patents,
    field_mappings,
    total_rows: rawRows.length,
    filename,
    errors,
  }
}
