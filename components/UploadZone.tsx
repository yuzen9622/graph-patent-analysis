"use client";

import React, { useCallback, useRef, useState } from "react";
import {
	Upload,
	FileSpreadsheet,
	CheckCircle,
	AlertCircle,
	AlertTriangle,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PatentRow } from "@/types/graph";
import type {
	DataQualityWarnings,
	FieldMapping,
	ParseResult,
} from "@/lib/excel-parser";
import {
	DEFAULT_LIMITS,
	buildFileSummaries,
	summarizeWarnings,
	validateUploadFiles,
	type FileSummary,
} from "@/lib/analyze-limits";

type UploadState = "idle" | "dragging" | "parsing" | "success" | "error";

/** Everything the page needs after a multi-file parse (PRD v2 P0 §5.3). */
export interface ParsedUpload {
	/** De-duplicated rows across every file. */
	patents: PatentRow[];
	/** Per-file parse results, in upload order. */
	results: ParseResult[];
	/** Summed valid rows before the cross-file merge. */
	originalCount: number;
	/** Rows left after the merge — the sample-size default (§5.2). */
	dedupedCount: number;
	warnings: DataQualityWarnings;
	citations: Array<{ from: string; to: string }>;
	filenames: string[];
	/** The original files, so the caller can archive them and keep only the URLs. */
	files: File[];
}

interface UploadZoneProps {
	onParsed: (upload: ParsedUpload) => void;
	onError: (msg: string) => void;
	/** Clears the parsed upload in the parent before a replacement or removal. */
	onClear: () => void;
}

const FIELD_LABELS: Record<string, string> = {
	title: "專利名稱",
	abstract: "摘要",
	applicant: "申請人",
	filing_date: "申請日",
	application_number: "申請號",
};

function getZoneClass(state: UploadState) {
	const base =
		"flex flex-col items-center justify-center w-full min-h-[160px] rounded-xl border-2 border-dashed px-6 py-8 outline-none transition-all duration-200 backdrop-blur-sm";
	switch (state) {
		case "idle":
			return cn(
				base,
				"border-border bg-black/[0.01] dark:bg-white/[0.02] cursor-pointer hover:border-accent/40 hover:bg-accent/5",
			);
		case "dragging":
			return cn(
				base,
				"border-accent/60 bg-accent/10 scale-[1.01] cursor-copy shadow-lg shadow-accent/10",
			);
		case "parsing":
			return cn(
				base,
				"border-black/5 dark:border-white/10 bg-black/[0.01] dark:bg-white/[0.02] opacity-75 cursor-wait",
			);
		case "success":
			return cn(
				base,
				"border-success/40 bg-success/8 cursor-default shadow-sm shadow-success/10",
			);
		case "error":
			return cn(base, "border-error/40 bg-error/8 cursor-pointer");
	}
}

