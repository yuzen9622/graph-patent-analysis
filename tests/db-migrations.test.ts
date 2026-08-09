import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  applyDownFiles,
  columnTypes,
  createDisposableDb,
  databaseHostPort,
  deleteTrackingRows,
  endPointedPool,
  indexExists,
  loadEnvDatabaseUrl,
  pointPoolAt,
  primaryKey,
  probePostgres,
  tableExists,
  tableList,
  type DisposableDb,
} from './db-migrations-helpers'

const PROJECT_ROOT = process.cwd()
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'db', 'migrations')
const DOWN_DIR = path.join(MIGRATIONS_DIR, 'down')
const UP_FILES = [
  '001_init.sql',
  '002_p0_data_layer.sql',
  '003_p1_synonyms.sql',
  '004_p3_concept_time.sql',
  '005_p4_units.sql',
  '006_p4_units_metrics.sql',
  '007_p6_temporal.sql',
  '008_p6_scope_id.sql',
] as const
const REAPPLY_FILES = UP_FILES.slice(2)
const INIT_TABLES = [
  'users',
  'sessions',
  'uploads',
  'analyses',
  'applicants',
  'patents',
  'patent_applicants',
  'concepts',
  'patent_concepts',
  'communities',
  'edges',
] as const
const FULL_TABLES = [
  'analyses',
  'analysis_uploads',
  'applicants',
  'citation_edges',
  'citations',
  'communities',
  'concept_communities',
  'concepts',
  'edges',
  'patent_applicants',
  'patent_concepts',
  'patents',
  'sessions',
  'synonym_groups',
  'uploads',
  'users',
] as const
const TABLES_AFTER_003_DOWN = [
  'analyses',
  'analysis_uploads',
  'applicants',
  'citations',
  'communities',
  'concepts',
  'edges',
  'patent_applicants',
  'patent_concepts',
  'patents',
  'sessions',
  'uploads',
  'users',
] as const
const P0_PATENT_COLUMNS = [
  'patent_number',
  'publication_number',
  'publication_date',
  'ipc5',
  'ipc5_raw',
  'ipc_primary',
  'ipc_depth',
  'cited_by_count',
  'case_status',
  'design_class',
  'source_files',
  'external_references',
] as const
const P4_EDGE_COLUMNS = [
  'support_applicants',
  'jaccard_applicants',
  'npmi',
  'npmi_applicants',
  'association_strength',
  'association_strength_applicants',
] as const

type ClientModule = typeof import('@/lib/db/client')

function filesUsingClientFilter(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && !file.startsWith('._'))
    .sort()
}

async function trackedNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
  return result.rows.map((row) => row.name)
}

async function advisoryLocks(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM pg_locks
     WHERE locktype = 'advisory'
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
  )
  return Number(result.rows[0]?.count ?? 0)
}

function clearMigrationPromise(): void {
  delete (globalThis as typeof globalThis & { __pgMigrated?: Promise<void> }).__pgMigrated
}

const originalDatabaseUrl = process.env.DATABASE_URL
const databaseUrl = loadEnvDatabaseUrl()
const needsDb = await probePostgres(databaseUrl)
if (!needsDb) {
  process.stderr.write(`[db-test] skipping PostgreSQL integration tests (${databaseHostPort(databaseUrl)})\n`)
}

describe('database migration file inventory', () => {
  it('uses the client readdirSync filter to select only the eight ordered up files', () => {
    const entries = fs.readdirSync(MIGRATIONS_DIR)
    const filtered = filesUsingClientFilter()

    expect(entries).toContain('down')
    expect(filtered).not.toContain('down')
    expect(filtered).toEqual(UP_FILES)
  })

  it('keeps the filtered up list free of AppleDouble sidecars', () => {
    expect(filesUsingClientFilter().some((file) => file.startsWith('._'))).toBe(false)
  })

  it('001 是 init 不設 down；002–008 均有對應 down 檔', () => {
    expect(fs.existsSync(path.join(DOWN_DIR, '001_down.sql'))).toBe(false)
    for (const file of UP_FILES.slice(1)) {
      expect(fs.existsSync(path.join(DOWN_DIR, `${file.slice(0, 3)}_down.sql`))).toBe(true)
    }
  })

  it('gives every up migration a three-digit filename prefix', () => {
    for (const file of UP_FILES) expect(file).toMatch(/^\d{3}/u)
  })
})

