/**
 * store.ts — in-memory job state (progress + SSE) plus persistence.
 *
 * Persistence split, per the storage rule for this project:
 *   - PostgreSQL is the source of truth for analysis results (normalised into
 *     patents / applicants / concepts / edges / communities).
 *   - `data/<id>.json` is still written as a portable snapshot for backup and
 *     offline use, but the app never reads it back except during migration.
 *
 * Job progress itself stays in memory: it is ephemeral, dies with the process,
 * and a restart mid-analysis loses the job either way.
 */

import fs from 'fs'
import path from 'path'
import type { JobState, GraphData } from '@/types/graph'
import { saveGraph, setAnalysisStatus, type SaveContext } from '@/lib/db/analyses'

export const DATA_DIR = path.join(process.cwd(), 'data')
export const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots')

const jobs = new Map<string, JobState>()
const subscribers = new Map<string, Set<ReadableStreamDefaultController>>()

// --- Job lifecycle ---

export function createJob(id: string, total: number): JobState {
  const job: JobState = {
    id,
    status: 'running',
    done: 0,
    total,
    cancelled: false,
  }
  jobs.set(id, job)
  subscribers.set(id, new Set())
  return job
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id)
}

export function isJobCancelled(id: string): boolean {
  return jobs.get(id)?.cancelled ?? false
}

export function cancelJob(id: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.cancelled = true
  job.status = 'cancelled'
  void setAnalysisStatus(id, 'cancelled').catch((err) =>
    console.error(`[store] failed to mark ${id} cancelled:`, err),
  )
  notifySubscribers(id, 'cancelled', { job_id: id })
}

export async function completeJob(
  id: string,
  graph: GraphData,
  context?: SaveContext,
): Promise<void> {
  const job = jobs.get(id)
  if (job) {
    job.status = 'done'
    job.graph = graph
  }

  // The database write is what must succeed; the snapshot is best effort.
  await saveGraph(id, graph, context)
  writeSnapshot(id, graph)

  notifySubscribers(id, 'complete', { job_id: id })
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id)
  if (job) {
    job.status = 'error'
    job.error = error
  }
  void setAnalysisStatus(id, 'error', error).catch((err) =>
    console.error(`[store] failed to mark ${id} errored:`, err),
  )
  notifySubscribers(id, 'error', { job_id: id, error })
}

// --- SSE subscriptions ---

export function subscribe(id: string, controller: ReadableStreamDefaultController): void {
  if (!subscribers.has(id)) {
    subscribers.set(id, new Set())
  }
  subscribers.get(id)!.add(controller)
}

export function notifySubscribers(id: string, event: string, data: unknown): void {
  const subs = subscribers.get(id)
  if (!subs) return
  const message = `event:${event}\ndata:${JSON.stringify(data)}\n\n`
  const encoder = new TextEncoder()
  const chunk = encoder.encode(message)
  for (const controller of subs) {
    try {
      controller.enqueue(chunk)
    } catch {
      subs.delete(controller)
    }
  }
}

export function notifyProgress(
  jobId: string,
  done: number,
  total: number,
  batch_titles: string[],
  batch_index: number,
): void {
  const job = jobs.get(jobId)
  if (job) {
    job.done = done
    job.total = total
  }
  notifySubscribers(jobId, 'progress', {
    job_id: jobId,
    done,
    total,
    batch_titles,
    batch_index,
  })
}

// --- Snapshot (backup artefact, not the source of truth) ---

export function writeSnapshot(jobId: string, graph: GraphData): void {
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const finalPath = path.join(SNAPSHOT_DIR, `${jobId}.json`)
    const tempPath = `${finalPath}.tmp`
    // tmp + rename: a crash mid-write can no longer truncate an existing file.
    fs.writeFileSync(tempPath, JSON.stringify(graph), 'utf-8')
    fs.renameSync(tempPath, finalPath)
  } catch (err) {
    console.error(`[store] snapshot write failed for ${jobId}:`, err)
  }
}