export default function UploadZone({
	onParsed,
	onError,
	onClear,
}: UploadZoneProps) {
	const [state, setState] = useState<UploadState>("idle");
	const [filenames, setFilenames] = useState<string[]>([]);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	/** Field mappings of the first file — the per-field checklist stays single-file. */
	const [mappings, setMappings] = useState<FieldMapping[] | null>(null);
	const [summaries, setSummaries] = useState<FileSummary[] | null>(null);
	const [counts, setCounts] = useState<{
		original: number;
		deduped: number;
	} | null>(null);
	const [warnings, setWarnings] = useState<DataQualityWarnings | null>(null);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const dropCounter = useRef(0);

	// ── File processing ──────────────────────────────────────────────────────

	const processFiles = useCallback(
		async (files: File[]) => {
			// Same ceilings the server enforces (§5.2), applied here purely so the
			// user hears about it before the bytes travel. `DEFAULT_LIMITS` rather
			// than readLimits(): server-side overrides are not visible in a browser
			// bundle, and the server stays the authority either way.
			const failure = validateUploadFiles(
				files.map((f) => ({ name: f.name, size: f.size })),
				DEFAULT_LIMITS,
			);
			if (failure) {
				setState("error");
				setErrorMsg(failure.error);
				setMappings(null);
				setSummaries(null);
				setCounts(null);
				setWarnings(null);
				onError(failure.error);
				return;
			}

			// Do not leave the previous parsed data available while a replacement is
			// being parsed; otherwise it could be analysed after the user selected a
			// new file.
			onClear();
			setState("parsing");
			setErrorMsg(null);
			setMappings(null);
			setSummaries(null);
			setCounts(null);
			setWarnings(null);
			setFilenames(files.map((f) => f.name));

			try {
				const buffers = await Promise.all(
					files.map(async (file) => ({
						buffer: await file.arrayBuffer(),
						filename: file.name,
					})),
				);
				const { parseExcelFiles } = await import("@/lib/excel-parser");
				const result = parseExcelFiles(buffers);

				setMappings(result.results[0]?.field_mappings ?? null);
				setSummaries(buildFileSummaries(result.results));
				setCounts({
					original: result.original_count,
					deduped: result.deduped_count,
				});
				setWarnings(result.warnings);

				if (result.errors.length > 0 && result.patents.length === 0) {
					const msg = result.errors[0];
					setState("error");
					setErrorMsg(msg);
					onError(msg);
					return;
				}

				setState("success");
				onParsed({
					patents: result.patents,
					results: result.results,
					originalCount: result.original_count,
					dedupedCount: result.deduped_count,
					warnings: result.warnings,
					citations: result.citations,
					filenames: files.map((f) => f.name),
					files,
				});
			} catch (err) {
				const msg =
					err instanceof Error
						? err.message
						: "檔案解析失敗，請檢查格式後重試。";
				setState("error");
				setErrorMsg(msg);
				setMappings(null);
				setSummaries(null);
				setCounts(null);
				setWarnings(null);
				onError(msg);
			}
		},
		[onParsed, onError, onClear],
	);

	// ── Reset ────────────────────────────────────────────────────────────────

	const handleReset = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setState("idle");
			setFilenames([]);
			setErrorMsg(null);
			setMappings(null);
			setSummaries(null);
			setCounts(null);
			setWarnings(null);
			if (fileInputRef.current) fileInputRef.current.value = "";
			onClear();
		},
		[onClear],
	);

	// ── Drag ─────────────────────────────────────────────────────────────────

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dropCounter.current += 1;
			if (state !== "parsing") setState("dragging");
		},
		[state],
	);

	const handleDragLeave = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dropCounter.current -= 1;
			if (dropCounter.current === 0 && state === "dragging") setState("idle");
		},
		[state],
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dropCounter.current = 0;
			if (state === "parsing") return;
			// Every dropped .xlsx counts, not just the first one (§5.3).
			const dropped = Array.from(e.dataTransfer.files).filter((f) =>
				f.name.toLowerCase().endsWith(".xlsx"),
			);
			if (dropped.length === 0) {
				const msg = "請拖入 .xlsx 格式的 Excel 檔案。";
				setState("error");
				setErrorMsg(msg);
				onError(msg);
				return;
			}
			void processFiles(dropped);
		},
		[state, processFiles, onError],
	);

	// ── Click / keyboard ─────────────────────────────────────────────────────

	const handleClick = useCallback(() => {
		if (state === "parsing" || state === "success") return;
		// Clearing the input lets a user choose the same file again.
		if (fileInputRef.current) fileInputRef.current.value = "";
		fileInputRef.current?.click();
	}, [state]);
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				handleClick();
			}
		},
		[handleClick],
	);

	const handleFileInput = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(e.target.files ?? []);
			if (files.length > 0) void processFiles(files);
		},
		[processFiles],
	);

	// ── Derived ──────────────────────────────────────────────────────────────

	const matchedCount =
		mappings?.filter((m) => m.matched_column !== null).length ?? 0;
	const totalFields = mappings?.length ?? 0;
	const warningSummary = summarizeWarnings(warnings);
	const filesLabel =
		filenames.length === 0
			? ""
			: filenames.length === 1
				? filenames[0]
				: `${filenames.length} 個檔`;

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div className="w-full">
			{/* Drop zone */}
			<div
				role={state === "success" ? undefined : "button"}
				tabIndex={state === "parsing" || state === "success" ? -1 : 0}
				aria-label={
					state === "success"
						? `已上傳 ${filesLabel}，可重新選擇或移除檔案`
						: state === "parsing"
							? "正在解析檔案，請稍候"
							: "點擊或拖曳 .xlsx 檔案至此上傳，可一次選多個"
				}
				aria-disabled={state === "parsing" ? true : undefined}
				aria-busy={state === "parsing"}
				className={getZoneClass(state)}
				onClick={state === "success" ? undefined : handleClick}
				onKeyDown={state === "success" ? undefined : handleKeyDown}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<input
					ref={fileInputRef}
					type="file"
					accept=".xlsx"
					multiple
					aria-hidden
					tabIndex={-1}
					className="hidden"
					onChange={handleFileInput}
				/>

				{/* Idle / Dragging */}
				{(state === "idle" || state === "dragging") && (
					<>
						<Upload
							size={36}
							className={cn(
								"mb-3 transition-colors duration-200",
								state === "dragging" ? "text-accent" : "text-muted-foreground",
							)}
							aria-hidden
						/>
						<p
							className={cn(
								"font-semibold text-base transition-colors duration-200",
								state === "dragging" ? "text-accent-hover" : "text-foreground",
							)}
						>
							{state === "dragging"
								? "放開以上傳"
								: "拖曳 .xlsx 至此，或點擊選擇"}
						</p>
						<p className="mt-1.5 text-sm text-muted-foreground">
							僅支援 .xlsx 格式，可一次選多個檔（最多{" "}
							{DEFAULT_LIMITS.uploadMaxFiles} 個）
						</p>
					</>
				)}

				{/* Parsing */}
				{state === "parsing" && (
					<>
						<FileSpreadsheet
							size={36}
							className="mb-3 text-muted-foreground animate-pulse"
							aria-hidden
						/>
						<p className="text-base text-muted-foreground">
							正在解析 {filesLabel}…
						</p>
					</>
				)}

				{/* Success */}
				{state === "success" && (
					<>
						<div className="flex items-center gap-2.5 mb-2">
							<CheckCircle size={28} className="text-success" aria-hidden />
							<span className="font-semibold text-base text-success">
								上傳成功
							</span>
						</div>
						<p className="text-sm text-muted-foreground text-center">
							{filenames.join("、")}
							{counts && (
								<span className="text-foreground ml-2">
									（合計 {counts.original} 筆 → 去重後 {counts.deduped} 筆）
								</span>
							)}
						</p>
						<div className="mt-4 flex flex-wrap justify-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleClick}
							>
								<RefreshCw size={14} aria-hidden />
								重新選擇檔案
							</Button>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={handleReset}
							>
								<Trash2 size={14} aria-hidden />
								移除已上傳檔案
							</Button>
						</div>
					</>
				)}

				{/* Error */}
				{state === "error" && (
					<>
						<div className="flex items-center gap-2.5 mb-2">
							<AlertCircle size={28} className="text-error" aria-hidden />
							<span className="font-semibold text-base text-error">
								上傳失敗
							</span>
							<button
								type="button"
								aria-label="關閉錯誤訊息並重試"
								onClick={handleReset}
								className="ml-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							>
								<X size={15} aria-hidden />
							</button>
						</div>
						{errorMsg && (
							<p className="text-sm text-error text-center max-w-sm leading-snug">
								{errorMsg}
							</p>
						)}
						<p className="mt-1.5 text-xs text-muted-foreground">點擊以重試</p>
					</>
				)}
			</div>

			{/* Empty-state hint */}
			{state === "idle" && (
				<p
					role="status"
					aria-live="polite"
					className="mt-2 text-xs text-muted-foreground text-center"
				>
					← 上傳 .xlsx 後系統將自動辨識欄位
				</p>
			)}

			{/* Per-file parse summary (§5.1, §5.3) */}
			{summaries &&
				summaries.length > 0 &&
				(state === "success" || state === "error") && (
					<div
						role="region"
						aria-label="每個檔案的解析結果"
						className="mt-4 bg-black/[0.01] dark:bg-white/[0.03] border border-black/5 dark:border-white/8 rounded-xl p-4 backdrop-blur-sm"
					>
						<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
							檔案解析結果 — 共 {summaries.length} 個檔
						</p>
						<ul role="list" className="space-y-3">
							{summaries.map((summary, index) => (
								<li
									key={`${summary.filename}-${index}`}
									className="text-sm border-b border-black/5 dark:border-white/8 last:border-b-0 pb-3 last:pb-0"
								>
									<p className="font-medium text-foreground break-all">
										{summary.filename}
									</p>
									<dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
										<dt>判定格式</dt>
										<dd className="text-foreground">{summary.formatLabel}</dd>
										<dt>工作表</dt>
										<dd className="text-foreground">
											{summary.sheetName || "（未指定）"}
										</dd>
										<dt>有效筆數</dt>
										<dd className="text-foreground">{summary.validRows} 筆</dd>
										<dt>未識別欄位</dt>
										<dd
											className={
												summary.unmappedColumns.length > 0
													? "text-foreground break-all"
													: "text-muted-foreground"
											}
										>
											{summary.unmappedColumns.length > 0
												? `${summary.unmappedColumns.length} 個：${summary.unmappedColumns.join("、")}`
												: "無"}
										</dd>
									</dl>
									{summary.errors.length > 0 && (
										<p className="mt-1 text-xs text-error">
											{summary.errors.join("；")}
										</p>
									)}
								</li>
							))}
						</ul>

						{counts && (
							<p className="mt-3 pt-3 border-t border-black/5 dark:border-white/8 text-sm font-semibold text-foreground">
								合計 {counts.original} 筆 → 去重後 {counts.deduped} 筆
							</p>
						)}

						{/* Data-quality warnings — collapsed, counts per category (§5.1) */}
						{warningSummary.total > 0 && (
							<details className="mt-3">
								<summary className="text-xs text-warning cursor-pointer flex items-center gap-1.5">
									<AlertTriangle size={13} aria-hidden />
									資料品質警告 {warningSummary.total} 筆（
									{warningSummary.rows.length} 類）— 點擊展開
								</summary>
								<ul role="list" className="mt-2 space-y-1">
									{warningSummary.rows.map((row) => (
										<li
											key={row.key}
											className="flex items-baseline justify-between gap-3 text-xs"
										>
											<span className="text-muted-foreground">{row.label}</span>
											<span className="text-foreground font-mono">
												{row.count} 筆
											</span>
										</li>
									))}
								</ul>
								<p className="mt-2 text-[0.65rem] text-muted-foreground leading-snug">
									警告不會阻擋分析：所有有效資料都會送入萃取，這裡只是讓你知道哪些欄位需要人工確認。
								</p>
							</details>
						)}
					</div>
				)}

			{/* Field mapping results — the first file's header match */}
			{mappings &&
				mappings.length > 0 &&
				(state === "success" || state === "error") && (
					<div
						role="region"
						aria-label="欄位對應結果"
						className="mt-4 bg-black/[0.01] dark:bg-white/[0.03] border border-black/5 dark:border-white/8 rounded-xl p-4 backdrop-blur-sm"
					>
						<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
							欄位對應 — {matchedCount} / {totalFields} 已辨識
							{summaries && summaries.length > 1 && (
								<span className="ml-1 normal-case tracking-normal font-normal">
									（第一個檔：{summaries[0].filename}）
								</span>
							)}
						</p>
						<ul role="list" className="space-y-2">
							{mappings.map((fm) => {
								const matched = fm.matched_column !== null;
								return (
									<li
										key={fm.field}
										className="flex items-center gap-2.5 text-sm"
									>
										{matched ? (
											<CheckCircle
												size={14}
												className="text-success shrink-0"
												aria-label="已辨識"
												role="img"
											/>
										) : (
											<X
												size={14}
												className={cn(
													"shrink-0",
													fm.required ? "text-error" : "text-border",
												)}
												aria-label={
													fm.required ? "必要欄位缺失" : "未辨識（選填）"
												}
												role="img"
											/>
										)}
										<span
											className={cn(
												"min-w-[5rem]",
												matched
													? "text-foreground"
													: fm.required
														? "text-error font-semibold"
														: "text-foreground",
											)}
										>
											{FIELD_LABELS[fm.field] ?? fm.field}
											{fm.required && (
												<span
													className="text-error ml-0.5"
													aria-label="必要欄位"
												>
													*
												</span>
											)}
										</span>
										<span className="text-border">→</span>
										<span
											className={
												matched ? "text-muted-foreground" : "text-border italic"
											}
										>
											{matched ? fm.matched_column : "未找到"}
										</span>
									</li>
								);
							})}
						</ul>
					</div>
				)}
		</div>
	);
}
