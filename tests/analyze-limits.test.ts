/**
 * analyze-limits.test.ts — PRD v2 / P0 stage 3 (API 與畫面)
 *
 * The route handlers and the upload UI keep no logic of their own: every rule
 * §5.1/§5.2/§5.3 states lives in `lib/analyze-limits.ts` as a pure function, so
 * it can be tested here without Postgres, without a DOM, and without building a
 * Next request. The last block feeds the real spreadsheet fixtures through the
 * panel assembly so the "合計 N → 去重後 M" line is checked against real data.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANALYZE_PROVIDERS,
  DEFAULT_LIMITS,
  FORMAT_LABELS,
  LIMIT_ENV_KEYS,
  PROXY_BODY_ENV_KEY,
  buildFileSummaries,
  checkContentLength,
  checkProxyBodyLimit,
  proxyBodyBytes,
  defaultSampleSize,
  formatUploadLabel,
  normalizeCitations,
  positiveInt,
  readLimits,
  resolveSampleSize,
  summarizeWarnings,
  toPatentExtras,
  validateAnalyzeBody,
  validateUploadFiles,
  type Limits,
} from '@/lib/analyze-limits'
import { toHistoryEntry } from '@/lib/analysis-history'
import { emptyWarnings, parseExcelFiles } from '@/lib/excel-parser'
import type { PatentRow } from '@/types/graph'

const MB = 1024 * 1024
const ROOT = path.resolve(__dirname, '..')
const FIXTURES = path.join(ROOT, 'tests', 'fixtures')

function buffer(file: string): ArrayBuffer {
  const b = fs.readFileSync(file)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function limits(overrides: Partial<Limits> = {}): Limits {
  return { ...DEFAULT_LIMITS, ...overrides }
}

// ===========================================================================
// §5.2 limits and their environment overrides
// ===========================================================================
describe('resource limits (§5.2)', () => {
  it('ships the PRD table as defaults', () => {
    expect(DEFAULT_LIMITS).toEqual({
      uploadMaxFileBytes: 50 * MB,
      uploadMaxFiles: 10,
      uploadMaxTotalBytes: 100 * MB,
      analyzeMaxPatents: 20000,
      analyzeMaxBodyBytes: 100 * MB,
    })
  })

  it('every limit is overridable by an environment variable', () => {
    const env: Record<string, string> = {
      [LIMIT_ENV_KEYS.uploadMaxFileBytes]: '123',
      [LIMIT_ENV_KEYS.uploadMaxFiles]: '3',
      [LIMIT_ENV_KEYS.uploadMaxTotalBytes]: '456',
      [LIMIT_ENV_KEYS.analyzeMaxPatents]: '7',
      [LIMIT_ENV_KEYS.analyzeMaxBodyBytes]: '89',
    }
    expect(readLimits(env)).toEqual({
      uploadMaxFileBytes: 123,
      uploadMaxFiles: 3,
      uploadMaxTotalBytes: 456,
      analyzeMaxPatents: 7,
      analyzeMaxBodyBytes: 89,
    })
  })

  it('falls back to the default when an override is missing or unusable', () => {
    expect(positiveInt(undefined, 9)).toBe(9)
    expect(positiveInt('', 9)).toBe(9)
    expect(positiveInt('abc', 9)).toBe(9)
    expect(positiveInt('0', 9)).toBe(9)
    expect(positiveInt('-5', 9)).toBe(9)
    expect(positiveInt('12.7', 9)).toBe(12)
    // A single bad value must not disable the other ceilings.
    expect(readLimits({ [LIMIT_ENV_KEYS.uploadMaxFiles]: 'nope' })).toEqual(DEFAULT_LIMITS)
  })
})

describe('Content-Length precheck (§5.2)', () => {
  it('refuses an oversized body with 413 before it is buffered', () => {
    const failure = checkContentLength(String(150 * MB), 100 * MB)
    expect(failure?.status).toBe(413)
    expect(failure?.error).toContain('100 MB')
  })

  it('lets a body at or below the ceiling through', () => {
    expect(checkContentLength(String(100 * MB), 100 * MB)).toBeNull()
    expect(checkContentLength('1024', 100 * MB)).toBeNull()
  })

  it('cannot judge a missing or malformed header, so it proceeds', () => {
    expect(checkContentLength(null, 100 * MB)).toBeNull()
    expect(checkContentLength('', 100 * MB)).toBeNull()
    expect(checkContentLength('chunked', 100 * MB)).toBeNull()
    expect(checkContentLength('-1', 100 * MB)).toBeNull()
  })
})

describe("Next proxy's own body cap", () => {
  it('refuses a body over the 10 MB proxy buffer instead of letting it be truncated', () => {
    const failure = checkProxyBodyLimit(String(11 * MB), {})
    expect(failure?.status).toBe(413)
    expect(failure?.error).toContain('proxyClientMaxBodySize')
    expect(proxyBodyBytes({})).toBe(10 * MB)
  })

  it('lets a body inside the cap through', () => {
    expect(checkProxyBodyLimit(String(9 * MB), {})).toBeNull()
    expect(checkProxyBodyLimit(null, {})).toBeNull()
  })

  it('follows the environment override so both caps can be lifted together', () => {
    expect(proxyBodyBytes({ [PROXY_BODY_ENV_KEY]: String(64 * MB) })).toBe(64 * MB)
    expect(checkProxyBodyLimit(String(11 * MB), { [PROXY_BODY_ENV_KEY]: String(64 * MB) })).toBeNull()
  })
})

// ===========================================================================
// §5.3 POST /api/uploads
// ===========================================================================
describe('validateUploadFiles (§5.2, §5.3)', () => {
  const ok = (name: string, size = 1024) => ({ name, size })

  it('accepts a multi-file batch within every ceiling', () => {
    expect(validateUploadFiles([ok('a.xlsx'), ok('b.xlsx')])).toBeNull()
  })

  it('rejects an empty request with 400', () => {
    const failure = validateUploadFiles([])
    expect(failure?.status).toBe(400)
    expect(failure?.error).toBe('缺少 file 欄位。')
  })

  it('rejects an 11-file request with 413 (§9-10)', () => {
    const files = Array.from({ length: 11 }, (_, i) => ok(`f${i}.xlsx`))
    const failure = validateUploadFiles(files)
    expect(failure?.status).toBe(413)
    expect(failure?.error).toContain('10 個檔案')
    // Exactly 10 is still fine.
    expect(validateUploadFiles(files.slice(0, 10))).toBeNull()
  })

  it('rejects a non-xlsx file with 400 and names it', () => {
    const failure = validateUploadFiles([ok('a.xlsx'), ok('notes.csv')])
    expect(failure?.status).toBe(400)
    expect(failure?.error).toContain('notes.csv')
  })

  it('accepts an upper-case extension', () => {
    expect(validateUploadFiles([ok('A.XLSX')])).toBeNull()
  })

  it('rejects an empty file with 400', () => {
    const failure = validateUploadFiles([ok('a.xlsx', 0)])
    expect(failure?.status).toBe(400)
    expect(failure?.error).toContain('是空的')
  })

  it('rejects a file over the 50 MB single-file ceiling with 413', () => {
    const failure = validateUploadFiles([ok('big.xlsx', 50 * MB + 1)])
    expect(failure?.status).toBe(413)
    expect(validateUploadFiles([ok('big.xlsx', 50 * MB)])).toBeNull()
  })

  it('rejects a batch whose summed bytes pass the 100 MB ceiling with 413', () => {
    const files = [ok('a.xlsx', 40 * MB), ok('b.xlsx', 40 * MB), ok('c.xlsx', 30 * MB)]
    const failure = validateUploadFiles(files)
    expect(failure?.status).toBe(413)
    expect(failure?.error).toContain('這批檔案共')
  })

  it('honours overridden ceilings', () => {
    expect(validateUploadFiles([ok('a.xlsx'), ok('b.xlsx')], limits({ uploadMaxFiles: 1 }))?.status).toBe(413)
    expect(validateUploadFiles([ok('a.xlsx', 2048)], limits({ uploadMaxFileBytes: 1024 }))?.status).toBe(413)
  })
})

// ===========================================================================
// §5.2 sample size
// ===========================================================================
describe('sample size (§5.2)', () => {
  it('defaults to the whole de-duplicated set, not 50', () => {
    expect(defaultSampleSize(1741, 20000)).toBe(1741)
    expect(defaultSampleSize(43, 20000)).toBe(43)
  })

  it('never proposes more than the ceiling, nor less than one', () => {
    expect(defaultSampleSize(30000, 20000)).toBe(20000)
    expect(defaultSampleSize(0, 20000)).toBe(1)
    expect(defaultSampleSize(Number.NaN, 20000)).toBe(1)
  })

  it('clamps sample_size into [1, min(max, patents.length)]', () => {
    expect(resolveSampleSize(1e9, 1741, 20000)).toBe(1741)
    expect(resolveSampleSize(1e9, 30000, 20000)).toBe(20000)
    expect(resolveSampleSize(0, 1741, 20000)).toBe(1)
    expect(resolveSampleSize(-5, 1741, 20000)).toBe(1)
    expect(resolveSampleSize(30, 1741, 20000)).toBe(30)
    expect(resolveSampleSize(30.9, 1741, 20000)).toBe(30)
  })

  it('treats an absent or unusable sample_size as "all of them"', () => {
    expect(resolveSampleSize(undefined, 1741, 20000)).toBe(1741)
    expect(resolveSampleSize(null, 1741, 20000)).toBe(1741)
    expect(resolveSampleSize('', 1741, 20000)).toBe(1741)
    expect(resolveSampleSize('abc', 1741, 20000)).toBe(1741)
    expect(resolveSampleSize({}, 1741, 20000)).toBe(1741)
  })
})

// ===========================================================================
// POST /api/analyze body validation
// ===========================================================================
describe('validateAnalyzeBody (§5.2, §5.3)', () => {
  const patent = (id: string): PatentRow => ({ id, title: `T${id}`, abstract: 'A', applicant: 'X' })
  const body = (extra: Record<string, unknown> = {}) => ({
    provider: 'gemini',
    patents: [patent('1'), patent('2')],
    ...extra,
  })

  it('rejects a non-object body', () => {
    for (const raw of [null, 'x', 42, []]) {
      const result = validateAnalyzeBody(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toEqual({ status: 400, error: 'Invalid JSON body' })
    }
  })

  it('rejects an unknown provider with 400', () => {
    const result = validateAnalyzeBody(body({ provider: 'anthropic' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.status).toBe(400)
      expect(result.failure.error).toBe(`provider must be one of: ${ANALYZE_PROVIDERS.join(', ')}`)
    }
  })

  it('rejects an empty or non-array patents field with 400', () => {
    for (const patents of [undefined, [], 'x', {}]) {
      const result = validateAnalyzeBody(body({ patents }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.failure.status).toBe(400)
        expect(result.failure.error).toBe('patents must be a non-empty array')
      }
    }
  })

  it('refuses 21000 patents with 413 instead of truncating (§9-10)', () => {
    const patents = Array.from({ length: 21000 }, (_, i) => patent(String(i)))
    const result = validateAnalyzeBody({ provider: 'gemini', patents })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.status).toBe(413)
      expect(result.failure.error).toContain('21000')
      expect(result.failure.error).toContain('20000')
    }
  })

  it('accepts exactly the ceiling', () => {
    const patents = Array.from({ length: 25 }, (_, i) => patent(String(i)))
    const result = validateAnalyzeBody({ provider: 'gemini', patents }, limits({ analyzeMaxPatents: 25 }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.sampleSize).toBe(25)
  })

  it('clamps sample_size rather than passing 1e9 into slice()', () => {
    const result = validateAnalyzeBody(body({ sample_size: 1e9 }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.sampleSize).toBe(2)
  })

  it('reads the multi-file fields and keeps the legacy single ones working', () => {
    const multi = validateAnalyzeBody(
      body({ filenames: ['a.xlsx', 'b.xlsx'], upload_ids: ['u1', 'u2'] }),
    )
    expect(multi.ok).toBe(true)
    if (multi.ok) {
      expect(multi.value.filenames).toEqual(['a.xlsx', 'b.xlsx'])
      expect(multi.value.uploadIds).toEqual(['u1', 'u2'])
    }

    const legacy = validateAnalyzeBody(body({ filename: 'old.xlsx', upload_id: 'u9' }))
    expect(legacy.ok).toBe(true)
    if (legacy.ok) {
      expect(legacy.value.filenames).toEqual(['old.xlsx'])
      expect(legacy.value.uploadIds).toEqual(['u9'])
    }

    const none = validateAnalyzeBody(body())
    expect(none.ok).toBe(true)
    if (none.ok) {
      expect(none.value.filenames).toEqual([])
      expect(none.value.uploadIds).toEqual([])
    }
  })

  it('forwards the browser-side parser output (§5-5)', () => {
    const warnings = { ...emptyWarnings(), ipc_unparseable: [{ patent: 'p', column: 'IPC5-1', value: '??' }] }
    const result = validateAnalyzeBody(
      body({ citations: [{ from: 'a', to: 'b' }], warnings }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.citations).toEqual([{ from: 'a', to: 'b' }])
      expect(result.value.warnings).toBe(warnings)
    }
  })

  it('drops malformed citations and non-object warnings', () => {
    const result = validateAnalyzeBody(
      body({
        citations: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'a' }, 'x', null, { from: 1, to: 2 }],
        warnings: 'boom',
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.citations).toEqual([{ from: 'a', to: 'b' }])
      expect(result.value.warnings).toBeUndefined()
    }
    expect(normalizeCitations(undefined)).toEqual([])
  })
})

// ===========================================================================
// §6.2 PatentExtras mapping
// ===========================================================================
describe('toPatentExtras (§6.2)', () => {
  it('carries all eight non-GraphNode columns off the PatentRow', () => {
    const row: PatentRow = {
      id: 'x',
      title: 'T',
      abstract: 'A',
      applicant: 'X',
      search_keyword: '金融科技',
      patent_number: 'M628244',
      publication_number: 'TW202145078A',
      publication_date: '2021-12-01',
      ipc5_raw: [' G06Q-010/10', 'G06K-09/00'],
      design_class: '11-02',
      external_references: ['CN112345', 'JP2020-1'],
    }
    expect(toPatentExtras(row, '譯文')).toEqual({
      search_keyword: '金融科技',
      translated_abstract: '譯文',
      patent_number: 'M628244',
      publication_number: 'TW202145078A',
      publication_date: '2021-12-01',
      ipc5_raw: [' G06Q-010/10', 'G06K-09/00'],
      design_class: '11-02',
      external_references: ['CN112345', 'JP2020-1'],
    })
  })

  it('omits absent values so saveGraph() writes NULL, never a 0/""/{} impostor', () => {
    const row: PatentRow = { id: 'x', title: 'T', abstract: 'A', applicant: 'X' }
    expect(toPatentExtras(row)).toEqual({})
    expect(toPatentExtras({ ...row, ipc5_raw: [], external_references: [] })).toEqual({})
    expect(toPatentExtras({ ...row, patent_number: '', design_class: '   ' })).toEqual({})
    expect(toPatentExtras(row, '')).toEqual({})
  })
})

// ===========================================================================
// §5.1 / §5.3 upload panel assembly
// ===========================================================================
describe('per-file summaries and warning counts (§5.1, §5.3)', () => {
  it('labels the two formats the way the panel shows them', () => {
    expect(FORMAT_LABELS.A).toBe('爬蟲版 A')
    expect(FORMAT_LABELS.B).toBe('老師版 B')
  })

  it('assembles one section per file', () => {
    const summaries = buildFileSummaries([
      {
        filename: 'crawler.xlsx',
        format: 'A',
        sheet_name: 'Sheet1',
        valid_rows: 3,
        unmapped_columns: ['備註'],
        errors: [],
      },
      {
        filename: 'teacher.xlsx',
        format: 'B',
        sheet_name: '原始資料',
        valid_rows: 42,
        unmapped_columns: [],
        errors: ['某欄無法解析'],
      },
    ])
    expect(summaries).toEqual([
      {
        filename: 'crawler.xlsx',
        format: 'A',
        formatLabel: '爬蟲版 A',
        sheetName: 'Sheet1',
        validRows: 3,
        unmappedColumns: ['備註'],
        errors: [],
      },
      {
        filename: 'teacher.xlsx',
        format: 'B',
        formatLabel: '老師版 B',
        sheetName: '原始資料',
        validRows: 42,
        unmappedColumns: [],
        errors: ['某欄無法解析'],
      },
    ])
  })

  it('counts warnings per category, drops the empty ones and sorts by size', () => {
    const warnings = emptyWarnings()
    warnings.ipc_unparseable.push(
      { patent: 'a', column: 'IPC5-1', value: '?' },
      { patent: 'b', column: 'IPC5-2', value: '?' },
    )
    warnings.no_identifier.push({ title: 'T', source_files: ['a.xlsx'] })
    const summary = summarizeWarnings(warnings)
    expect(summary.total).toBe(3)
    expect(summary.rows).toEqual([
      { key: 'ipc_unparseable', label: 'IPC 無法解析', count: 2 },
      { key: 'no_identifier', label: '無專利號與申請號', count: 1 },
    ])
  })

  it('reports nothing when there is nothing to report', () => {
    expect(summarizeWarnings(emptyWarnings())).toEqual({ rows: [], total: 0 })
    expect(summarizeWarnings(null)).toEqual({ rows: [], total: 0 })
  })
})

describe('multi-file panel against the real fixtures (§5.1, §5.3)', () => {
  it('per-file rows sum to the total, and the deduped count drives the sample default', () => {
    const parsed = parseExcelFiles([
      { buffer: buffer(path.join(FIXTURES, 'format-b-sample.xlsx')), filename: 'B.xlsx' },
      { buffer: buffer(path.join(FIXTURES, 'format-a-sample.xlsx')), filename: 'A.xlsx' },
    ])
    const summaries = buildFileSummaries(parsed.results)

    expect(summaries.map((s) => [s.filename, s.formatLabel, s.sheetName, s.validRows])).toEqual([
      ['B.xlsx', '老師版 B', '原始資料', 42],
      ['A.xlsx', '爬蟲版 A', '專利清單', 3],
    ])
    // The panel's last line: 合計 N 筆 → 去重後 M 筆.
    expect(summaries.reduce((n, s) => n + s.validRows, 0)).toBe(parsed.original_count)
    expect(parsed.original_count).toBe(45)
    expect(parsed.deduped_count).toBe(43)
    expect(defaultSampleSize(parsed.deduped_count, DEFAULT_LIMITS.analyzeMaxPatents)).toBe(43)

    // Every warning bucket the parse produced is accounted for by the panel.
    const summary = summarizeWarnings(parsed.warnings)
    const expected = Object.values(parsed.warnings).reduce((n, list) => n + list.length, 0)
    expect(summary.total).toBe(expected)
  })
})

// ===========================================================================
// §6.3 multi-file history display
// ===========================================================================
describe('history display of a multi-file analysis (§6.3)', () => {
  it('labels one file plainly and several as "N 個檔" with every name', () => {
    expect(formatUploadLabel([])).toBe('(未命名)')
    expect(formatUploadLabel(['a.xlsx'])).toBe('a.xlsx')
    expect(formatUploadLabel(['a.xlsx', 'b.xlsx'])).toBe('2 個檔（a.xlsx、b.xlsx）')
    expect(formatUploadLabel(['a.xlsx', '  ', ''])).toBe('a.xlsx')
  })

  it('builds the sidebar entry from analysis_uploads', () => {
    const entry = toHistoryEntry({
      id: 'j1',
      filename: 'a.xlsx',
      status: 'done',
      patent_count: 43,
      source_file_url: '/api/files/u1',
      created_at: '2026-08-05T00:00:00.000Z',
      files: [
        { upload_id: 'u1', filename: 'a.xlsx', url: '/api/files/u1' },
        { upload_id: 'u2', filename: 'b.xlsx', url: '/api/files/u2' },
      ],
      filenames: ['a.xlsx', 'b.xlsx'],
      file_count: 2,
    })
    expect(entry.filename).toBe('2 個檔（a.xlsx、b.xlsx）')
    expect(entry.fileCount).toBe(2)
    expect(entry.files.map((f) => f.url)).toEqual(['/api/files/u1', '/api/files/u2'])
    expect(entry.sourceFileUrl).toBe('/api/files/u1')
    expect(entry.status).toBe('completed')
    expect(entry.patentCount).toBe(43)
  })

  it('falls back to the single-valued columns for pre-v2 rows', () => {
    const entry = toHistoryEntry({
      id: 'j2',
      filename: 'legacy.xlsx',
      status: 'running',
      patent_count: 0,
      source_file_url: '/api/files/u9',
      created_at: '2026-08-05T00:00:00.000Z',
    })
    expect(entry.filename).toBe('legacy.xlsx')
    expect(entry.files).toEqual([])
    expect(entry.fileCount).toBe(0)
    expect(entry.sourceFileUrl).toBe('/api/files/u9')
    expect(entry.status).toBe('analyzing')
    expect(entry.patentCount).toBeUndefined()
  })

  it('names an analysis with no filename at all', () => {
    const entry = toHistoryEntry({
      id: 'j3',
      filename: null,
      status: 'error',
      patent_count: 0,
      source_file_url: null,
      created_at: '2026-08-05T00:00:00.000Z',
      files: [],
      filenames: [],
      file_count: 0,
    })
    expect(entry.filename).toBe('(未命名)')
  })
})
