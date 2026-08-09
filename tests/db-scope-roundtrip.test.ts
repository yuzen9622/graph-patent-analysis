import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { selectGraphView } from '@/lib/graph-view'
import type { GraphData } from '@/types/graph'
import { temporalGraph } from './fixtures/temporal-graph'
import {
  createDisposableDb,
  databaseHostPort,
  loadEnvDatabaseUrl,
  pointPoolAt,
  probePostgres,
  type DisposableDb,
} from './db-migrations-helpers'

type AnalysesModule = typeof import('@/lib/db/analyses')
type ClientModule = typeof import('@/lib/db/client')

const originalDatabaseUrl = process.env.DATABASE_URL
const databaseUrl = loadEnvDatabaseUrl()
const needsDb = await probePostgres(databaseUrl)
if (!needsDb) {
  process.stderr.write(`[db-test] skipping PostgreSQL integration tests (${databaseHostPort(databaseUrl)})\n`)
}

function graphWithScope(scopeId?: string): GraphData {
  const graph = structuredClone(temporalGraph())
  if (scopeId === undefined) delete graph.scope_id
  else graph.scope_id = scopeId
  return graph
}

async function databaseScope(pool: Pool, analysisId: string): Promise<string | null> {
  const result = await pool.query<{ scope_id: string | null }>(
    'SELECT scope_id FROM analyses WHERE id = $1',
    [analysisId],
  )
  return result.rows[0]?.scope_id ?? null
}

describe.skipIf(!needsDb)('GraphData scope_id database round trips', () => {
  let disposable: DisposableDb | undefined
  let analyses: AnalysesModule | undefined
  let pool: Pool | undefined

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests')
    disposable = await createDisposableDb(databaseUrl)
    pointPoolAt(disposable.url)
    vi.resetModules()
    analyses = await import('@/lib/db/analyses')
    const client: ClientModule = await import('@/lib/db/client')
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

  it('persists a build-time scope_id and overwrites it on a later save', async () => {
    const analysisId = '10000000-0000-4000-8000-000000000001'
    const first = graphWithScope('build-scope-first')
    const replacement = graphWithScope('build-scope-replacement')

    await analyses!.createAnalysis({ id: analysisId, ownerId: null })
    await analyses!.saveGraph(analysisId, first)
    expect(await databaseScope(pool!, analysisId)).toBe(first.scope_id)

    await analyses!.saveGraph(analysisId, replacement)
    expect(await databaseScope(pool!, analysisId)).toBe(replacement.scope_id)
  })

  it('returns the persisted scope_id through loadGraph', async () => {
    const analysisId = '10000000-0000-4000-8000-000000000002'
    const graph = graphWithScope('roundtrip-scope')

    await analyses!.createAnalysis({ id: analysisId, ownerId: null })
    await analyses!.saveGraph(analysisId, graph)

    expect((await analyses!.loadGraph(analysisId))?.scope_id).toBe(graph.scope_id)
  })

  it('stores no-scope graphs as NULL and reloads them as undefined', async () => {
    const analysisId = '10000000-0000-4000-8000-000000000003'
    const graph = graphWithScope()

    await analyses!.createAnalysis({ id: analysisId, ownerId: null })
    await analyses!.saveGraph(analysisId, graph)

    expect(await databaseScope(pool!, analysisId)).toBeNull()
    expect((await analyses!.loadGraph(analysisId))?.scope_id).toBeUndefined()
  })

  it('keeps a dynamic view scope out of the persisted build-time scope', async () => {
    const analysisId = '10000000-0000-4000-8000-000000000004'
    const original = graphWithScope('build-time-scope')

    await analyses!.createAnalysis({ id: analysisId, ownerId: null })
    await analyses!.saveGraph(analysisId, original)
    const loaded = await analyses!.loadGraph(analysisId)
    expect(loaded).not.toBeNull()

    const view = selectGraphView(loaded!, {
      mode: 'concept',
      showSemantic: false,
      minSupport: 1,
      yearRange: [2018, 2024],
      sourceFiles: ['old.xlsx'],
    })
    expect(view.scopeId).toBeDefined()
    expect(view.scopeId).not.toBe(original.scope_id)
    expect(view.nodes.length).toBeGreaterThan(0)
    for (const node of view.nodes) expect(node.scope_id).toBe(view.scopeId)

    await analyses!.saveGraph(analysisId, original)
    expect(await databaseScope(pool!, analysisId)).toBe(original.scope_id)
  })
})
