'use client'

import React, { useCallback, useRef, useState } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'
import type { PatentRow } from '@/types/graph'
import type { FieldMapping } from '@/lib/excel-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadState = 'idle' | 'dragging' | 'parsing' | 'success' | 'error'

interface UploadZoneProps {
  onParsed: (patents: PatentRow[], mappings: FieldMapping[], filename: string) => void
  onError: (msg: string) => void
}

// ---------------------------------------------------------------------------
// Design tokens (PRD 6.2 / 6.6) — applied via inline styles for full
// portability regardless of Tailwind purge config in the host page.
// ---------------------------------------------------------------------------

const TOKEN = {
  bgBase: '#020617',
  bgCard: '#1E293B',
  borderIdle: '#475569',       // slate-600
  borderDrag: '#4E79A7',       // --accent
  borderSuccess: '#22C55E',    // --success / --cta
  borderError: '#EF4444',      // --error
  bgDrag: 'rgba(78,121,167,0.10)',
  bgSuccess: 'rgba(34,197,94,0.10)',
  bgError: 'rgba(239,68,68,0.10)',
  textPrimary: '#F8FAFC',
  textMuted: '#94A3B8',
  textFaint: '#475569',
  accent: '#4E79A7',
  success: '#22C55E',
  error: '#EF4444',
} as const

