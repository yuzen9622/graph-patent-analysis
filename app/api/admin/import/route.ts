import fs from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { createAnalysis, getAnalysis, saveGraph } from '@/lib/db/analyses'
import { normalizeGraphData } from '@/lib/graph-compat'
import { DATA_DIR } from '@/lib/db/uploads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/admin/import — one-off migration of the pre-database JSON files in
 * `data/*.json` into the normalised tables.
 *
 * Runs inside the app so it reuses the exact same normaliser and writer as a
 * live analysis (including `graph-compat` reconstruction for pre-v2 files),
 * rather than a parallel implementation that could drift.
 *
 * Idempotent: an id already present in `analyses` is skipped unless
 * `?force=1`. Nothing is deleted from disk.
 */
export async function POST(request: Request) {
  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  if (user.role !== 'admin') {
    return NextResponse.json({ error: '需要管理者權限。' }, { status: 403 })
  }

  const force = new URL(request.url).searchParams.get('force') === '1'

  let files: string[]
  try {
    files = (await fs.readdir(DATA_DIR)).filter((name) => name.endsWith('.json'))
  } catch {
    return NextResponse.json({ error: `讀不到 ${DATA_DIR}` }, { status: 500 })
  }

  const imported: string[] = []
  const skipped: string[] = []
  const failed: Array<{ file: string; error: string }> = []

  for (const file of files.sort()) {
    const id = path.basename(file, '.json')
    try {
      const existing = await getAnalysis(id)
      if (existing && !force) {
        skipped.push(id)
        continue
      }

      const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf-8')
      const graph = normalizeGraphData(JSON.parse(raw))
      if (!graph) {
        failed.push({ file, error: '無法解析為 GraphData' })
        continue
      }

      if (!existing) {
        await createAnalysis({
          id,
          ownerId: user.id,
          filename: `legacy-${file}`,
          provider: graph.methodology?.model_provider ?? null,
          sampleSize: graph.stats?.patent_count ?? null,
        })
      }
      await saveGraph(id, graph)
      imported.push(id)
    } catch (err) {
      failed.push({ file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({
    scanned: files.length,
    imported: imported.length,
    skipped: skipped.length,
    failed,
    imported_ids: imported,
  })
}
