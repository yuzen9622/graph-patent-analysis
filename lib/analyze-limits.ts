/**
 * analyze-limits.ts — resource ceilings and body validation for the upload /
 * analyze endpoints (PRD v2 P0 §5.2), plus the small pure helpers the upload UI
 * needs for its per-file summary panel (§5.1, §5.3).
 *
 * Everything here is a pure function on plain data so it can be unit-tested
 * without a Postgres instance, a DOM, or a Next request: the route handlers do
 * nothing but read headers/body and hand the values over.
 *
 * Only `import type` is used for cross-module types, so importing this module
 * from a client component pulls no server code into the browser bundle.
 */

import type { PatentRow } from '@/types/graph'
import type { PatentExtras } from '@/lib/db/analyses'
import type { DataQualityWarnings, ExcelFormat, ParseResult } from '@/lib/excel-parser'

// ── Limits ──────────────────────────────────────────────────────────────────

export interface Limits {
  /** `POST /api/uploads`: bytes of a single file. */
  uploadMaxFileBytes: number
  /** `POST /api/uploads`: files accepted in one request. */
  uploadMaxFiles: number
  /** `POST /api/uploads`: summed bytes of one request (Content-Length precheck). */
  uploadMaxTotalBytes: number
  /** `POST /api/analyze`: `patents.length` — over this the request is refused, never truncated. */
  analyzeMaxPatents: number
  /** `POST /api/analyze`: body bytes (Content-Length precheck). */
  analyzeMaxBodyBytes: number
}

export const DEFAULT_LIMITS: Limits = {
  uploadMaxFileBytes: 50 * 1024 * 1024,
  uploadMaxFiles: 10,
  uploadMaxTotalBytes: 100 * 1024 * 1024,
  analyzeMaxPatents: 20000,
  analyzeMaxBodyBytes: 100 * 1024 * 1024,
}

/** Environment variable per limit — every ceiling is overridable (§5.2). */
export const LIMIT_ENV_KEYS: Record<keyof Limits, string> = {
  uploadMaxFileBytes: 'UPLOAD_MAX_FILE_BYTES',
  uploadMaxFiles: 'UPLOAD_MAX_FILES',
  uploadMaxTotalBytes: 'UPLOAD_MAX_TOTAL_BYTES',
  analyzeMaxPatents: 'ANALYZE_MAX_PATENTS',
  analyzeMaxBodyBytes: 'ANALYZE_MAX_BODY_BYTES',
}

/** A malformed or non-positive override is ignored rather than disabling a limit. */
export function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

export function readLimits(env: Record<string, string | undefined> = process.env): Limits {
  const keys = Object.keys(DEFAULT_LIMITS) as Array<keyof Limits>
  const limits = { ...DEFAULT_LIMITS }
  for (const key of keys) {
    limits[key] = positiveInt(env[LIMIT_ENV_KEYS[key]], DEFAULT_LIMITS[key])
  }
  return limits
}

// ── Failures ────────────────────────────────────────────────────────────────

/** A rejected request: the message goes to the user, the status to the client. */
export interface LimitFailure {
  error: string
  status: 400 | 413
}

function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * Content-Length precheck. Runs *before* `formData()` / `json()` so an oversized
 * body is refused without ever being buffered into memory.
 *
 * A missing or unparseable header cannot be checked — the per-item checks that
 * follow are the backstop, so this returns `null` (proceed) in that case.
 */
export function checkContentLength(header: string | null, maxBytes: number): LimitFailure | null {
  if (!header) return null
  const declared = Number(header)
  if (!Number.isFinite(declared) || declared < 0) return null
  if (declared > maxBytes) {
    return {
      status: 413,
      error: `請求內容 ${mb(declared)} 超過單次 ${mb(maxBytes)} 上限。`,
    }
  }
  return null
}

