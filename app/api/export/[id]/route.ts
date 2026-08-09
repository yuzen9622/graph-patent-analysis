import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getJob } from '@/lib/store'
import { loadGraph } from '@/lib/db/analyses'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import {
  buildExportHtml,
  buildExportViews,
  parseExportOptions,
  type ExportOptions,
} from '@/lib/export-html'
import {
  ExportBodyTooLargeError,
  ExportPositionsError,
  parseExportPositions,
  readExportJsonBody,
  type FrozenPositions,
} from '@/lib/export-positions'
import type { GraphData } from '@/types/graph'

export const dynamic = 'force-dynamic'

type ExportRouteContext = { params: Promise<{ id: string }> }

interface ExportContext {
  id: string
  graph: GraphData
  options: ExportOptions
}

type ExportLoadResult =
  | { context: ExportContext }
  | { response: NextResponse }

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

async function loadExportContext(
  request: NextRequest,
  { params }: ExportRouteContext,
): Promise<ExportLoadResult> {
  try {
    await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { response: NextResponse.json({ error: err.message }, { status: 401 }) }
    }
    throw err
  }

  const { id } = await params
  const job = getJob(id)

  if (job && job.status !== 'done') {
    return {
      response: NextResponse.json(
        { error: 'Analysis not yet complete' },
        { status: 409 },
      ),
    }
  }

  const graph = await loadGraph(id)
  if (!graph) {
    return {
      response: NextResponse.json({ error: 'Graph data not found' }, { status: 404 }),
    }
  }

  return {
    context: {
      id,
      graph,
      options: parseExportOptions(request.nextUrl.searchParams, graph),
    },
  }
}

function exportAttachment(
  { id, graph, options }: ExportContext,
  frozenPositions?: FrozenPositions,
): NextResponse {
  const html = buildExportHtml(
    id,
    graph,
    options,
    loadVisNetworkSource(),
    frozenPositions,
  )
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

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: '請使用分析頁面的「離線 HTML」按鈕；此端點僅支援 POST。' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export async function POST(
  request: NextRequest,
  context: ExportRouteContext,
): Promise<NextResponse> {
  const loaded = await loadExportContext(request, context)
  if ('response' in loaded) return loaded.response

  let body: unknown
  try {
    body = await readExportJsonBody(request)
  } catch (err) {
    if (err instanceof ExportBodyTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    throw err
  }

  try {
    const view = buildExportViews(loaded.context.graph, loaded.context.options)[
      loaded.context.options.mode
    ]
    const frozenPositions = parseExportPositions(
      body,
      view.nodes.map((node) => node.id),
    )
    return exportAttachment(loaded.context, frozenPositions)
  } catch (err) {
    if (err instanceof ExportPositionsError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
