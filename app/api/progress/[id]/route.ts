import { NextRequest } from 'next/server'
import { getJob, subscribe } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const encoder = new TextEncoder()

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event:${event}\ndata:${JSON.stringify(data)}\n\n`)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const stream = new ReadableStream({
    start(controller) {
      const job = getJob(id)

      if (!job) {
        controller.enqueue(
          sseEvent('error', { job_id: id, error: 'Job not found' }),
        )
        controller.close()
        return
      }

      // Terminal states — send a single final event and close immediately.
      if (job.status === 'done') {
        controller.enqueue(sseEvent('complete', { job_id: id }))
        controller.close()
        return
      }

      if (job.status === 'cancelled') {
        controller.enqueue(sseEvent('cancelled', { job_id: id }))
        controller.close()
        return
      }

      if (job.status === 'error') {
        controller.enqueue(
          sseEvent('error', { job_id: id, error: job.error ?? 'Unknown error' }),
        )
        controller.close()
        return
      }

      // Job is running — register this controller to receive future notifications
      // and immediately push current progress so the client is not stale.
      subscribe(id, controller)

      controller.enqueue(
        sseEvent('progress', {
          job_id: id,
          done: job.done,
          total: job.total,
          batch_titles: [],
          batch_index: 0,
        }),
      )
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
