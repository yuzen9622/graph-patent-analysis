"use client";

import { Card, CardContent } from "@/components/ui/card";

import React, { useCallback, useImperativeHandle, useRef, useState, type Ref } from "react";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Attachment,
  AttachmentActions,
  AttachmentAction,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
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

export interface UploadZoneHandle {
  importFiles: (files: File[]) => Promise<void>;
}

interface UploadZoneProps {
  ref?: Ref<UploadZoneHandle>;
  onParsed: (upload: ParsedUpload) => void;
  onError: (msg: string) => void;
  /** Clears the parsed upload in the parent before a replacement or removal. */
  onClear: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  title: "專利名稱",
  abstract: "摘要",
  applicant: "申請人",
  applicants_exact: "完整申請人",
  filing_date: "申請日",
  application_number: "申請號",
};


export default function UploadZone({
  ref,
  onParsed,
  onError,
  onClear,
}: UploadZoneProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [filenames, setFilenames] = useState<string[]>([]);
  /** The actual files, kept so a single file can be removed and the rest re-parsed. */
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
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

      setUploadedFiles(files);

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

  useImperativeHandle(ref, () => ({ importFiles: processFiles }), [processFiles]);

  // ── Reset ────────────────────────────────────────────────────────────────

  const handleReset = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
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

  // ── Per-file removal ──────────────────────────────────────────────────────

  /** Removes one file and re-parses the rest so counts, warnings and the
   *  parent's parsed state stay consistent; falls back to a full reset when
   *  the last file is removed. Index-based so duplicate filenames work. */
  const handleRemoveFile = useCallback(
    (index: number) => {
      const remaining = uploadedFiles.filter((_, i) => i !== index);
      if (remaining.length === 0) {
        handleReset();
        return;
      }
      void processFiles(remaining);
    },
    [uploadedFiles, processFiles, handleReset],
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
    if (state === "parsing") return;
    // Clearing the input lets a user choose the same file again.
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }, [state]);

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
      <Card className={cn("border border-dashed border-input bg-muted/30 shadow-none ring-0", state === "dragging" && "border-primary bg-accent")} aria-busy={state === "parsing"}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      ><CardContent className="grid min-h-40 place-items-center content-center gap-3 text-center">
        <Input
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
            <FileSpreadsheet size={24} className="text-muted-foreground" aria-hidden />
            <Button type="button" variant="outline" onClick={handleClick}><Upload aria-hidden />{state === "dragging" ? "放開以上傳" : "選擇 Excel 檔案"}</Button>
            <p className="mt-1.5 text-sm text-muted-foreground">
              或拖入 .xlsx 檔案，最多{" "}
              {DEFAULT_LIMITS.uploadMaxFiles} 個
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
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="關閉錯誤訊息並重試"
                onClick={handleReset}
                className="ml-1"
              >
                <X size={15} aria-hidden />
              </Button>
            </div>
            {errorMsg && (
              <p className="text-sm text-error text-center max-w-sm leading-snug">
                {errorMsg}
              </p>
            )}
            <Button variant="outline" onClick={handleClick}>重新選擇檔案</Button>
          </>
        )}
      </CardContent></Card>

      {/* Empty-state hint */}
      {state === "idle" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-xs text-muted-foreground text-center"
        >
          匯入後會自動辨識專利欄位
        </p>
      )}

      {/* Per-file parse summary (§5.1, §5.3) */}
      {summaries &&
        summaries.length > 0 &&
        (state === "success" || state === "error") && (
          <Card
            role="region"
            aria-label="每個檔案的解析結果" className="mt-4"
          ><CardContent>
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <p className="text-sm text-muted-foreground">
                共處理 {summaries.length} 個檔案
              </p>
            </div>
            <ul role="list" className="space-y-2">
              {summaries.map((summary, index) => (
                <li key={`${summary.filename}-${index}`}>
                  <Attachment
                    state={summary.errors.length > 0 ? "error" : "done"}
                    size="sm"
                    className="w-full items-start"
                  >
                    <AttachmentMedia>
                      <FileSpreadsheet size={16} aria-hidden />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle className="break-all whitespace-normal">
                        {summary.filename}
                      </AttachmentTitle>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <dt>判定格式</dt>
                        <dd className="text-foreground">
                          {summary.formatLabel}
                        </dd>
                        <dt>工作表</dt>
                        <dd className="text-foreground">
                          {summary.sheetName || "（未指定）"}
                        </dd>
                        <dt>有效筆數</dt>
                        <dd className="text-foreground">
                          {summary.validRows} 筆
                        </dd>
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
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction
                        type="button"
                        onClick={() => handleRemoveFile(index)}
                        aria-label={`移除檔案 ${summary.filename}`}
                        title="移除這個檔案，其餘檔案會重新解析"
                        className="text-muted-foreground hover:bg-error/10 hover:text-error cursor-pointer"
                      >
                        <X size={15} aria-hidden />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                </li>
              ))}
            </ul>

            {counts && (
              <p className="mt-3 pt-3 text-sm font-semibold text-foreground">
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
          </CardContent></Card>
        )}

      {/* Field mapping results — the first file's header match */}
      {mappings &&
        mappings.length > 0 &&
        (state === "success" || state === "error") && (
          <Card
            role="region"
            aria-label="欄位對應結果" className="mt-4"
          ><CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              已辨識 {matchedCount} / {totalFields} 個欄位
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
          </CardContent></Card>
        )}
    </div>
  );
}
