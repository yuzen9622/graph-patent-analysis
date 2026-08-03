import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getJob } from '@/lib/store'
import { loadGraph } from '@/lib/db/analyses'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { buildExportHtml, parseExportOptions } from '@/lib/export-html'

export const dynamic = 'force-dynamic'

function loadVisNetworkSource(): string {
  return readFileSync(
    join(
      process.cwd(),
      'node_modules',
      'vis-network',
      'standalone',
      'umd',
      'vis-network.min.js',
    ),
    'utf8',
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  const { id } = await params
  const job = getJob(id)

  if (job && job.status !== 'done') {
    return NextResponse.json(
      { error: 'Analysis not yet complete' },
      { status: 409 },
    )
  }

  const graph = await loadGraph(id)
  if (!graph) {
    return NextResponse.json({ error: 'Graph data not found' }, { status: 404 })
  }

  const options = parseExportOptions(request.nextUrl.searchParams, graph)
  const html = buildExportHtml(id, graph, options, loadVisNetworkSource())
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="patent-graph-${date}.html"`,
    },
  })
}
