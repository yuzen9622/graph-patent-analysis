'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Loader2, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { updateHistoryStatus } from '@/lib/analysis-history'

// ── Types ──────────────────────────────────────────────────────────────────

type JobStatus = 'running' | 'done' | 'cancelled' | 'error'

interface ProgressState {
  status: JobStatus
  done: number
  total: number
  /** titles of the patents currently being processed */
  currentTitles: string[]
  /** ordered log of completed batch entries */
  batchLog: BatchEntry[]
  errorMessage: string | null
}

interface BatchEntry {
  batchIndex: number
  titles: string[]
}

// ── Props ──────────────────────────────────────────────────────────────────

interface ProgressPanelProps {
  jobId: string
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ProgressPanel({ jobId }: ProgressPanelProps) {
  const router = useRouter()
  const esRef = useRef<EventSource | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [state, setState] = useState<ProgressState>({
    status: 'running',
    done: 0,
    total: 0,
    currentTitles: [],
    batchLog: [],
    errorMessage: null,
  })

  // ── SSE connection ────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource(`/api/progress/${jobId}`)
    esRef.current = es

    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as {
        done: number
        total: number
        batch_titles: string[]
        batch_index: number
      }

      setState(prev => {
        // Only append to log when titles are provided (not the initial sync ping)
        const newLog =
          data.batch_titles.length > 0
            ? [
                ...prev.batchLog,
                { batchIndex: data.batch_index, titles: data.batch_titles },
              ]
            : prev.batchLog

        return {
          ...prev,
          status: 'running',
          done: data.done,
          total: data.total,
          currentTitles: data.batch_titles,
          batchLog: newLog,
        }
      })
    })

    es.addEventListener('complete', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { job_id: string }
      es.close()
      esRef.current = null

      updateHistoryStatus(data.job_id, 'completed')
      setState(prev => ({ ...prev, status: 'done', currentTitles: [] }))

      navigateTimerRef.current = setTimeout(() => {
        router.push(`/analysis/${data.job_id}`)
      }, 600)
    })

    es.addEventListener('cancelled', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { done: number; total: number }
      es.close()
      esRef.current = null

      setState(prev => ({
        ...prev,
        status: 'cancelled',
        done: data.done,
        total: data.total,
        currentTitles: [],
      }))
    })

    es.addEventListener('error', (e: MessageEvent) => {
      // MessageEvent carries a `data` field only for named events we send;
      // the browser also fires a generic error event on connection drop.
      let message = '發生未知錯誤'
      try {
        const data = JSON.parse(e.data) as { message?: string; error?: string }
        message = data.message ?? data.error ?? message
      } catch {
        // connection-level error — keep default message
      }
      es.close()
      esRef.current = null

      updateHistoryStatus(jobId, 'error')
      setState(prev => ({ ...prev, status: 'error', errorMessage: message, currentTitles: [] }))
    })

    return () => {
      es.close()
      esRef.current = null
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current)
    }
  }, [jobId, router])

  // ── Auto-scroll log to bottom ─────────────────────────────────────────────

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.batchLog.length])

  // ── Cancel handler ────────────────────────────────────────────────────────

  async function handleCancel() {
    // Close SSE first so the server push doesn't race with the DELETE response
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    try {
      await fetch(`/api/analyze/${jobId}`, { method: 'DELETE' })
    } catch {
      // Ignore network errors on cancel — the UI already reflects cancellation
    }

    setState(prev => ({
      ...prev,
      status: 'cancelled',
      currentTitles: [],
    }))
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const { status, done, total, currentTitles, batchLog, errorMessage } = state
  const totalBatches = batchLog.length + (status === 'running' ? 1 : 0)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const barColor =
    status === 'cancelled'
      ? 'bg-amber-500'
      : status === 'error'
        ? 'bg-red-500'
        : 'bg-blue-500'

  const headingText =
    status === 'running'
      ? '正在分析專利...'
      : status === 'done'
        ? '分析完成，正在載入圖譜...'
        : status === 'cancelled'
          ? `分析已中止，完成 ${done}${total > 0 ? ` / ${total}` : ''} 筆，已取得部分圖譜`
          : `分析錯誤：${errorMessage ?? '未知錯誤'}`

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="w-full max-w-2xl mx-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5"
      role="region"
      aria-label="分析進度"
    >
      {/* Status heading */}
      <div className="flex items-center gap-2">
        {status === 'running' && (
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" aria-hidden="true" />
        )}
        {status === 'done' && (
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true" />
        )}
        {status === 'cancelled' && (
          <XCircle className="w-5 h-5 text-amber-400 shrink-0" aria-hidden="true" />
        )}
        {status === 'error' && (
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
        )}
        <h2
          className={cn(
            'text-lg font-semibold leading-snug',
            status === 'cancelled' && 'text-amber-300',
            status === 'error' && 'text-red-300',
          )}
        >
          {headingText}
        </h2>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="space-y-1">
          <div
            className="w-full h-3 rounded-full bg-slate-700 overflow-hidden"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={`進度 ${pct}%`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-400 ease-out',
                barColor,
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-sm text-[var(--text-muted)] tabular-nums">
            {done} / {total} &nbsp;·&nbsp; {pct}%
          </p>
        </div>
      )}

      {/* Current batch titles */}
      {currentTitles.length > 0 && status === 'running' && (
        <div className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
          <span className="shrink-0 mt-0.5 text-blue-400" aria-hidden="true">▶</span>
          <p>
            <span className="font-medium text-[var(--text-primary)]">當前批次：</span>
            {currentTitles[0]}
            {currentTitles.length > 1 && ` 等 ${currentTitles.length} 篇`}
          </p>
        </div>
      )}

      {/* Scrollable batch log */}
      {batchLog.length > 0 && (
        <div
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] max-h-52 overflow-y-auto"
          aria-label="批次處理紀錄"
        >
          {batchLog.map((entry, idx) => (
            <div
              key={`${entry.batchIndex}-${idx}`}
              className="flex items-start gap-2 px-3 py-2 text-sm border-b border-[var(--border)] last:border-b-0"
            >
              <CheckCircle2
                className="w-4 h-4 text-green-400 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <span className="text-[var(--text-muted)] shrink-0 tabular-nums">
                [batch {entry.batchIndex + 1}/{Math.max(totalBatches, entry.batchIndex + 1)}]
              </span>
              <span className="text-[var(--text-primary)] truncate">
                {entry.titles[0]}
                {entry.titles.length > 1 && (
                  <span className="text-[var(--text-muted)]"> 等 {entry.titles.length} 篇</span>
                )}
              </span>
            </div>
          ))}
          {/* Running entry at bottom */}
          {status === 'running' && currentTitles.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 text-sm">
              <Circle
                className="w-4 h-4 text-blue-400 mt-0.5 shrink-0 animate-pulse"
                aria-hidden="true"
              />
              <span className="text-[var(--text-muted)] shrink-0 tabular-nums">
                [batch {batchLog.length + 1}/...]
              </span>
              <span className="text-[var(--text-primary)] truncate">
                {currentTitles[0]}
                {currentTitles.length > 1 && (
                  <span className="text-[var(--text-muted)]"> 等 {currentTitles.length} 篇</span>
                )}
              </span>
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto shrink-0 mt-1" aria-hidden="true" />
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Cancel button */}
      {status === 'running' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium cursor-pointer',
              'bg-slate-700 text-[var(--text-primary)] border border-[var(--border)]',
              'hover:bg-red-900/50 hover:border-red-600 hover:text-red-300',
              'transition-colors duration-150',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
            )}
            aria-label="取消分析"
          >
            取消分析
          </button>
        </div>
      )}
    </div>
  )
}
