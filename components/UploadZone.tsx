"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PatentRow } from "@/types/graph";
import type { FieldMapping } from "@/lib/excel-parser";

type UploadState = "idle" | "dragging" | "parsing" | "success" | "error";

interface UploadZoneProps {
  onParsed: (
    patents: PatentRow[],
    mappings: FieldMapping[],
    filename: string,
    /** The original file, so the caller can archive it and keep only its URL. */
    file: File,
  ) => void;
  onError: (msg: string) => void;
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
      return cn(base, "border-black/5 dark:border-white/10 bg-black/[0.01] dark:bg-white/[0.02] opacity-75 cursor-wait");
    case "success":
      return cn(
        base,
        "border-success/40 bg-success/8 cursor-pointer shadow-sm shadow-success/10",
      );
    case "error":
      return cn(base, "border-error/40 bg-error/8 cursor-pointer");
  }
}

export default function UploadZone({ onParsed, onError }: UploadZoneProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [filename, setFilename] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[] | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropCounter = useRef(0);

  // ── File processing ──────────────────────────────────────────────────────

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".xlsx")) {
        const msg = `不支援的格式「${file.name}」，請上傳 .xlsx 檔案。`;
        setState("error");
        setErrorMsg(msg);
        setMappings(null);
        onError(msg);
        return;
      }

      setState("parsing");
      setErrorMsg(null);
      setMappings(null);
      setFilename(file.name);

      try {
        const buffer = await file.arrayBuffer();
        const { parseExcel } = await import("@/lib/excel-parser");
        const result = parseExcel(buffer, file.name);

        setMappings(result.field_mappings);
        setTotalRows(result.total_rows);

        if (result.errors.length > 0 && result.patents.length === 0) {
          const msg = result.errors[0];
          setState("error");
          setErrorMsg(msg);
          onError(msg);
          return;
        }

        setState("success");
        onParsed(result.patents, result.field_mappings, result.filename, file);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "檔案解析失敗，請檢查格式後重試。";
        setState("error");
        setErrorMsg(msg);
        setMappings(null);
        onError(msg);
      }
    },
    [onParsed, onError],
  );

  // ── Reset ────────────────────────────────────────────────────────────────

  const handleReset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setState("idle");
    setFilename(null);
    setErrorMsg(null);
    setMappings(null);
    setTotalRows(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

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
      const xlsx = Array.from(e.dataTransfer.files).find((f) =>
        f.name.endsWith(".xlsx"),
      );
      if (!xlsx) {
        const msg = "請拖入 .xlsx 格式的 Excel 檔案。";
        setState("error");
        setErrorMsg(msg);
        onError(msg);
        return;
      }
      void processFile(xlsx);
    },
    [state, processFile, onError],
  );

  // ── Click / keyboard ─────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    if (state !== "parsing") fileInputRef.current?.click();
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
      const file = e.target.files?.[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  // ── Derived ──────────────────────────────────────────────────────────────

  const matchedCount =
    mappings?.filter((m) => m.matched_column !== null).length ?? 0;
  const totalFields = mappings?.length ?? 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="w-full">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={state === "parsing" ? -1 : 0}
        aria-label={
          state === "success"
            ? `已上傳 ${filename}，點擊以重新上傳`
            : state === "parsing"
              ? "正在解析檔案，請稍候"
              : "點擊或拖曳 .xlsx 檔案至此上傳"
        }
        aria-disabled={state === "parsing"}
        aria-busy={state === "parsing"}
        className={getZoneClass(state)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
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
              僅支援 .xlsx 格式
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
              正在解析 {filename}…
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
              <button
                type="button"
                aria-label="清除上傳的檔案"
                onClick={handleReset}
                className="ml-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {filename}
              {totalRows !== null && (
                <span className="text-foreground ml-2">
                  （共 {totalRows} 列）
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">點擊以重新上傳</p>
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

      {/* Field mapping results */}
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