/**
 * Next 16 clones and buffers the request body whenever a proxy (the file that
 * used to be `middleware.ts`) exists, capped by
 * `experimental.proxyClientMaxBodySize` — **10 MB by default**. Past that cap
 * the body is *silently truncated*: the request still reaches the handler, just
 * incomplete, and nothing is reported to the client
 * (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`).
 *
 * `proxy.ts` matches `/((?!_next/static|_next/image|favicon.ico).*)`, so both
 * `/api/uploads` and `/api/analyze` are affected and this cap currently sits
 * *below* the §5.2 ceilings. Rather than let a 30 MB body arrive half-eaten and
 * fail as "Invalid JSON body", it is refused here with a message that names the
 * real cause.
 *
 * Raise `experimental.proxyClientMaxBodySize` in `next.config.ts` and this
 * environment variable together to lift both.
 */
export const PROXY_BODY_ENV_KEY = 'PROXY_CLIENT_MAX_BODY_BYTES'
export const DEFAULT_PROXY_BODY_BYTES = 10 * 1024 * 1024

export function proxyBodyBytes(env: Record<string, string | undefined> = process.env): number {
  return positiveInt(env[PROXY_BODY_ENV_KEY], DEFAULT_PROXY_BODY_BYTES)
}

export function checkProxyBodyLimit(
  header: string | null,
  env: Record<string, string | undefined> = process.env,
): LimitFailure | null {
  const cap = proxyBodyBytes(env)
  if (!checkContentLength(header, cap)) return null
  return {
    status: 413,
    error:
      `請求內容超過 ${mb(cap)}，Next.js 的 proxy 會把超出部分截斷，因此直接拒絕。` +
      `請減少單次上傳的資料量，或請管理者調高 next.config.ts 的 experimental.proxyClientMaxBodySize` +
      `（並同步設定 ${PROXY_BODY_ENV_KEY}）。`,
  }
}

// ── POST /api/uploads ───────────────────────────────────────────────────────

/** Just enough of `File` to validate — keeps the check testable without a DOM. */
export interface UploadCandidate {
  name: string
  size: number
}

/**
 * Validates one multi-file upload request (§5.3). The file-count ceiling is
 * checked first so an 11-file request is refused before any per-file work.
 */
export function validateUploadFiles(
  files: UploadCandidate[],
  limits: Limits = DEFAULT_LIMITS,
): LimitFailure | null {
  if (files.length === 0) {
    return { status: 400, error: '缺少 file 欄位。' }
  }
  if (files.length > limits.uploadMaxFiles) {
    return {
      status: 413,
      error: `一次最多上傳 ${limits.uploadMaxFiles} 個檔案，這次收到 ${files.length} 個。`,
    }
  }

  let total = 0
  for (const file of files) {
    if (!/\.xlsx$/i.test(file.name)) {
      return { status: 400, error: `不支援的格式「${file.name}」，請上傳 .xlsx 檔案。` }
    }
    if (file.size === 0) {
      return { status: 400, error: `檔案「${file.name}」是空的。` }
    }
    if (file.size > limits.uploadMaxFileBytes) {
      return {
        status: 413,
        error: `檔案「${file.name}」${mb(file.size)} 超過單檔 ${mb(limits.uploadMaxFileBytes)} 上限。`,
      }
    }
    total += file.size
  }

  if (total > limits.uploadMaxTotalBytes) {
    return {
      status: 413,
      error: `這批檔案共 ${mb(total)}，超過單次 ${mb(limits.uploadMaxTotalBytes)} 上限。`,
    }
  }
  return null
}

// ── POST /api/analyze ───────────────────────────────────────────────────────

export const ANALYZE_PROVIDERS = ['nvidia', 'gemini', 'openai'] as const

export type Citation = { from: string; to: string }

export interface AnalyzeRequestBody {
  provider?: unknown
  sample_size?: unknown
  patents?: unknown
  /** Legacy single-file fields, still accepted. */
  upload_id?: unknown
  filename?: unknown
  /** Multi-file fields (§5.3). */
  upload_ids?: unknown
  filenames?: unknown
  /** Parser output that only exists in the browser (§5-5 / §9-7). */
  citations?: unknown
  warnings?: unknown
}

export interface AnalyzeRequest {
  provider: (typeof ANALYZE_PROVIDERS)[number]
  patents: PatentRow[]
  /** Already clamped to `[1, min(analyzeMaxPatents, patents.length)]`. */
  sampleSize: number
  uploadIds: string[]
  filenames: string[]
  citations: Citation[]
  warnings: unknown
}

