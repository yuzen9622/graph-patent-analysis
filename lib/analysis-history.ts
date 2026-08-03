/**
 * analysis-history.ts — the signed-in account's analysis list.
 *
 * Previously localStorage, which meant history was per-browser and invisible to
 * the server. It now comes from `GET /api/analyses` (the `analyses` table), so
 * it follows the account across devices. The exported shape is unchanged for
 * callers; only the source of truth moved.
 */

export interface HistoryEntry {
  id: string
  filename: string
  timestamp: string
  status: 'analyzing' | 'completed' | 'error'
  patentCount?: number
  sourceFileUrl?: string | null
}

export const HISTORY_EVENT = 'patent-history-changed'

interface ApiAnalysis {
  id: string
  filename: string | null
  status: 'running' | 'done' | 'cancelled' | 'error'
  patent_count: number
  source_file_url: string | null
  created_at: string
}

const STATUS_MAP: Record<ApiAnalysis['status'], HistoryEntry['status']> = {
  running: 'analyzing',
  done: 'completed',
  cancelled: 'error',
  error: 'error',
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  if (typeof window === 'undefined') return []
  const res = await fetch('/api/analyses', { cache: 'no-store' })
  if (!res.ok) return []
  const body = (await res.json()) as { analyses?: ApiAnalysis[] }
  return (body.analyses ?? []).map((row) => ({
    id: row.id,
    filename: row.filename ?? '(未命名)',
    timestamp: row.created_at,
    status: STATUS_MAP[row.status] ?? 'error',
    patentCount: row.patent_count || undefined,
    sourceFileUrl: row.source_file_url,
  }))
}

/** Tells any mounted history view to re-fetch. */
export function notifyHistoryChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT))
}

export function getHistoryHref(entry: Pick<HistoryEntry, 'id' | 'status'>): string {
  const encodedId = encodeURIComponent(entry.id)
  return entry.status === 'analyzing'
    ? `/?jobId=${encodedId}`
    : `/analysis/${encodedId}`
}
