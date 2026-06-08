'use client'

import { useState, useId } from 'react'
import { BarChart2, Loader2 } from 'lucide-react'
import UploadZone from '@/components/UploadZone'
import ModelSelector from '@/components/ModelSelector'
import ProgressPanel from '@/components/ProgressPanel'
import type { PatentRow } from '@/types/graph'
import type { FieldMapping } from '@/lib/excel-parser'
import type { ProviderType } from '@/lib/llm/providers'

// ── Design tokens (PRD 6.2) ───────────────────────────────────────────────────

const T = {
  bgBase:      '#020617',
  bgCard:      '#1E293B',
  bgPrimary:   '#0F172A',
  border:      '#334155',
  textPrimary: '#F8FAFC',
  textMuted:   '#94A3B8',
  textFaint:   '#475569',
  cta:         '#22C55E',
  ctaHover:    '#16A34A',
  error:       '#EF4444',
} as const

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  // upload-phase state
  const [patents, setPatents]       = useState<PatentRow[]>([])
  const [_mappings, setMappings]    = useState<FieldMapping[]>([])
  const [provider, setProvider]     = useState<ProviderType>('nvidia')
  const [apiKey, setApiKey]         = useState('')
  const [sampleSize, setSampleSize] = useState(50)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting]  = useState(false)

  // analyzing-phase state
  const [phase, setPhase]   = useState<'upload' | 'analyzing'>('upload')
  const [jobId, setJobId]   = useState<string | null>(null)

  const sampleInputId = useId()

  // ── Derived ────────────────────────────────────────────────────────────────

  const effectiveSample = patents.length > 0
    ? Math.min(sampleSize, patents.length)
    : sampleSize

  const sampleHint = patents.length > 0
    ? `將分析 ${effectiveSample} / 總計 ${patents.length} 筆`
    : null

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleParsed(rows: PatentRow[], mappings: FieldMapping[]) {
    setPatents(rows)
    setMappings(mappings)
    setUploadError(null)
    setSubmitError(null)
  }

  function handleUploadError(msg: string) {
    setUploadError(msg)
    setPatents([])
    setSubmitError(null)
  }

  async function handleStart() {
    if (patents.length === 0) {
      setSubmitError('請先上傳 .xlsx 檔案。')
      return
    }

    if (!USE_MOCK && !apiKey.trim()) {
      setSubmitError('請輸入 API Key 後再開始分析。')
      return
    }

    setSubmitError(null)
    setSubmitting(true)

    const sampled = patents.slice(0, Math.min(sampleSize, patents.length))

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (!USE_MOCK) {
        headers['X-LLM-Api-Key'] = apiKey.trim()
      }

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider,
          sample_size: sampleSize,
          patents: sampled,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? `伺服器錯誤 ${res.status}`)
      }

      const data = (await res.json()) as { job_id: string }
      setJobId(data.job_id)
      setPhase('analyzing')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '啟動分析失敗，請重試。')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: T.bgBase,
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        color: T.textPrimary,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: phase === 'analyzing' ? 'center' : 'flex-start',
        padding: '48px 16px 64px',
        boxSizing: 'border-box',
      }}
    >
      {phase === 'upload' && (
        <main
          style={{
            width: '100%',
            maxWidth: '720px',
            display: 'flex',
            flexDirection: 'column',
            gap: '28px',
          }}
          aria-label="上傳與設定"
        >
          {/* ── Header ── */}
          <header style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <BarChart2
              size={32}
              color={T.cta}
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            />
            <div>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "'Crimson Pro', serif",
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: T.textPrimary,
                }}
              >
                王老師專利知識圖譜分析平台
              </h1>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: '0.875rem',
                  color: T.textMuted,
                  letterSpacing: '0.04em',
                }}
              >
                Patent Knowledge Graph Analysis
              </p>
            </div>
          </header>

          {/* ── Upload zone ── */}
          <section aria-label="檔案上傳">
            <UploadZone
              onParsed={handleParsed}
              onError={handleUploadError}
            />
          </section>

          {/* ── 2-col grid: ModelSelector | Sample size ── */}
          <section
            aria-label="模型與抽樣設定"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '20px',
              alignItems: 'start',
            }}
          >
            {/* Left col: ModelSelector */}
            <div>
              <ModelSelector
                provider={provider}
                apiKey={apiKey}
                onProviderChange={setProvider}
                onApiKeyChange={setApiKey}
              />
            </div>

            {/* Right col: sample size */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label
                htmlFor={sampleInputId}
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: T.textMuted,
                }}
              >
                抽樣筆數
              </label>
              <input
                id={sampleInputId}
                type="number"
                min={1}
                max={2000}
                value={sampleSize}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v)) setSampleSize(Math.min(2000, Math.max(1, v)))
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${T.border}`,
                  backgroundColor: T.bgPrimary,
                  color: T.textPrimary,
                  fontSize: '0.9375rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
                onFocus={e => { e.currentTarget.style.outline = `2px solid #4E79A7` }}
                onBlur={e => { e.currentTarget.style.outline = 'none' }}
              />
              {sampleHint && (
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    color: T.textMuted,
                  }}
                  aria-live="polite"
                >
                  {sampleHint}
                </p>
              )}
            </div>
          </section>

          {/* ── Error messages ── */}
          {(uploadError || submitError) && (
            <div
              role="alert"
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                border: `1px solid ${T.error}`,
                backgroundColor: 'rgba(239,68,68,0.10)',
                color: T.error,
                fontSize: '0.875rem',
                lineHeight: 1.55,
              }}
            >
              {submitError ?? uploadError}
            </div>
          )}

          {/* ── Start button ── */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => { void handleStart() }}
              disabled={submitting}
              aria-label="開始分析"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '12px 36px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: submitting ? T.ctaHover : T.cta,
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.75 : 1,
                transition: 'background-color 0.15s ease, opacity 0.15s ease',
                minWidth: '160px',
                minHeight: '48px',
              }}
              onMouseEnter={e => {
                if (!submitting) (e.currentTarget as HTMLButtonElement).style.backgroundColor = T.ctaHover
              }}
              onMouseLeave={e => {
                if (!submitting) (e.currentTarget as HTMLButtonElement).style.backgroundColor = T.cta
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                  啟動中…
                </>
              ) : (
                '開始分析 →'
              )}
            </button>
          </div>
        </main>
      )}

      {phase === 'analyzing' && jobId && (
        <ProgressPanel jobId={jobId} />
      )}
    </div>
  )
}
