import { NextRequest, NextResponse } from 'next/server'
import { getJob, cancelJob, DATA_DIR } from '@/lib/store'
import fs from 'fs'
import path from 'path'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // If not in memory (e.g. server restarted), check if output file exists on disk
  const filePath = path.join(DATA_DIR, `${id}.json`)
  if (fs.existsSync(filePath)) {
    return NextResponse.json({
      id,
      status: 'done',
    })
  }

  return NextResponse.json({ error: 'Job not found' }, { status: 404 })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
