import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createJob, completeJob, failJob, isJobCancelled, notifyProgress } from '@/lib/store'
import { createAnalysis, setAnalysisStatus } from '@/lib/db/analyses'
import { requireUser, UnauthorizedError } from '@/lib/db/sessions'
import { EXTRACTION_PROMPT_VERSION, runBatchExtraction } from '@/lib/llm/extractor'
import { detectCommunities } from '@/lib/community'
import { buildGraph } from '@/lib/graph-builder'
import { getModel, getEnvApiKey, PROVIDER_MODELS, type ProviderType } from '@/lib/llm/providers'
import { buildConceptNetwork } from '@/lib/concept-network'
import { cleanApplicantName } from '@/lib/excel-parser'
import { extractCountry } from '@/lib/applicant-classify'
import { generateText } from 'ai'
import type { PatentRow, ExtractionResult } from '@/types/graph'

// ── Trend report ─────────────────────────────────────────────────────────────

const REPORT_SYSTEM_PROMPT = `你是一位專業的金融專利技術分析師。
請根據提供的專利萃取資料，撰寫一份繁體中文技術趨勢報告。
報告需包含以下三個部分，使用 HTML 格式（h4 標題、ul/li 清單），不含任何外層 html/body/head 標籤：
1. <h4>技術核心現況</h4>：目前主要技術領域與核心概念
2. <h4>技術流向分析</h4>：技術演進方向與申請人佈局趨勢
3. <h4>未來研究建議</h4>：值得關注的新興技術與研究缺口
每個部分以 <ul><li>...</li></ul> 格式列舉 3–5 個要點，語言精練專業。`

async function generateTrendReport(
  extractions: ExtractionResult[],
  provider: ProviderType,
  apiKey: string,
): Promise<string> {
  const FALLBACK_HTML =
    '<h4>技術核心現況</h4><ul><li>報告產生失敗，請檢查 API 金鑰或稍後再試。</li></ul>' +
    '<h4>技術流向分析</h4><ul><li>無法取得分析結果。</li></ul>' +
    '<h4>未來研究建議</h4><ul><li>請重新執行分析。</li></ul>'

  try {
    const sample = extractions.slice(0, 15)
    const prompt = JSON.stringify(
      sample.map((e) => ({
        patent_id: e.patent_id,
        translated_abstract: e.translated_abstract,
        keywords: e.keywords,
        relations: e.relations,
      })),
      null,
      2,
    )

    const model = getModel(provider, apiKey)
    const { text } = await generateText({
      model,
      system: REPORT_SYSTEM_PROMPT,
      prompt,
    })

    return text.trim() || FALLBACK_HTML
  } catch (err) {
    console.error('[analyze] trend report generation failed:', err)
    return FALLBACK_HTML
  }
}

// ── Background analysis runner ────────────────────────────────────────────────

async function runAnalysis(
  jobId: string,
  patents: PatentRow[],
  provider: ProviderType,
  apiKey: string,
): Promise<void> {
  try {
    const concurrency = provider === 'nvidia' ? 3 : 5
    const batchSize = 5
    const model = getModel(provider, apiKey)

    const extractions = await runBatchExtraction(
      patents,
      batchSize,
      concurrency,
      () => isJobCancelled(jobId),
      (batchResults, doneCount) => {
        const batchTitles = batchResults
          .map((r) => patents.find((p) => p.id === r.patent_id)?.title ?? r.patent_id)
        notifyProgress(jobId, doneCount, patents.length, batchTitles, Math.ceil(doneCount / batchSize))
      },
      model,
    )

    if (isJobCancelled(jobId)) return

    const conceptNetwork = buildConceptNetwork(extractions)
    const communityResult = detectCommunities(conceptNetwork)

    const graph = buildGraph(
      patents,
      conceptNetwork,
      communityResult.assignments,
      communityResult.colors,
      communityResult.names,
      {
        prompt_version: EXTRACTION_PROMPT_VERSION,
        model_provider: provider,
        model_id: PROVIDER_MODELS[provider],
      },
    )

    const aiReport = await generateTrendReport(extractions, provider, apiKey)
    graph.ai_report = aiReport

    // Fields the graph nodes do not carry, keyed by patent node id.
    const patentExtras = new Map<string, { search_keyword?: string; translated_abstract?: string }>()
    const applicantCountries = new Map<string, string>()
    for (const patent of patents) {
      const extraction = extractions.find((e) => e.patent_id === patent.id)
      patentExtras.set(`patent:${patent.id}`, {
        search_keyword: patent.search_keyword,
        translated_abstract: extraction?.translated_abstract,
      })

      // The cleaned name is what the graph uses; the country only survives in
      // the raw cell, so map one to the other here.
      for (const part of (patent.applicant_raw ?? '').split(/；|;/)) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const name = cleanApplicantName(trimmed)
        const country = extractCountry(trimmed)
        if (name && country && !applicantCountries.has(name)) {
          applicantCountries.set(name, country)
        }
      }
    }

    await completeJob(jobId, graph, { patentExtras, applicantCountries })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[analyze] job ${jobId} failed:`, message)
    failJob(jobId, message)
  }
}

// ── POST /api/analyze ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }
    throw err
  }

  let body: {
    provider?: string
    sample_size?: number
    patents?: PatentRow[]
    upload_id?: string
    filename?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { provider, patents } = body
  const sampleSize: number = body.sample_size ?? 50

  if (!provider || !['nvidia', 'gemini', 'openai'].includes(provider)) {
    return NextResponse.json(
      { error: 'provider must be one of: nvidia, gemini, openai' },
      { status: 400 },
    )
  }

  // API key comes from the server environment, not the client.
  const apiKey = getEnvApiKey(provider as ProviderType)
  if (!apiKey) {
    return NextResponse.json(
      {
        error: `Server is missing the API key for provider "${provider}". Set the matching environment variable (e.g. GEMINI_API_KEY).`,
      },
      { status: 500 },
    )
  }

  if (!Array.isArray(patents) || patents.length === 0) {
    return NextResponse.json(
      { error: 'patents must be a non-empty array' },
      { status: 400 },
    )
  }

  const selectedPatents = patents.slice(0, sampleSize)

  const jobId = randomUUID()
  createJob(jobId, selectedPatents.length)

  // The row must exist before the background job can update it.
  try {
    await createAnalysis({
      id: jobId,
      ownerId: user.id,
      uploadId: body.upload_id ?? null,
      filename: body.filename ?? null,
      provider,
      sampleSize: selectedPatents.length,
    })
  } catch (err) {
    console.error('[analyze] could not record the analysis:', err)
    return NextResponse.json({ error: '無法寫入資料庫，分析未啟動。' }, { status: 503 })
  }

  // Fire and forget — do not await
  runAnalysis(jobId, selectedPatents, provider as ProviderType, apiKey).catch((err) => {
    console.error(`[analyze] job ${jobId} crashed:`, err)
    void setAnalysisStatus(jobId, 'error', String(err)).catch(() => {})
  })

  return NextResponse.json({ job_id: jobId }, { status: 202 })
}
