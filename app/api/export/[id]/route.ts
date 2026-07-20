import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getJob, loadGraphData } from '@/lib/store'
import { buildExportHtml, parseExportOptions } from '@/lib/export-html'

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
  const { id } = await params
  const job = getJob(id)

  if (job && job.status !== 'done') {
    return NextResponse.json(
      { error: 'Analysis not yet complete' },
      { status: 409 },
    )
  }

  const graph = loadGraphData(id)
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
