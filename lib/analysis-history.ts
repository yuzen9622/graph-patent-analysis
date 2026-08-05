/**
 * analysis-history.ts — the signed-in account's analysis list.
 *
 * Previously localStorage, which meant history was per-browser and invisible to
 * the server. It now comes from `GET /api/analyses` (the `analyses` table), so
 * it follows the account across devices.
 *
 * Since PRD v2 P0 §5.3 an analysis can be backed by several spreadsheets, so
 * the single `filename` / `sourceFileUrl` pair is now derived from the full
 * `analysis_uploads` list the API returns: `filename` stays a display string
 * (the sidebar shows one line per analysis), while `files` carries every name
 * and download URL for callers that can show them all.
 */

import { formatUploadLabel } from '@/lib/analyze-limits'

export interface HistoryFile {
  uploadId: string
  filename: string | null
  url: string
}

export interface HistoryEntry {
  id: string
  /** Display label: the filename, or "N 個檔（a.xlsx、b.xlsx）" for a multi-file analysis. */
  filename: string
  timestamp: string
  status: 'analyzing' | 'completed' | 'error'
  patentCount?: number
  sourceFileUrl?: string | null
  /** Every upload backing this analysis (§6.3). Empty for pre-v2 rows. */
  files: HistoryFile[]
  fileCount: number
}

export const HISTORY_EVENT = 'patent-history-changed'

interface ApiAnalysis {
  id: string
  filename: string | null
  status: 'running' | 'done' | 'cancelled' | 'error'
  patent_count: number
  source_file_url: string | null
  created_at: string
  files?: Array<{ upload_id: string; filename: string | null; url: string }>
  filenames?: string[]
  file_count?: number
}

const STATUS_MAP: Record<ApiAnalysis['status'], HistoryEntry['status']> = {
  running: 'analyzing',
  done: 'completed',
  cancelled: 'error',
  error: 'error',
}

/** Maps one API row to the sidebar's shape. Pure — unit-tested without a DOM. */
export function toHistoryEntry(row: ApiAnalysis): HistoryEntry {
  const files: HistoryFile[] = (row.files ?? []).map((file) => ({
    uploadId: file.upload_id,
    filename: file.filename,
    url: file.url,
  }))

  const names =
    row.filenames && row.filenames.length > 0
      ? row.filenames
      : files
          .map((file) => file.filename)
          .filter((name): name is string => Boolean(name))

  // Rows written before analysis_uploads existed only have the single column.
  const label = names.length > 0 ? formatUploadLabel(names) : (row.filename ?? '(未命名)')

  return {
    id: row.id,
    filename: label,
    timestamp: row.created_at,
    status: STATUS_MAP[row.status] ?? 'error',
    patentCount: row.patent_count || undefined,
    sourceFileUrl: files[0]?.url ?? row.source_file_url,
    files,
    fileCount: row.file_count ?? files.length,
  }
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  if (typeof window === 'undefined') return []
  const res = await fetch('/api/analyses', { cache: 'no-store' })
  if (!res.ok) return []
  const body = (await res.json()) as { analyses?: ApiAnalysis[] }
  return (body.analyses ?? []).map(toHistoryEntry)
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
