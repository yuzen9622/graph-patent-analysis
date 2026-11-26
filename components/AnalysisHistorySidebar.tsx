"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { History, PanelLeftClose, PanelLeftOpen, Clock, CheckCircle2, Loader2, AlertCircle, Pin, FileSpreadsheet } from "lucide-react";
import { SidebarHighlight } from "./workspace/SidebarHighlight";
import { HistoryMenu, type HistoryChanged } from "./workspace/HistoryMenu";
import { Button } from "@/components/ui/button";
import { fetchHistory, HISTORY_EVENT, getHistoryHref, type HistoryEntry } from "@/lib/analysis-history";
import styles from "@/components/workspace/history.module.css";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

interface Props { onChanged: HistoryChanged; onEntries: (entries: HistoryEntry[]) => void; collapsed: boolean; onToggle?: () => void }

export default function AnalysisHistorySidebar({ onChanged, collapsed, onToggle, onEntries }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetchHistory().then((next) => { if (active) { setEntries(next); setLoading(false); } });
    };
    refresh();
    window.addEventListener(HISTORY_EVENT, refresh);
    return () => { active = false; window.removeEventListener(HISTORY_EVENT, refresh); };
  }, []);

  useEffect(() => { if (!loading) onEntries(entries); }, [entries, loading, onEntries]);

  const hasRunning = entries.some((entry) => entry.status === "analyzing");
  useEffect(() => {
    if (!hasRunning) return;
    let active = true;
    const interval = setInterval(() => { void fetchHistory().then((next) => { if (active) setEntries(next); }); }, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [hasRunning]);

  return (
    <aside className={`${styles.history} ${collapsed ? styles.collapsed : ""}`} aria-label="分析紀錄側欄">
      <div className={styles.header}>
        {!collapsed && <span><History size={14} aria-hidden />近期分析{entries.length > 0 && <small>{entries.length}</small>}</span>}
        {onToggle && <Button variant="ghost" size="icon" onClick={onToggle} aria-label={collapsed ? "展開歷史側欄" : "收起歷史側欄"} className="shrink-0">
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </Button>}
      </div>
      <motion.div layoutScroll className={styles.list} aria-busy={loading}>
        {loading ? <div className={styles.empty}><Loader2 size={18} className="animate-spin" aria-hidden /><span className={collapsed ? "sr-only" : ""}>載入分析紀錄…</span></div>
        : entries.length === 0 ? <div className={styles.empty}><Clock size={20} aria-hidden /><p className={collapsed ? "sr-only" : ""}>還沒有分析紀錄<span>匯入 Excel 並開始分析後，可在這裡查看進度。</span></p></div>
        : <ul>{entries.map((entry) => <li key={entry.id} className={styles.row} data-sidebar-row={"graph" + entry.id}>
          <SidebarHighlight row={"graph" + entry.id} />
          <HistoryMenu kind="graph" id={entry.id} title={entry.title ?? entry.filename.replace(/\.xlsx$/i, "")} pinned={entry.pinned} onChanged={onChanged} showRowActions={!collapsed}>
          <Link href={getHistoryHref(entry)} className={styles.link} title={collapsed ? entry.title ?? entry.filename : undefined} aria-label={collapsed ? entry.title ?? entry.filename : undefined}>
            <span className={styles.status}>
              {collapsed && entry.pinned ? <Pin size={14} aria-label="已釘選" /> : entry.status === "completed" ? <CheckCircle2 size={15} aria-label="已完成" /> : entry.status === "analyzing" ? <Loader2 size={15} className="animate-spin" aria-label="分析中" /> : entry.status === "error" ? <AlertCircle size={15} aria-label="分析失敗" /> : <FileSpreadsheet size={15} aria-hidden />}
            </span>
            {!collapsed && <span className={styles.entry}><strong>{entry.title ?? entry.filename.replace(/\.xlsx$/i, "")}</strong><small>{entry.patentCount !== undefined ? `${entry.patentCount.toLocaleString("zh-TW")} 筆專利` : "分析紀錄"}<time dateTime={entry.timestamp}>{formatDate(entry.timestamp)}</time></small></span>}
          </Link>
          </HistoryMenu>
        </li>)}</ul>}
      </motion.div>
    </aside>
  );
}
