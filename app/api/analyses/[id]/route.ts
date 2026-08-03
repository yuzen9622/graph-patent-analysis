import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { deleteAnalysis, getAnalysis, type AnalysisSummary } from '@/lib/db/analyses'
import { uploadUrl } from '@/lib/db/uploads'

export const dynamic = 'force-dynamic'

type AuthorizeResult =
  | { outcome: 'ok'; analysis: AnalysisSummary }
  | { outcome: 'missing' }
  | { outcome: 'forbidden' }

async function authorize(id: string): Promise<AuthorizeResult> {
  const user = await requireUser()
  const analysis = await getAnalysis(id)
  if (!analysis) return { outcome: 'missing' }
  if (user.role !== 'admin' && analysis.owner_id !== user.id) {
    return { outcome: 'forbidden' }
  }
  return { outcome: 'ok', analysis }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await authorize(id)
    if (result.outcome === 'missing') {
      return NextResponse.json({ error: '找不到分析。' }, { status: 404 })
    }
    if (result.outcome === 'forbidden') {
      return NextResponse.json({ error: '無權存取此分析。' }, { status: 403 })
    }
    return NextResponse.json({
      ...result.analysis,
      source_file_url: result.analysis.upload_id ? uploadUrl(result.analysis.upload_id) : null,
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }
}

/** Cascades to patents / concepts / edges / communities via FK ON DELETE. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await authorize(id)
    if (result.outcome === 'missing') {
      return NextResponse.json({ error: '找不到分析。' }, { status: 404 })
    }
    if (result.outcome === 'forbidden') {
      return NextResponse.json({ error: '無權刪除此分析。' }, { status: 403 })
    }
    await deleteAnalysis(id)
    return NextResponse.json({ deleted: true })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }
}
