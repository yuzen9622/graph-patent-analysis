"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  History,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Trash2,
  FileSpreadsheet,
} from "lucide-react";
import {
  fetchHistory,
  HISTORY_EVENT,
  getHistoryHref,
  type HistoryEntry,
} from "@/lib/analysis-history";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return "";
  }
}

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function AnalysisHistorySidebar({ collapsed, onToggle }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  // History lives in the `analyses` table, so it is loaded per account.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetchHistory().then((next) => {
        if (active) setEntries(next);
      });
    };
    refresh();
    window.addEventListener(HISTORY_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(HISTORY_EVENT, refresh);
    };
  }, []);

  // While something is still running, re-read the server's view of it.
  const hasRunning = entries.some((entry) => entry.status === "analyzing");
  useEffect(() => {
    if (!hasRunning) return;
    let active = true;
    const interval = setInterval(() => {
      void fetchHistory().then((next) => {
        if (active) setEntries(next);
      });
    }, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [hasRunning]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const previous = entries;
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    const res = await fetch(`/api/analyses/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      // Deletion is the server's call; put the row back if it refused.
      setEntries(previous);
    }
  }

  return (
    <aside
      className={[
        "flex flex-col h-full bg-background/60 backdrop-blur-xl border-r border-white/[0.07] shrink-0",
        "transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-14" : "w-64",
      ].join(" ")}
      aria-label="分析歷史側欄"
    >
      {/* Header */}
      <div
        className={[
          "flex items-center border-b border-white/[0.06] h-14 shrink-0",
          collapsed ? "justify-center" : "px-4 justify-between",
        ].join(" ")}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <History
              size={15}
              className="text-accent shrink-0"
              aria-hidden
            />
            <span className="text-sm font-semibold text-foreground">
              分析歷史
            </span>
            {entries.length > 0 && (
              <span className="ml-1 text-[0.65rem] text-foreground bg-black/5 dark:bg-white/8 rounded-full px-1.5 py-0.5 font-mono leading-none">
                {entries.length}
              </span>
            )}
          </div>
        )}
        <button
          onClick={onToggle}
          aria-label={collapsed ? "展開歷史側欄" : "收起歷史側欄"}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground hover:bg-black/5 dark:hover:bg-white/8 transition-colors duration-150 cursor-pointer shrink-0"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {/* Body */}
      {collapsed ? (
        <div className="flex flex-col items-center pt-3 gap-0.5 px-1.5">
          {entries.slice(0, 10).map((entry) => (
            <Link
              key={entry.id}
              href={getHistoryHref(entry)}
              title={`${entry.filename} — ${formatDate(entry.timestamp)}`}
              className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/8 transition-colors duration-150 cursor-pointer"
            >
              <FileSpreadsheet
                size={14}
                className={
                  entry.status === "completed"
                    ? "text-success"
                    : entry.status === "error"
                      ? "text-error"
                      : "text-primary"
                }
                aria-hidden
              />
            </Link>
          ))}
          {entries.length === 0 && (
            <div className="mt-4 text-muted-foreground">
              <Clock size={14} aria-hidden />
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 px-4 text-center">
              <Clock size={28} className="text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground leading-relaxed">
                完成分析後
                <br />
                記錄將顯示於此
              </p>
            </div>
          ) : (
            <ul role="list" className="py-2 px-2 space-y-0.5">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={getHistoryHref(entry)}
                    className="group flex flex-col gap-1 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/8 transition-all duration-150 cursor-pointer hover:border-black/5 dark:hover:border-white/10 border border-transparent"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <div className="mt-0.5 shrink-0">
                        {entry.status === "completed" && (
                          <CheckCircle2
                            size={12}
                            className="text-success"
                            aria-hidden
                          />
                        )}
                        {entry.status === "analyzing" && (
                          <Loader2
                            size={12}
                            className="text-primary animate-spin"
                            aria-hidden
                          />
                        )}
                        {entry.status === "error" && (
                          <AlertCircle
                            size={12}
                            className="text-error"
                            aria-hidden
                          />
                        )}
                      </div>
                      <span className="text-xs text-foreground leading-snug truncate flex-1 font-medium">
                        {entry.filename.replace(/\.xlsx$/i, "")}
                      </span>
                      <button
                        onClick={(e) => handleDelete(entry.id, e)}
                        aria-label={`刪除 ${entry.filename} 記錄`}
                        className="opacity-0 group-hover:opacity-100 shrink-0 w-4 h-4 flex items-center justify-center rounded-md text-muted-foreground hover:text-error transition-all duration-150 cursor-pointer"
                      >
                        <Trash2 size={10} aria-hidden />
                      </button>
                    </div>
                    <div className="pl-5 flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[0.6rem] text-muted-foreground">
                        {entry.id.slice(0, 8)}
                      </span>
                      {entry.patentCount !== undefined && (
                        <span className="text-[0.6rem] text-muted-foreground">
                          · {entry.patentCount} 筆
                        </span>
                      )}
                      <span className="text-[0.6rem] text-muted-foreground ml-auto">
                        {formatDate(entry.timestamp)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
