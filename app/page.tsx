"use client";

import { Suspense, useState, useId, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart2, Loader2, ArrowRight, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UploadZone, { type ParsedUpload } from "@/components/UploadZone";
import ProgressPanel from "@/components/ProgressPanel";
import AnalysisHistorySidebar from "@/components/AnalysisHistorySidebar";
import UserMenu from "@/components/UserMenu";
import { notifyHistoryChanged } from "@/lib/analysis-history";
import {
	DEFAULT_LIMITS,
	defaultSampleSize,
	formatUploadLabel,
} from "@/lib/analyze-limits";
import { planPatentSample, samplePatents } from "@/lib/sample-patents";
import type { PatentRow } from "@/types/graph";
import type { DataQualityWarnings } from "@/lib/excel-parser";
import type { ProviderType } from "@/lib/llm/providers";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

// Only Gemini is supported; the model is fixed and not user-selectable.
const PROVIDER: ProviderType = "gemini";

// v1.2's 2000 ceiling would have silently truncated a 1741-row upload down the
// road; §5.2 raises it to the same figure the API enforces.
const MAX_SAMPLE = DEFAULT_LIMITS.analyzeMaxPatents;

function Step({
	n,
	label,
	active,
	done,
}: {
	n: number;
	label: string;
	active: boolean;
	done?: boolean;
}) {
	return (
		<div
			className={`flex items-center gap-2 text-sm transition-colors duration-200 ${active ? "text-foreground" : "text-muted-foreground"}`}
		>
			<span
				className={[
					"w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-200",
					done
						? "bg-success text-white shadow-sm shadow-success/40"
						: active
							? "bg-primary text-primary-foreground shadow-sm shadow-blue-400/50"
							: "bg-black/5 dark:bg-white/5 text-foreground border border-border/10",
				].join(" ")}
			>
				{n}
			</span>
			<span className="font-medium whitespace-nowrap">{label}</span>
		</div>
	);
}

function HomePageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [patents, setPatents] = useState<PatentRow[]>([]);
	const [filenames, setFilenames] = useState<string[]>([]);
	const [uploadIds, setUploadIds] = useState<string[]>([]);
	const [citations, setCitations] = useState<
		Array<{ from: string; to: string }>
	>([]);
	const [warnings, setWarnings] = useState<DataQualityWarnings | null>(null);
	// Default is "all of them", filled in once the upload has been parsed (§5.2);
	// the input stays editable so a smaller sample is still possible.
	const [sampleSize, setSampleSize] = useState(1);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	// Ignore storage responses for files the user has already replaced or removed.
	const uploadRequestRef = useRef(0);
	const jobId = searchParams.get("jobId");
	const phase = jobId ? "analyzing" : "upload";

	const sampleInputId = useId();

	// The API still has a global analysis ceiling. Divide it evenly across the
	// participating source strata so a per-file cap can never create a request
	// that the server must reject for exceeding that ceiling.
	const sampleSourceCount = Math.max(
		1,
		planPatentSample({ patents, filenames, sampleSize: 1 }).allocations.length,
	);
	const maxPerFileSample = Math.max(
		1,
		Math.floor(MAX_SAMPLE / sampleSourceCount),
	);
	const effectiveSample =
		patents.length > 0
			? Math.min(sampleSize, patents.length, maxPerFileSample)
			: sampleSize;
	const samplePlan = planPatentSample({
		patents,
		filenames,
		sampleSize: effectiveSample,
	});
	const maxCombinedSample = effectiveSample * sampleSourceCount;
	const sampleHint =
		patents.length > 0
			? filenames.length > 1
				? `每檔最多 ${effectiveSample} 筆，將分析 ${samplePlan.target} / 總計 ${patents.length} 筆（${formatUploadLabel(filenames)}）`
				: `將分析 ${samplePlan.target} / 總計 ${patents.length} 筆`
			: null;
	const sampleAllocationHint =
		patents.length > 0 && filenames.length > 1
			? `每個來源檔各自獨立抽樣，最多合計 ${maxCombinedSample} 筆；預計各檔分配：${samplePlan.allocations
					.map(
						({ sourceFile, allocated }) =>
							`${sourceFile ?? "未標記來源"} ${allocated} 筆`,
					)
					.join("、")}（合計 ${samplePlan.target} 筆）`
			: null;
	const canStart = patents.length > 0;

	function clearUploadedData() {
		setPatents([]);
		setFilenames([]);
		setUploadIds([]);
		setCitations([]);
		setWarnings(null);
		setSampleSize(1);
	}

	function handleClearUpload() {
		uploadRequestRef.current += 1;
		clearUploadedData();
		setUploadError(null);
		setSubmitError(null);
	}

	function handleParsed(upload: ParsedUpload) {
		const requestId = ++uploadRequestRef.current;
		setPatents(upload.patents);
		setFilenames(upload.filenames);
		setCitations(upload.citations);
		setWarnings(upload.warnings);
		setUploadError(null);
		setSubmitError(null);
		// "Analyse everything" is the default the teacher asked for: the box is
		// pre-filled with the de-duplicated count, not 50 (§5.2).
		setSampleSize(
			Math.min(
				defaultSampleSize(upload.dedupedCount, MAX_SAMPLE),
				Math.max(
					1,
					Math.floor(MAX_SAMPLE / Math.max(1, upload.filenames.length)),
				),
			),
		);

		// Archive the original spreadsheets server-side; the database keeps only
		// the resulting URLs, never the bytes. Failure here must not block the
		// analysis, so it degrades to "no source file recorded".
		setUploadIds([]);
		const form = new FormData();
		for (const file of upload.files) form.append("file", file);
		void fetch("/api/uploads", { method: "POST", body: form })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { upload_ids?: string[]; upload_id?: string } | null) => {
				if (uploadRequestRef.current !== requestId) return;
				if (body?.upload_ids?.length) setUploadIds(body.upload_ids);
				else if (body?.upload_id) setUploadIds([body.upload_id]);
			})
			.catch(() => {});
	}

	function handleUploadError(msg: string) {
		uploadRequestRef.current += 1;
		clearUploadedData();
		setUploadError(msg);
		setSubmitError(null);
	}

	async function handleStart() {
		if (patents.length === 0) {
			setSubmitError("請先上傳 .xlsx 檔案。");
			return;
		}
		setSubmitError(null);
		setSubmitting(true);

		const { patents: sampled } = samplePatents({
			patents,
			filenames,
			sampleSize: effectiveSample,
		});

		try {
			const res = await fetch("/api/analyze", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					provider: PROVIDER,
					sample_size: sampleSize,
					patents: sampled,
					upload_ids: uploadIds,
					filenames: filenames.length > 0 ? filenames : ["patents.xlsx"],
					// The spreadsheet is parsed in the browser, so these two only reach
					// the database if they travel in this body (§5-5).
					citations,
					warnings,
				}),
			});

			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as {
					error?: string;
					message?: string;
				};
				// The API reports failures as `error` (e.g. the 413 that explains a
				// ceiling was hit); `message` is only kept as an older fallback.
				throw new Error(
					data.error ?? data.message ?? `伺服器錯誤 ${res.status}`,
				);
			}

			const data = (await res.json()) as { job_id: string };

			// The row already exists server-side; just tell the sidebar to re-read.
			notifyHistoryChanged();

			router.replace(`/?jobId=${encodeURIComponent(data.job_id)}`);
		} catch (err) {
			setSubmitError(
				err instanceof Error ? err.message : "啟動分析失敗，請重試。",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="min-h-dvh bg-background primary-foreground flex flex-col relative overflow-hidden">
			{/* ── Header ── */}
			<header className="sticky top-0 z-10 border-b border-white/[0.08] px-6 py-3.5 flex items-center gap-3 shrink-0 h-14 bg-background/80 backdrop-blur-xl">
				<BarChart2 size={20} className="text-success" aria-hidden />
				<div>
					<h1 className="font-serif text-base font-bold leading-tight primary-foreground">
						王老師專利知識圖譜分析平台
					</h1>
					<p className="text-[0.65rem] primary-foreground mt-0.5 font-mono tracking-wide">
						Patent Knowledge Graph Analysis
					</p>
				</div>
				<div className="ml-auto flex items-center gap-3">
					{USE_MOCK && (
						<span className="flex items-center gap-1.5 text-xs text-warning bg-wartext-warning/10 border border-wartext-warning/20 px-2.5 py-1 rounded-full backdrop-blur-sm">
							<FlaskConical size={12} aria-hidden />
							Mock 模式
						</span>
					)}
					<UserMenu />
				</div>
			</header>

			{/* ── Body: sidebar + main ── */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{/* History sidebar — hidden on mobile */}
				<div className="hidden md:flex shrink-0">
					<AnalysisHistorySidebar
						collapsed={sidebarCollapsed}
						onToggle={() => setSidebarCollapsed((c) => !c)}
					/>
				</div>

				{/* Main content area */}
				<main className="flex-1 overflow-y-auto" aria-label="上傳與設定">
					{/* ── Analyzing phase ── */}
					{phase === "analyzing" && jobId ? (
						<div className="flex items-center justify-center min-h-full px-4 py-16">
							<ProgressPanel key={jobId} jobId={jobId} />
						</div>
					) : (
						/* ── Upload phase ── */
						<div className="flex flex-col items-center justify-center min-h-full px-4 py-10">
							{/* Step indicator */}
							<div className="flex items-center gap-5 mb-8 flex-wrap justify-center w-full max-w-2xl">
								<Step
									n={1}
									label="上傳 Excel"
									active={patents.length === 0}
									done={patents.length > 0}
								/>
								<span className="text-border text-sm select-none" aria-hidden>
									→
								</span>
								<Step n={2} label="開始分析" active={canStart} />
							</div>

							{/* Wizard cards */}
							<div className="w-full max-w-2xl space-y-4">
								{/* Upload card */}
								<section
									className="glass rounded-2xl p-6"
									aria-label="檔案上傳"
								>
									<h2 className="text-xs font-semibold text-primary/70 uppercase tracking-widest mb-4">
										01 · 上傳 Excel 檔案
									</h2>
									<UploadZone
										onParsed={handleParsed}
										onError={handleUploadError}
										onClear={handleClearUpload}
									/>
								</section>

								{/* Settings card */}
								<section
									className="glass rounded-2xl p-6 space-y-5"
									aria-label="分析設定"
								>
									<h2 className="text-xs font-semibold text-primary/70 uppercase tracking-widest">
										02 · 分析設定
									</h2>

									<p className="text-xs text-muted-foreground">
										模型：
										<span className="font-mono text-foreground">
											Google Gemini
										</span>
									</p>

									{/* Sample size */}
									<div className="flex items-end gap-4 pt-4 border-t border-white/[0.06]">
										<div className="flex flex-col gap-1.5">
											<Label
												htmlFor={sampleInputId}
												className="text-xs font-semibold text-primary/70 uppercase tracking-widest"
											>
												每檔抽樣筆數
											</Label>
											<Input
												id={sampleInputId}
												type="number"
												min={1}
												max={maxPerFileSample}
												// Meaningless before a parse: the default is filled in
												// from the de-duplicated count once files are read.
												disabled={patents.length === 0}
												value={sampleSize}
												onChange={(e) => {
													const v = parseInt(e.target.value, 10);
													if (!isNaN(v))
														setSampleSize(
															Math.min(maxPerFileSample, Math.max(1, v)),
														);
												}}
												className="h-9 w-28 border-border bg-background focus-visible:ring-primary text-sm backdrop-blur-sm"
											/>
										</div>
										{(sampleHint || sampleAllocationHint) && (
											<div
												className="flex flex-col gap-1 pb-2 text-xs text-muted-foreground"
												aria-live="polite"
											>
												{sampleHint && <p>{sampleHint}</p>}
												{sampleAllocationHint && (
													<p className="text-primary/80">
														{sampleAllocationHint}
													</p>
												)}
											</div>
										)}
									</div>
								</section>

								{/* Error alerts */}
								{(uploadError || submitError) && (
									<Alert
										variant="destructive"
										className="border-error/30 bg-error/8 text-error backdrop-blur-sm"
									>
										<AlertDescription>
											{submitError ?? uploadError}
										</AlertDescription>
									</Alert>
								)}

								{/* Start button */}
								<div className="flex justify-center pt-2 pb-6">
									<Button
										size="lg"
										onClick={() => {
											void handleStart();
										}}
										disabled={submitting || !canStart}
										className="min-w-48 bg-primary text-primary-foreground font-semibold text-base cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 gap-2 shadow-lg shadow-success/20 hover:shadow-success/30 rounded-xl"
									>
										{submitting ? (
											<>
												<Loader2
													size={18}
													className="animate-spin"
													aria-hidden
												/>
												啟動中…
											</>
										) : (
											<>
												開始分析
												<ArrowRight size={18} aria-hidden />
											</>
										)}
									</Button>
								</div>
							</div>
						</div>
					)}
				</main>
			</div>

			{/* ── Footer ── */}
			<footer className="relative z-10 border-t border-white/[0.06] px-6 py-3 text-center shrink-0 bg-background/60 backdrop-blur-xl">
				<p className="text-xs text-border">
					Google Gemini &nbsp;·&nbsp; 本機部署，資料不離開您的電腦
				</p>
			</footer>
		</div>
	);
}

export default function HomePage() {
	return (
		<Suspense
			fallback={
				<div className="min-h-dvh bg-background flex items-center justify-center">
					<Loader2
						className="h-6 w-6 animate-spin text-primary"
						aria-label="載入中"
					/>
				</div>
			}
		>
			<HomePageContent />
		</Suspense>
	);
}
