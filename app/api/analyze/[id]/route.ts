import { NextRequest, NextResponse } from 'next/server'
import { getJob, cancelJob } from '@/lib/store'

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
