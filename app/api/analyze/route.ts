import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
	createJob,
	completeJob,
	failJob,
	isJobCancelled,
	notifyProgress,
} from "@/lib/store";
import {
	createAnalysis,
	setAnalysisStatus,
	type PatentExtras,
} from "@/lib/db/analyses";
import { query } from "@/lib/db/client";
import {
	checkContentLength,
	checkProxyBodyLimit,
	readLimits,
	toPatentExtras,
	validateAnalyzeBody,
} from "@/lib/analyze-limits";
import { requireUser, UnauthorizedError } from "@/lib/db/sessions";
import {
	EXTRACTION_PROMPT_VERSION,
	runBatchExtraction,
} from "@/lib/llm/extractor";
import { detectCommunities } from "@/lib/community";
import { buildGraph } from "@/lib/graph-builder";
import {
	getModel,
	getEnvApiKey,
	PROVIDER_MODELS,
	type ProviderType,
} from "@/lib/llm/providers";
import { buildConceptNetwork } from "@/lib/concept-network";
import { cleanApplicantName } from "@/lib/excel-parser";
import { extractCountry } from "@/lib/applicant-classify";
import { buildSynonymMap, createSnapshot } from "@/lib/synonyms";
import { listSynonymGroups } from "@/lib/db/synonyms";
import { generateText } from "ai";
import type { PatentRow, ExtractionResult } from "@/types/graph";

// ── Trend report ─────────────────────────────────────────────────────────────

const REPORT_SYSTEM_PROMPT = `你是一位專業的金融專利技術分析師。
請根據提供的專利萃取資料，撰寫一份繁體中文技術趨勢報告。
報告需包含以下三個部分，使用 HTML 格式（h4 標題、ul/li 清單），不含任何外層 html/body/head 標籤：
1. <h4>技術核心現況</h4>：目前主要技術領域與核心概念
2. <h4>技術流向分析</h4>：技術演進方向與申請人佈局趨勢
3. <h4>未來研究建議</h4>：值得關注的新興技術與研究缺口
每個部分以 <ul><li>...</li></ul> 格式列舉 3–5 個要點，語言精練專業。`;

async function generateTrendReport(
	extractions: ExtractionResult[],
	provider: ProviderType,
	apiKey: string,
): Promise<string> {
	const FALLBACK_HTML =
		"<h4>技術核心現況</h4><ul><li>報告產生失敗，請檢查 API 金鑰或稍後再試。</li></ul>" +
		"<h4>技術流向分析</h4><ul><li>無法取得分析結果。</li></ul>" +
		"<h4>未來研究建議</h4><ul><li>請重新執行分析。</li></ul>";

	try {
		const sample = extractions.slice(0, 15);
		const prompt = JSON.stringify(
			sample.map((e) => ({
				patent_id: e.patent_id,
				translated_abstract: e.translated_abstract,
				keywords: e.keywords,
				relations: e.relations,
			})),
			null,
			2,
		);

		const model = getModel(provider, apiKey);
		const { text } = await generateText({
			model,
			system: REPORT_SYSTEM_PROMPT,
			prompt,
		});

		return text.trim() || FALLBACK_HTML;
	} catch (err) {
		console.error("[analyze] trend report generation failed:", err);
		return FALLBACK_HTML;
	}
}

// ── Background analysis runner ────────────────────────────────────────────────

/**
 * Parser output that only exists in the browser (the spreadsheet is parsed
 * client-side), forwarded through the request body so it can be persisted
 * (§5-5): without this, `citations` and `data_quality_warnings` would never
 * reach the database and §9-7 could not be verified.
 */
interface ParserContext {
	citations: Array<{ from: string; to: string }>;
	warnings: unknown;
	uploads: Array<{ uploadId: string; originalName?: string | null }>;
}

