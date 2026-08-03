import { NextRequest, NextResponse } from 'next/server'
import { getJob, cancelJob } from '@/lib/store'
import { getAnalysis } from '@/lib/db/analyses'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
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

  if (job) {
    return NextResponse.json({
      id: job.id,
      status: job.status,
      done: job.done,
      total: job.total,
      error: job.error,
    })
  }

  // Not in memory (e.g. the server restarted) — the database is the record.
  const analysis = await getAnalysis(id)
  if (analysis) {
    return NextResponse.json({
      id,
      status: analysis.status,
      done: analysis.patent_count,
      total: analysis.sample_size ?? analysis.patent_count,
      error: analysis.error ?? undefined,
    })
  }

  return NextResponse.json({ error: 'Job not found' }, { status: 404 })
}

export async function DELETE(
  _req: NextRequest,
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

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'running') {
    return NextResponse.json({ error: 'Job is not running' }, { status: 404 })
  }

  cancelJob(id)
  const updated = getJob(id)!

  return NextResponse.json({
    cancelled: true,
    done: updated.done,
    total: updated.total,
  })
}