describe.skipIf(!needsDb)('database migrations in a disposable PostgreSQL database', () => {
  let disposable: DisposableDb | undefined
  let client: ClientModule | undefined
  let pool: Pool | undefined

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests')
    disposable = await createDisposableDb(databaseUrl)
    pointPoolAt(disposable.url)
    vi.resetModules()
    client = await import('@/lib/db/client')
    pool = client.getPool()
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

  it('migrates, rolls down 008 through 003 one file at a time, then reapplies 003 through 008', async () => {
    const activeClient = client!
    const activePool = pool!

    // Phase 1: fresh database and production migration runner.
    await activeClient.migrate()
    expect(await trackedNames(activePool)).toEqual(UP_FILES)
    expect(await tableList(activePool)).toEqual(FULL_TABLES)
    expect(await tableList(activePool)).toHaveLength(16)

    const extensions = await activePool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'",
    )
    expect(extensions.rows.map((row) => row.extname)).toEqual(['pgcrypto'])
    expect(INIT_TABLES).toHaveLength(11)
    expect(await tableList(activePool)).toEqual(expect.arrayContaining([...INIT_TABLES]))

    const patentColumns = await columnTypes(activePool, 'patents')
    expect(P0_PATENT_COLUMNS).toHaveLength(12)
    for (const column of P0_PATENT_COLUMNS) expect(patentColumns[column]).toBeDefined()
    const applicantColumns = await columnTypes(activePool, 'applicants')
    const conceptColumns = await columnTypes(activePool, 'concepts')
    const analysisColumns = await columnTypes(activePool, 'analyses')
    expect([...P0_PATENT_COLUMNS, 'applicant_key', 'source_patents', 'data_quality_warnings']).toHaveLength(15)
    expect(applicantColumns.applicant_key).toBe('text')
    expect(conceptColumns.source_patents).toBe('ARRAY')
    expect(analysisColumns.data_quality_warnings).toBe('jsonb')
    expect(await tableExists(activePool, 'analysis_uploads')).toBe(true)
    expect(await tableExists(activePool, 'citations')).toBe(true)

    expect(await tableExists(activePool, 'synonym_groups')).toBe(true)
    expect(analysisColumns.synonym_snapshot).toBe('jsonb')

    expect(conceptColumns.first_year).toBe('integer')
    expect(conceptColumns.last_year).toBe('integer')
    expect(conceptColumns.median_year).toBe('double precision')
    expect(conceptColumns.year_counts).toBe('jsonb')
    expect(await indexExists(activePool, 'concepts', 'concepts_first_year_idx')).toBe(true)

    expect(conceptColumns.applicant_count).toBe('integer')
    expect(await indexExists(activePool, 'concepts', 'concepts_applicant_count_idx')).toBe(true)

    expect((await columnTypes(activePool, 'communities')).unit).toBe('text')
    expect(await primaryKey(activePool, 'communities')).toEqual([
      'analysis_id',
      'unit',
      'community_id',
    ])
    expect(conceptColumns.community_id_applicants).toBe('integer')
    expect(await tableExists(activePool, 'concept_communities')).toBe(true)
    const edgeColumns = await columnTypes(activePool, 'edges')
    expect(edgeColumns.support_applicants).toBe('integer')
    for (const column of P4_EDGE_COLUMNS.slice(1)) expect(edgeColumns[column]).toBe('double precision')

    expect(conceptColumns.q1_year).toBe('integer')
    expect(conceptColumns.q3_year).toBe('integer')
    expect(conceptColumns.median_loo_min).toBe('double precision')
    expect(conceptColumns.median_loo_max).toBe('double precision')
    expect(edgeColumns.citation_supported).toBe('boolean')
    expect(edgeColumns.citation_direction_conflict).toBe('boolean')
    expect(await tableExists(activePool, 'citation_edges')).toBe(true)

    expect(analysisColumns.scope_id).toBe('text')

    // Force a second pass through runMigrations(), rather than merely returning its cached promise.
    clearMigrationPromise()
    await activeClient.migrate()
    expect(await trackedNames(activePool)).toEqual(UP_FILES)
    expect(await advisoryLocks(activePool)).toBe(0)

    // Phase 2: down files are manually applied and deliberately do not touch tracking.
    await applyDownFiles(activePool, ['008_down.sql'])
    expect((await columnTypes(activePool, 'analyses')).scope_id).toBeUndefined()
    expect(await tableList(activePool)).toHaveLength(16)

    await applyDownFiles(activePool, ['007_down.sql'])
    expect(await tableExists(activePool, 'citation_edges')).toBe(false)
    const conceptsAfter007Down = await columnTypes(activePool, 'concepts')
    const edgesAfter007Down = await columnTypes(activePool, 'edges')
    expect(edgesAfter007Down.citation_supported).toBeUndefined()
    expect(edgesAfter007Down.citation_direction_conflict).toBeUndefined()
    expect(conceptsAfter007Down.q1_year).toBeUndefined()
    expect(conceptsAfter007Down.q3_year).toBeUndefined()
    expect(conceptsAfter007Down.median_loo_min).toBeUndefined()
    expect(conceptsAfter007Down.median_loo_max).toBeUndefined()
    expect(conceptsAfter007Down.median_year).toBe('integer')

    await applyDownFiles(activePool, ['006_down.sql'])
    expect(await tableExists(activePool, 'concept_communities')).toBe(false)
    const communitiesAfter006Down = await columnTypes(activePool, 'communities')
    const edgesAfter006Down = await columnTypes(activePool, 'edges')
    expect(communitiesAfter006Down.unit).toBeUndefined()
    expect(await primaryKey(activePool, 'communities')).toEqual(['analysis_id', 'community_id'])
    for (const column of P4_EDGE_COLUMNS) expect(edgesAfter006Down[column]).toBeUndefined()

    await applyDownFiles(activePool, ['005_down.sql'])
    expect((await columnTypes(activePool, 'concepts')).applicant_count).toBeUndefined()

    await applyDownFiles(activePool, ['004_down.sql'])
    const conceptsAfter004Down = await columnTypes(activePool, 'concepts')
    expect(conceptsAfter004Down.first_year).toBeUndefined()
    expect(conceptsAfter004Down.last_year).toBeUndefined()
    expect(conceptsAfter004Down.median_year).toBeUndefined()
    expect(conceptsAfter004Down.year_counts).toBeUndefined()

    await applyDownFiles(activePool, ['003_down.sql'])
    expect(await tableExists(activePool, 'synonym_groups')).toBe(false)
    expect((await columnTypes(activePool, 'analyses')).synonym_snapshot).toBeUndefined()
    expect(await tableList(activePool)).toEqual(TABLES_AFTER_003_DOWN)
    expect(await tableList(activePool)).toHaveLength(13)

    // Phase 3: real deployment recovery keeps 001/002 tracking, then reapplies only 003–008.
    await deleteTrackingRows(activePool, REAPPLY_FILES)
    expect(await trackedNames(activePool)).toEqual(UP_FILES.slice(0, 2))
    clearMigrationPromise()
    await activeClient.migrate()
    expect(await trackedNames(activePool)).toEqual(UP_FILES)
    expect(await tableList(activePool)).toEqual(FULL_TABLES)
    expect((await columnTypes(activePool, 'analyses')).scope_id).toBe('text')
  })

  it('ignores an AppleDouble migration sidecar end to end', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wang-migrations-'))
    const tempMigrations = path.join(tempRoot, 'db', 'migrations')
    let changedDirectory = false
    let sidecarDb: DisposableDb | undefined

    try {
      await endPointedPool()
      sidecarDb = await createDisposableDb(databaseUrl!)
      fs.mkdirSync(tempMigrations, { recursive: true })
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempMigrations, '001_init.sql'))
      fs.writeFileSync(path.join(tempMigrations, '._evil.sql'), 'SELECT 1/0;\n')
      process.chdir(tempRoot)
      changedDirectory = true
      pointPoolAt(sidecarDb.url)
      vi.resetModules()

      const sidecarClient = await import('@/lib/db/client')
      const sidecarPool = sidecarClient.getPool()
      await sidecarClient.migrate()
      expect(await trackedNames(sidecarPool)).toEqual(['001_init.sql'])
    } finally {
      try {
        await sidecarDb?.drop()
      } finally {
        if (changedDirectory) process.chdir(PROJECT_ROOT)
        pointPoolAt(disposable!.url)
        vi.resetModules()
        fs.rmSync(tempRoot, { recursive: true, force: true })
      }
    }
  })
})
