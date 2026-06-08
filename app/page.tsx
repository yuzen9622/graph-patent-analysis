'use client'

import { useState, useId } from 'react'
import { BarChart2, Loader2, ArrowRight, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import UploadZone from '@/components/UploadZone'
import ModelSelector from '@/components/ModelSelector'
import ProgressPanel from '@/components/ProgressPanel'
import type { PatentRow } from '@/types/graph'
import type { FieldMapping } from '@/lib/excel-parser'
import type { ProviderType } from '@/lib/llm/providers'

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true'

// ── Step indicator ────────────────────────────────────────────────────────────

function Step({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm transition-colors duration-200 ${active ? 'text-[#F8FAFC]' : 'text-[#475569]'}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors duration-200
        ${active ? 'bg-[#4E79A7] text-white' : 'bg-[#1E293B] text-[#475569] border border-[#334155]'}`}>
        {n}
      </span>
      <span className="font-medium">{label}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [patents, setPatents]         = useState<PatentRow[]>([])
  const [_mappings, setMappings]      = useState<FieldMapping[]>([])
  const [provider, setProvider]       = useState<ProviderType>('nvidia')
  const [apiKey, setApiKey]           = useState('')
  const [sampleSize, setSampleSize]   = useState(50)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting]   = useState(false)
  const [phase, setPhase]             = useState<'upload' | 'analyzing'>('upload')
  const [jobId, setJobId]             = useState<string | null>(null)

  const sampleInputId = useId()

  const effectiveSample = patents.length > 0 ? Math.min(sampleSize, patents.length) : sampleSize
  const sampleHint = patents.length > 0 ? `將分析 ${effectiveSample} / 總計 ${patents.length} 筆` : null
  const canStart = patents.length > 0 && (USE_MOCK || apiKey.trim().length > 0)

  function handleParsed(rows: PatentRow[], mappings: FieldMapping[], _filename: string) {
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
    if (patents.length === 0) { setSubmitError('請先上傳 .xlsx 檔案。'); return }
    if (!USE_MOCK && !apiKey.trim()) { setSubmitError('請輸入 API Key 後再開始分析。'); return }

    setSubmitError(null)
    setSubmitting(true)

    const sampled = patents.slice(0, Math.min(sampleSize, patents.length))

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (!USE_MOCK) headers['X-LLM-Api-Key'] = apiKey.trim()

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider, sample_size: sampleSize, patents: sampled }),
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

  // ── Analyzing phase ──
  if (phase === 'analyzing' && jobId) {
    return (
      <div className="min-h-dvh bg-[#020617] flex flex-col items-center justify-center px-4 py-16">
        <ProgressPanel jobId={jobId} />
      </div>
    )
  }

  // ── Upload phase ──
  return (
    <div className="min-h-dvh bg-[#020617] text-[#F8FAFC] flex flex-col">

      {/* ── Top nav / branding ── */}
      <header className="border-b border-[#1E293B] px-6 py-4 flex items-center gap-3">
        <BarChart2 size={22} className="text-[#22C55E]" aria-hidden />
        <div>
          <h1 className="font-serif text-lg font-bold leading-tight text-[#F8FAFC]">
            王老師專利知識圖譜分析平台
          </h1>
          <p className="text-xs text-[#475569] mt-0.5 tracking-wide">
            Patent Knowledge Graph Analysis
          </p>
        </div>
        {USE_MOCK && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-2.5 py-1 rounded-full">
            <FlaskConical size={12} aria-hidden />
            Mock 模式
          </span>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12" aria-label="上傳與設定">

        {/* Steps row */}
        <div className="flex items-center gap-6 mb-8 flex-wrap justify-center">
          <Step n={1} label="上傳 Excel" active={patents.length === 0} />
          <span className="text-[#334155] text-sm">→</span>
          <Step n={2} label="選擇模型" active={patents.length > 0} />
          <span className="text-[#334155] text-sm">→</span>
          <Step n={3} label="開始分析" active={canStart} />
        </div>

        {/* Card container */}
        <div className="w-full max-w-2xl space-y-5">

          {/* Upload zone */}
          <section
            className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5"
            aria-label="檔案上傳"
          >
            <UploadZone onParsed={handleParsed} onError={handleUploadError} />
          </section>

          {/* Model + Sample */}
          <section
            className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 space-y-5"
            aria-label="模型與抽樣設定"
          >
            <ModelSelector
              provider={provider}
              apiKey={apiKey}
              onProviderChange={setProvider}
              onApiKeyChange={setApiKey}
            />

            {/* Sample size row */}
            <div className="flex items-end gap-3 pt-1 border-t border-[#1E293B]">
              <div className="flex flex-col gap-1.5 w-36">
                <Label htmlFor={sampleInputId} className="text-xs text-[#94A3B8]">
                  抽樣筆數
                </Label>
                <Input
                  id={sampleInputId}
                  type="number"
                  min={1}
                  max={2000}
                  value={sampleSize}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) setSampleSize(Math.min(2000, Math.max(1, v)))
                  }}
                  className="h-9 bg-[#020617] border-[#334155] text-[#F8FAFC] focus-visible:ring-[#4E79A7] text-sm"
                />
              </div>
              {sampleHint && (
                <p className="text-xs text-[#94A3B8] pb-2" aria-live="polite">
                  {sampleHint}
                </p>
              )}
            </div>
          </section>

          {/* Errors */}
          {(uploadError || submitError) && (
            <Alert variant="destructive" className="border-[#EF4444]/50 bg-[#EF4444]/10 text-[#EF4444]">
              <AlertDescription>{submitError ?? uploadError}</AlertDescription>
            </Alert>
          )}

          {/* Start button */}
          <div className="flex justify-center pt-1">
            <Button
              size="lg"
              onClick={() => { void handleStart() }}
              disabled={submitting || !canStart}
              className="min-w-44 bg-[#22C55E] hover:bg-[#16A34A] text-white font-semibold text-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 gap-2"
            >
              {submitting ? (
                <><Loader2 size={18} className="animate-spin" aria-hidden />啟動中…</>
              ) : (
                <>開始分析<ArrowRight size={18} aria-hidden /></>
              )}
            </Button>
          </div>

        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#1E293B] px-6 py-3 text-center">
        <p className="text-xs text-[#334155]">
          支援 NVIDIA NIM · Google Gemini · OpenAI &nbsp;·&nbsp; 本機部署，資料不離開您的電腦
        </p>
      </footer>

    </div>
  )
}