// ---------------------------------------------------------------------------
// Field label map for display
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  title: '專利名稱',
  abstract: '摘要',
  applicant: '申請人',
  filing_date: '申請日',
  application_number: '申請號',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getZoneStyle(state: UploadState): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: '180px',
    borderRadius: '12px',
    borderWidth: '2px',
    borderStyle: 'dashed',
    cursor: state === 'parsing' ? 'wait' : 'pointer',
    transition: 'border-color 0.2s ease, background-color 0.2s ease, transform 0.15s ease',
    outline: 'none',
    padding: '32px 24px',
    boxSizing: 'border-box',
  }

  switch (state) {
    case 'idle':
      return {
        ...base,
        borderColor: TOKEN.borderIdle,
        backgroundColor: 'rgba(15,23,42,0.50)',
      }
    case 'dragging':
      return {
        ...base,
        borderColor: TOKEN.borderDrag,
        backgroundColor: TOKEN.bgDrag,
        transform: 'scale(1.01)',
      }
    case 'parsing':
      return {
        ...base,
        borderColor: TOKEN.borderIdle,
        backgroundColor: 'rgba(15,23,42,0.50)',
        opacity: 0.75,
      }
    case 'success':
      return {
        ...base,
        borderColor: TOKEN.borderSuccess,
        backgroundColor: TOKEN.bgSuccess,
        cursor: 'default',
      }
    case 'error':
      return {
        ...base,
        borderColor: TOKEN.borderError,
        backgroundColor: TOKEN.bgError,
      }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UploadZone({ onParsed, onError }: UploadZoneProps) {
  const [state, setState] = useState<UploadState>('idle')
  const [filename, setFilename] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [mappings, setMappings] = useState<FieldMapping[] | null>(null)
  const [totalRows, setTotalRows] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropCounter = useRef(0) // track nested drag-enter/leave correctly

  // ── File processing ────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      const msg = `不支援的檔案格式「${file.name}」，請上傳 .xlsx 檔案。`
      setState('error')
      setErrorMsg(msg)
      setMappings(null)
      onError(msg)
      return
    }

    setState('parsing')
    setErrorMsg(null)
    setMappings(null)
    setFilename(file.name)

    try {
      const buffer = await file.arrayBuffer()

      // Dynamic import keeps xlsx out of the initial JS bundle
      const { parseExcel } = await import('@/lib/excel-parser')
      const result = parseExcel(buffer, file.name)

      setMappings(result.field_mappings)
      setTotalRows(result.total_rows)

      if (result.errors.length > 0 && result.patents.length === 0) {
        // Fatal parse error — no usable rows
        const msg = result.errors[0]
        setState('error')
        setErrorMsg(msg)
        onError(msg)
        return
      }

      setState('success')
      onParsed(result.patents, result.field_mappings, result.filename)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '檔案解析失敗，請檢查格式後重試。'
      setState('error')
      setErrorMsg(msg)
      setMappings(null)
      onError(msg)
    }
  }, [onParsed, onError])

  // ── Reset ──────────────────────────────────────────────────────────────

  const handleReset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setState('idle')
    setFilename(null)
    setErrorMsg(null)
    setMappings(null)
    setTotalRows(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // ── Drag events ────────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropCounter.current += 1
    if (state !== 'parsing') {
      setState('dragging')
    }
  }, [state])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropCounter.current -= 1
    if (dropCounter.current === 0 && state === 'dragging') {
      setState('idle')
    }
  }, [state])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropCounter.current = 0

    if (state === 'parsing') return

    const files = Array.from(e.dataTransfer.files)
    const xlsx = files.find(f => f.name.endsWith('.xlsx'))
    if (!xlsx) {
      setState('error')
      const msg = '請拖入 .xlsx 格式的 Excel 檔案。'
      setErrorMsg(msg)
      onError(msg)
      return
    }
    void processFile(xlsx)
  }, [state, processFile, onError])

  // ── Click / keyboard ───────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    if (state === 'parsing') return
    fileInputRef.current?.click()
  }, [state])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }, [handleClick])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void processFile(file)
  }, [processFile])

  // ── Derived ────────────────────────────────────────────────────────────

  const matchedCount = mappings?.filter(m => m.matched_column !== null).length ?? 0
  const totalFields = mappings?.length ?? 0

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ width: '100%', fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={state === 'parsing' ? -1 : 0}
        aria-label={
          state === 'success'
            ? `已上傳 ${filename}，點擊以重新上傳`
            : state === 'parsing'
            ? '正在解析檔案，請稍候'
            : '點擊或拖曳 .xlsx 檔案至此上傳'
        }
        aria-disabled={state === 'parsing'}
        aria-busy={state === 'parsing'}
        style={getZoneStyle(state)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />

        {/* ── Idle / Dragging state ── */}
        {(state === 'idle' || state === 'dragging') && (
          <>
            <Upload
              size={40}
              color={state === 'dragging' ? TOKEN.accent : TOKEN.textMuted}
              aria-hidden="true"
              style={{ marginBottom: '12px', transition: 'color 0.2s' }}
            />
            <p style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: state === 'dragging' ? TOKEN.accent : TOKEN.textPrimary,
              transition: 'color 0.2s',
            }}>
              {state === 'dragging' ? '放開以上傳' : '拖曳 .xlsx 至此，或點擊選擇檔案'}
            </p>
            <p style={{
              margin: '6px 0 0',
              fontSize: '0.8125rem',
              color: TOKEN.textMuted,
            }}>
              僅支援 .xlsx 格式
            </p>
          </>
        )}

        {/* ── Parsing state ── */}
        {state === 'parsing' && (
          <>
            <FileSpreadsheet
              size={40}
              color={TOKEN.textMuted}
              aria-hidden="true"
              style={{ marginBottom: '12px', animation: 'pulse 1.5s ease-in-out infinite' }}
            />
            <p style={{ margin: 0, fontSize: '1rem', color: TOKEN.textMuted }}>
              正在解析 {filename}…
            </p>
          </>
        )}

        {/* ── Success state ── */}
        {state === 'success' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <CheckCircle size={32} color={TOKEN.success} aria-hidden="true" />
              <span style={{ fontSize: '1rem', fontWeight: 600, color: TOKEN.success }}>
                上傳成功
              </span>
              <button
                type="button"
                aria-label="清除上傳的檔案"
                onClick={handleReset}
                style={{
                  marginLeft: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: TOKEN.textMuted,
                  padding: '2px',
                  borderRadius: '4px',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = TOKEN.textPrimary }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = TOKEN.textMuted }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: TOKEN.textMuted }}>
              {filename}
              {totalRows !== null && (
                <span style={{ marginLeft: '8px', color: TOKEN.textFaint }}>
                  （共 {totalRows} 列）
                </span>
              )}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: TOKEN.textFaint }}>
              點擊以重新上傳
            </p>
          </>
        )}

        {/* ── Error state ── */}
        {state === 'error' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <AlertCircle size={32} color={TOKEN.error} aria-hidden="true" />
              <span style={{ fontSize: '1rem', fontWeight: 600, color: TOKEN.error }}>
                上傳失敗
              </span>
              <button
                type="button"
                aria-label="關閉錯誤訊息並重試"
                onClick={handleReset}
                style={{
                  marginLeft: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: TOKEN.textMuted,
                  padding: '2px',
                  borderRadius: '4px',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = TOKEN.textPrimary }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = TOKEN.textMuted }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {errorMsg && (
              <p style={{
                margin: 0,
                fontSize: '0.875rem',
                color: TOKEN.error,
                maxWidth: '480px',
                textAlign: 'center',
                lineHeight: 1.55,
              }}>
                {errorMsg}
              </p>
            )}
            <p style={{ margin: '6px 0 0', fontSize: '0.8125rem', color: TOKEN.textFaint }}>
              點擊以重試
            </p>
          </>
        )}
      </div>

      {/* ── Empty state hint (PRD F-17 / F-01) ── */}
      {state === 'idle' && (
        <p
          role="status"
          aria-live="polite"
          style={{
            marginTop: '10px',
            fontSize: '0.8125rem',
            color: TOKEN.textFaint,
            textAlign: 'center',
          }}
        >
          ← 先上傳 .xlsx 檔案，系統將自動辨識欄位
        </p>
      )}

      {/* ── Field mapping results (visible after success or partial-error with mappings) ── */}
      {mappings && mappings.length > 0 && (state === 'success' || state === 'error') && (
        <div
          role="region"
          aria-label="欄位對應結果"
          style={{
            marginTop: '16px',
            backgroundColor: TOKEN.bgCard,
            border: `1px solid #334155`,
            borderRadius: '10px',
            padding: '16px 20px',
          }}
        >
          <p style={{
            margin: '0 0 12px',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: TOKEN.textMuted,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}>
            欄位對應結果 — 辨識 {matchedCount} / {totalFields} 個欄位
          </p>

          <ul
            role="list"
            aria-label="各欄位辨識狀態"
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {mappings.map(fm => {
              const matched = fm.matched_column !== null
              return (
                <li
                  key={fm.field}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '0.875rem',
                  }}
                >
                  {matched ? (
                    <CheckCircle
                      size={16}
                      color={TOKEN.success}
                      aria-label="已辨識"
                      role="img"
                    />
                  ) : (
                    <X
                      size={16}
                      color={fm.required ? TOKEN.error : TOKEN.textFaint}
                      aria-label={fm.required ? '必要欄位缺失' : '未辨識（選填）'}
                      role="img"
                    />
                  )}
                  <span style={{
                    color: matched ? TOKEN.textPrimary : (fm.required ? TOKEN.error : TOKEN.textFaint),
                    fontWeight: fm.required ? 600 : 400,
                    minWidth: '80px',
                  }}>
                    {FIELD_LABELS[fm.field] ?? fm.field}
                    {fm.required && (
                      <span
                        aria-label="必要欄位"
                        style={{ color: TOKEN.error, marginLeft: '2px' }}
                      >
                        *
                      </span>
                    )}
                  </span>
                  <span style={{ color: TOKEN.textFaint }}>→</span>
                  <span style={{
                    color: matched ? TOKEN.textMuted : TOKEN.textFaint,
                    fontStyle: matched ? 'normal' : 'italic',
                  }}>
                    {matched ? fm.matched_column : '未找到'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Keyframe animation for parsing pulse — injected once */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