async function runAnalysis(
	jobId: string,
	patents: PatentRow[],
	provider: ProviderType,
	apiKey: string,
	parserContext: ParserContext,
): Promise<void> {
	try {
		const concurrency = provider === "nvidia" ? 3 : 5;
		const batchSize = 5;
		const model = getModel(provider, apiKey);

		const extractions = await runBatchExtraction(
			patents,
			batchSize,
			concurrency,
			() => isJobCancelled(jobId),
			(batchResults, doneCount) => {
				const batchTitles = batchResults.map(
					(r) =>
						patents.find((p) => p.id === r.patent_id)?.title ?? r.patent_id,
				);
				notifyProgress(
					jobId,
					doneCount,
					patents.length,
					batchTitles,
					Math.ceil(doneCount / batchSize),
				);
			},
			model,
		);

		if (isJobCancelled(jobId)) return;

		// PRD v2 / P1: load the global synonym dictionary and snapshot it (immutable)
		// so this analysis records exactly which terms were merged at run time. The
		// map is applied at the co-occurrence INPUT layer inside buildConceptNetwork.
		const groups = await listSynonymGroups();
		const synonym = buildSynonymMap(groups);
		const synonymSnapshot = createSnapshot(groups);

		const conceptNetwork = buildConceptNetwork(extractions, synonym.map);
		const communityResult = detectCommunities(conceptNetwork);

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
			parserContext.citations,
		);

		const aiReport = await generateTrendReport(extractions, provider, apiKey);
		graph.ai_report = aiReport;

		// Fields the graph nodes do not carry, keyed by patent node id (§6.2).
		const patentExtras = new Map<string, PatentExtras>();
		const applicantCountries = new Map<string, string>();
		for (const patent of patents) {
			const extraction = extractions.find((e) => e.patent_id === patent.id);
			patentExtras.set(
				`patent:${patent.id}`,
				toPatentExtras(patent, extraction?.translated_abstract),
			);

			// The cleaned name is what the graph uses; the country only survives in
			// the raw cell, so map one to the other here.
			for (const part of (patent.applicant_raw ?? "").split(/；|;/)) {
				const trimmed = part.trim();
				if (!trimmed) continue;
				const name = cleanApplicantName(trimmed);
				const country = extractCountry(trimmed);
				if (name && country && !applicantCountries.has(name)) {
					applicantCountries.set(name, country);
				}
			}
		}

		await completeJob(jobId, graph, {
			patentExtras,
			applicantCountries,
			// Only pass a citation set when the browser actually sent one: saveGraph()
			// deletes existing citations whenever this key is present.
			citations:
				parserContext.citations.length > 0
					? parserContext.citations
					: undefined,
			dataQualityWarnings: parserContext.warnings,
			uploads:
				parserContext.uploads.length > 0 ? parserContext.uploads : undefined,
			synonymSnapshot,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[analyze] job ${jobId} failed:`, message);
		failJob(jobId, message);
	}
}

// ── POST /api/analyze ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
	let user;
	try {
		user = await requireUser();
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			return NextResponse.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	const limits = readLimits();

	// Content-Length precheck, before json() buffers anything (§5.2). The second
	// check is Next's own proxy body cap, which truncates silently and currently
	// sits below the §5.2 ceiling — see checkProxyBodyLimit().
	const contentLength = request.headers.get("content-length");
	const tooBig =
		checkContentLength(contentLength, limits.analyzeMaxBodyBytes) ??
		checkProxyBodyLimit(contentLength);
	if (tooBig) {
		return NextResponse.json(
			{ error: tooBig.error },
			{ status: tooBig.status },
		);
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const validated = validateAnalyzeBody(rawBody, limits);
	if (!validated.ok) {
		return NextResponse.json(
			{ error: validated.failure.error },
			{ status: validated.failure.status },
		);
	}
	const {
		provider,
		patents,
		sampleSize,
		uploadIds,
		filenames,
		citations,
		warnings,
	} = validated.value;

	// API key comes from the server environment, not the client.
	const apiKey = getEnvApiKey(provider);
	if (!apiKey) {
		return NextResponse.json(
			{
				error: `Server is missing the API key for provider "${provider}". Set the matching environment variable (e.g. GEMINI_API_KEY).`,
			},
			{ status: 500 },
		);
	}

	// `sampleSize` is a per-source-file cap, so the defensive slice must allow one
	// cap per uploaded file; the global ceiling still bounds the whole request.
	const selectedPatents = patents.slice(
		0,
		Math.min(
			limits.analyzeMaxPatents,
			sampleSize * Math.max(1, filenames.length),
		),
	);

	const jobId = randomUUID();
	createJob(jobId, selectedPatents.length);

	// The row must exist before the background job can update it.
	try {
		await createAnalysis({
			id: jobId,
			ownerId: user.id,
			uploadId: uploadIds[0] ?? null,
			filename: filenames[0] ?? null,
			provider,
			sampleSize: selectedPatents.length,
		});
	} catch (err) {
		console.error("[analyze] could not record the analysis:", err);
		return NextResponse.json(
			{ error: "無法寫入資料庫，分析未啟動。" },
			{ status: 503 },
		);
	}

	const uploads = uploadIds.map((uploadId, index) => ({
		uploadId,
		originalName: filenames[index] ?? null,
	}));

	// Link every upload right away so the history sidebar can list all filenames
	// while the job is still running; saveGraph() re-applies the same rows
	// (ON CONFLICT DO NOTHING) when the analysis completes. A failure here only
	// costs the multi-file label, so it must not abort the analysis.
	if (uploads.length > 0) {
		try {
			await query(
				`INSERT INTO analysis_uploads (analysis_id, upload_id, original_name)
         SELECT $1, u.id, pair.original_name
         FROM unnest($2::uuid[], $3::text[]) AS pair(upload_id, original_name)
         JOIN uploads u ON u.id = pair.upload_id
         ON CONFLICT DO NOTHING`,
				[
					jobId,
					uploads.map((u) => u.uploadId),
					uploads.map((u) => u.originalName),
				],
			);
		} catch (err) {
			console.error("[analyze] could not link uploads:", err);
		}
	}

	// Fire and forget — do not await
	runAnalysis(jobId, selectedPatents, provider, apiKey, {
		citations,
		warnings,
		uploads,
	}).catch((err) => {
		console.error(`[analyze] job ${jobId} crashed:`, err);
		void setAnalysisStatus(jobId, "error", String(err)).catch(() => {});
	});

	return NextResponse.json({ job_id: jobId }, { status: 202 });
}
