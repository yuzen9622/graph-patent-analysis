import fs from 'fs'
import path from 'path'
import type { JobState, GraphData } from '@/types/graph'

export const DATA_DIR = path.join(process.cwd(), 'data')

const jobs = new Map<string, JobState>()
const subscribers = new Map<string, Set<ReadableStreamDefaultController>>()

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

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
  notifySubscribers(id, 'cancelled', { job_id: id })
}

export function completeJob(id: string, graph: GraphData): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'done'
  job.graph = graph
  saveGraphData(id, graph)
  notifySubscribers(id, 'complete', { job_id: id })
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'error'
  job.error = error
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

// --- Persistence ---

export function saveGraphData(jobId: string, graph: GraphData): void {
  const filePath = path.join(DATA_DIR, `${jobId}.json`)
  fs.writeFileSync(filePath, JSON.stringify(graph), 'utf-8')
}

export function loadGraphData(jobId: string): GraphData | null {
  const filePath = path.join(DATA_DIR, `${jobId}.json`)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as GraphData
  } catch {
    return null
  }
}