/**
 * Clamps `sample_size` into `[1, min(max, patentCount)]` (§5.2).
 *
 * An absent or unusable value means "all of them" — the 2026-08-05 decision
 * that the default sample is the whole deduplicated set, not 50.
 */
export function resolveSampleSize(raw: unknown, patentCount: number, max: number): number {
  const ceiling = Math.max(1, Math.min(max, patentCount))
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) return ceiling
  return Math.max(1, Math.min(ceiling, Math.floor(value)))
}

/** The default the upload UI puts in the sample box: everything, after dedupe. */
export function defaultSampleSize(dedupedCount: number, max: number = DEFAULT_LIMITS.analyzeMaxPatents): number {
  if (!Number.isFinite(dedupedCount) || dedupedCount <= 0) return 1
  return Math.max(1, Math.min(max, Math.floor(dedupedCount)))
}

function stringList(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim() ? [raw] : []
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}

/** Keeps only well-formed `{from,to}` pairs so a hostile body cannot reach the DB. */
export function normalizeCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { from, to } = item as { from?: unknown; to?: unknown }
    if (typeof from !== 'string' || typeof to !== 'string') continue
    if (!from || !to) continue
    const key = `${from} ${to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to })
  }
  return out
}

/**
 * Validates `POST /api/analyze`'s JSON body. Over-long patent arrays are
 * refused with 413 and never silently truncated (§5.2).
 */
export function validateAnalyzeBody(
  body: unknown,
  limits: Limits = DEFAULT_LIMITS,
): { ok: true; value: AnalyzeRequest } | { ok: false; failure: LimitFailure } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, failure: { status: 400, error: 'Invalid JSON body' } }
  }
  const raw = body as AnalyzeRequestBody

  const provider = raw.provider
  if (typeof provider !== 'string' || !ANALYZE_PROVIDERS.includes(provider as AnalyzeRequest['provider'])) {
    return {
      ok: false,
      failure: { status: 400, error: `provider must be one of: ${ANALYZE_PROVIDERS.join(', ')}` },
    }
  }

  const patents = raw.patents
  if (!Array.isArray(patents) || patents.length === 0) {
    return { ok: false, failure: { status: 400, error: 'patents must be a non-empty array' } }
  }
  if (patents.length > limits.analyzeMaxPatents) {
    return {
      ok: false,
      failure: {
        status: 413,
        error: `專利筆數 ${patents.length} 超過單次分析上限 ${limits.analyzeMaxPatents}，請拆分檔案後再試。`,
      },
    }
  }

  const filenames = stringList(raw.filenames)
  const legacyName = stringList(raw.filename)
  const uploadIds = stringList(raw.upload_ids)
  const legacyId = stringList(raw.upload_id)

  return {
    ok: true,
    value: {
      provider: provider as AnalyzeRequest['provider'],
      patents: patents as PatentRow[],
      sampleSize: resolveSampleSize(raw.sample_size, patents.length, limits.analyzeMaxPatents),
      uploadIds: uploadIds.length > 0 ? uploadIds : legacyId,
      filenames: filenames.length > 0 ? filenames : legacyName,
      citations: normalizeCitations(raw.citations),
      warnings:
        raw.warnings && typeof raw.warnings === 'object' && !Array.isArray(raw.warnings)
          ? raw.warnings
          : undefined,
    },
  }
}

// ── PatentExtras mapping ────────────────────────────────────────────────────

function nonEmptyArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.filter((v): v is string => typeof v === 'string' && v !== '')
  // An empty list must stay `undefined`: saveGraph() writes `?? null`, and an
  // empty array in the column would be a "{} impostor" for "unknown" (§7-1).
  return list.length > 0 ? list : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Collects the per-patent columns that have no home on `GraphNode` (§6.2).
 *
 * Absent values are left `undefined` on purpose: `saveGraph()` writes
 * `extra?.x ?? null`, so an omitted field becomes SQL NULL rather than
 * `''`/`0`/`{}` — the "0 impostor" the PRD forbids (§7-1).
 */
export function toPatentExtras(patent: PatentRow, translatedAbstract?: string): PatentExtras {
  const extras: PatentExtras = {}
  const searchKeyword = nonEmptyString(patent.search_keyword)
  if (searchKeyword) extras.search_keyword = searchKeyword
  const translated = nonEmptyString(translatedAbstract)
  if (translated) extras.translated_abstract = translated
  const patentNumber = nonEmptyString(patent.patent_number)
  if (patentNumber) extras.patent_number = patentNumber
  const publicationNumber = nonEmptyString(patent.publication_number)
  if (publicationNumber) extras.publication_number = publicationNumber
  const publicationDate = nonEmptyString(patent.publication_date)
  if (publicationDate) extras.publication_date = publicationDate
  const ipc5Raw = nonEmptyArray(patent.ipc5_raw)
  if (ipc5Raw) extras.ipc5_raw = ipc5Raw
  const designClass = nonEmptyString(patent.design_class)
  if (designClass) extras.design_class = designClass
  const externalReferences = nonEmptyArray(patent.external_references)
  if (externalReferences) extras.external_references = externalReferences
  return extras
}

// ── Upload UI summaries (§5.1, §5.3) ────────────────────────────────────────

export const FORMAT_LABELS: Record<ExcelFormat, string> = {
  A: '爬蟲版 A',
  B: '老師版 B',
}

export interface FileSummary {
  filename: string
  format: ExcelFormat
  formatLabel: string
  sheetName: string
  /** Valid data rows in this file, before the cross-file merge. */
  validRows: number
  unmappedColumns: string[]
  errors: string[]
}

/** One panel section per uploaded file (§5.3's UI requirement). */
export function buildFileSummaries(results: Pick<ParseResult, 'filename' | 'format' | 'sheet_name' | 'valid_rows' | 'unmapped_columns' | 'errors'>[]): FileSummary[] {
  return results.map((result) => ({
    filename: result.filename,
    format: result.format,
    formatLabel: FORMAT_LABELS[result.format] ?? result.format,
    sheetName: result.sheet_name,
    validRows: result.valid_rows,
    unmappedColumns: result.unmapped_columns ?? [],
    errors: result.errors ?? [],
  }))
}

/** Human-readable label per warning bucket, for the expandable summary. */
export const WARNING_LABELS: Record<keyof DataQualityWarnings, string> = {
  date_out_of_range: '日期超出合理範圍',
  publication_before_filing: '公告日早於申請日',
  ipc_unparseable: 'IPC 無法解析',
  ipc3_mismatch: 'IPC3 與 IPC5 不一致',
  reference_unparseable: '參考文獻無法解析',
  patno_title_conflicts: '同專利號但名稱不同（未合併）',
  appno_collisions: '同申請號但未合併',
  appno_conflicts: '合併後申請號衝突',
  no_identifier: '無專利號與申請號',
  case_status_conflicts: '案件狀態衝突',
  applicant_identity_conflicts: '申請人身分衝突',
}

export interface WarningCount {
  key: keyof DataQualityWarnings
  label: string
  count: number
}

/**
 * Per-bucket warning counts, largest first. Empty buckets are dropped so the
 * summary only shows what actually happened; `total` is the sum of all buckets.
 */
export function summarizeWarnings(
  warnings: DataQualityWarnings | null | undefined,
): { rows: WarningCount[]; total: number } {
  if (!warnings) return { rows: [], total: 0 }
  const keys = Object.keys(WARNING_LABELS) as Array<keyof DataQualityWarnings>
  const rows: WarningCount[] = []
  let total = 0
  for (const key of keys) {
    const bucket = warnings[key]
    const count = Array.isArray(bucket) ? bucket.length : 0
    total += count
    if (count > 0) rows.push({ key, label: WARNING_LABELS[key], count })
  }
  rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  return { rows, total }
}

// ── History display (§6.3) ──────────────────────────────────────────────────

/**
 * What the history sidebar shows for an analysis backed by several files.
 * A single file keeps its plain name so existing entries look unchanged.
 */
export function formatUploadLabel(filenames: string[]): string {
  const names = filenames.filter((n) => typeof n === 'string' && n.trim() !== '')
  if (names.length === 0) return '(未命名)'
  if (names.length === 1) return names[0]
  return `${names.length} 個檔（${names.join('、')}）`
}
