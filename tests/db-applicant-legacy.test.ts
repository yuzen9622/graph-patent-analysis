import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applicantAvailability, selectGraphView } from '@/lib/graph-view'
import { legacyApplicantGraph } from './fixtures/legacy-applicant-graph'
import {
  createDisposableDb,
  databaseHostPort,
  loadEnvDatabaseUrl,
  pointPoolAt,
  probePostgres,
  type DisposableDb,
} from './db-migrations-helpers'

type AnalysesModule = typeof import('@/lib/db/analyses')

const originalDatabaseUrl = process.env.DATABASE_URL
const databaseUrl = loadEnvDatabaseUrl()
const needsDb = await probePostgres(databaseUrl)
if (!needsDb) {
  process.stderr.write(`[db-test] skipping PostgreSQL integration tests (${databaseHostPort(databaseUrl)})\n`)
}

/**
 * P9: 舊格式（schema v2）分析從資料庫讀回後（applicant_count / support_applicants
 * 皆為 NULL → undefined），未篩選的「家」單位概念視圖仍應由結構邊重建出真實邊與大小，
 * 而不是得出 0 邊、大小誤讀成篇數的空圖。模擬「恢復備份 → 開圖 → 切家單位」的真實路徑。
 */
describe.skipIf(!needsDb)('legacy applicant-unit rebuild through the database', () => {
  let disposable: DisposableDb | undefined
  let analyses: AnalysesModule | undefined

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests')
    disposable = await createDisposableDb(databaseUrl)
    pointPoolAt(disposable.url)
    vi.resetModules()
    analyses = await import('@/lib/db/analyses')
  })

  afterAll(async () => {
    try {
      await disposable?.drop()
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = originalDatabaseUrl
      vi.resetModules()
    }
  })

  it('「家」可用性與重建在 save→load 之後依然成立（NULL 欄位讀回為 undefined）', async () => {
    const analysisId = '20000000-0000-4000-8000-000000000001'
    await analyses!.createAnalysis({ id: analysisId, ownerId: null })
    await analyses!.saveGraph(analysisId, legacyApplicantGraph)

    const loaded = await analyses!.loadGraph(analysisId)
    expect(loaded).not.toBeNull()
    // 舊格式欄位沒有被 save/load 偽造出來。
    expect(applicantAvailability(loaded!)).toBe('rebuildable')

    const view = selectGraphView(loaded!, {
      mode: 'concept',
      showSemantic: false,
      minSupport: 1,
      yearRange: [2020, 2022],
      edgeWeight: 'jaccard',
      unit: 'applicant',
    })
    expect(view.edges.length).toBeGreaterThan(0)
    expect(view.stats.applicant_count).toBe(2)
    expect(view.capabilityWarning).toContain('重建')
  })
})