"use client";

import { useState, type ReactNode } from "react";
import { WorkspaceSearch } from "./WorkspaceSearch";
import Link from "next/link";
import { ArrowUpRight, BookOpen, FileSpreadsheet, Menu, Pin, Search, SquarePen, MessageSquare, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MotionConfig } from "motion/react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import AnalysisHistorySidebar from "@/components/AnalysisHistorySidebar";
import UserMenu, { WorkspaceUserProvider } from "@/components/UserMenu";
import ModeToggle from "@/components/ModeToggle";
import type { HistoryEntry } from "@/lib/analysis-history";
import styles from "./workspace.module.css";

import { HistoryMenu, type HistoryChanged } from "./HistoryMenu";

export type WorkspaceSection = "research" | "import";

interface WorkspaceShellProps {
  onHistoryChanged: HistoryChanged;
  activeTab: "chat" | "graph";
  tabBar: ReactNode;
  onEntries: (entries: HistoryEntry[]) => void;
  section: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
  jobs: ReadonlyArray<{ id: string; title: string | null; pinned: boolean; summary: string; keywords: string[]; created_at: string }>;
  selectedJob: string | null;
  chats: ReadonlyArray<{ id: string; pinned: boolean; title: string | null; preview: string; updated_at: string }>;
  chatId: string | null;
  chatTitle: string | null;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
  onOpenJob: (id: string) => void;
  children: ReactNode;
}

export function WorkspaceShell({ onHistoryChanged, activeTab, tabBar, onEntries, section, onSectionChange, jobs, selectedJob, chats, chatId, chatTitle, onOpenChat, onNewChat, onOpenJob, children }: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const title = chatTitle;

  function navigate(next: WorkspaceSection) {
    onSectionChange(next);
    setMenuOpen(false);
  }

  function navigation(compact: boolean, desktop = false) {
    return (
      <>
        {desktop && <div className={styles.railControls}>
          <Button variant="ghost" size="icon" onClick={() => setCollapsed(!compact)} aria-label={compact ? "展開側欄" : "收合側欄"}>{compact ? <PanelLeftOpen /> : <PanelLeftClose />}</Button>
        </div>}
        <nav className={styles.navigation} aria-label="工作台導覽">
          <Button variant="ghost" size={compact ? "icon" : "default"} className={compact ? "" : "justify-start"} aria-label="新對話" title="新對話" onClick={() => { onNewChat(); setMenuOpen(false); }}>
            <SquarePen aria-hidden />{!compact && "新對話"}
          </Button>
          <Button type="button" size={compact ? "icon" : "default"} className={compact ? "" : "justify-start"} variant="ghost" onClick={() => { setMenuOpen(false); setSearchOpen(true); }} aria-haspopup="dialog" aria-label="搜尋" title={compact ? "搜尋" : undefined}>
            <Search size={18} aria-hidden />{!compact && "搜尋"}
          </Button>
          <Button type="button" size={compact ? "icon" : "default"} className={compact ? "" : "justify-start"} variant={activeTab === "chat" && section === "import" ? "secondary" : "ghost"} onClick={() => navigate("import")} aria-current={activeTab === "chat" && section === "import" ? "page" : undefined} aria-label="匯入 Excel" title={compact ? "匯入 Excel" : undefined}>
            <FileSpreadsheet size={18} aria-hidden />{!compact && "匯入 Excel"}
          </Button>
          <Button nativeButton={false} render={<Link href="/synonyms" />} size={compact ? "icon" : "default"} variant="ghost" className={compact ? "" : "justify-start"} aria-label="同義詞管理" title={compact ? "同義詞管理" : undefined}>
            <BookOpen size={18} aria-hidden />{!compact && "同義詞管理"}
          </Button>
        </nav>
      </>
    );
  }

  function researchHistory(compact: boolean) {
    const entries = [
      ...chats.map(chat => ({ ...chat, kind: "chat" as const, label: chat.title ?? chat.preview, date: chat.updated_at })),
      ...jobs.map(job => ({ ...job, kind: "research" as const, label: job.title ?? (job.keywords.join("、") || job.summary), date: job.created_at })),
    ].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.date) - Date.parse(a.date));
    if (!entries.length) return null;
    return <nav aria-label="研究歷史" className={styles.researchHistory}>
      {!compact && <p className="px-2 text-xs text-muted-foreground">研究歷史</p>}
      {entries.map(({ kind, id, label, pinned }) => <HistoryMenu key={kind + id} kind={kind} id={id} title={label} pinned={pinned} onChanged={onHistoryChanged}>
        <Button variant={id === (kind === "chat" ? chatId : selectedJob) ? "secondary" : "ghost"}
          size={compact ? "icon" : "default"} className={compact ? "" : "min-w-0 justify-start"}
          title={label} aria-label={label} onClick={() => { (kind === "chat" ? onOpenChat : onOpenJob)(id); setMenuOpen(false); }}>
          {pinned ? <Pin aria-label="已釘選" /> : <MessageSquare aria-hidden />}{!compact && <span className="truncate">{label}</span>}
        </Button>
      </HistoryMenu>)}
    </nav>;
  }

  function footer(compact: boolean) {
    return <footer className={styles.railFooter}>
      <Button variant="ghost" size={compact ? "icon" : "sm"} nativeButton={false}
        className={compact ? "" : "justify-start"} aria-label="資料來源 TwIP Search"
        render={<a href="https://cloud.tipo.gov.tw/s690/twipsearch/#/" target="_blank" rel="noopener noreferrer" />}>
        <ArrowUpRight aria-hidden />{!compact && "TwIP Search"}
      </Button>
      <div className={styles.account}><UserMenu compact={compact} /><ModeToggle /></div>
    </footer>;
  }

  return (
    <WorkspaceUserProvider><MotionConfig reducedMotion="user">
      <div className={styles.shell}>
        <a className={styles.skip} href="#workspace-main">跳至主要內容</a>
        <div className={`${styles.rail} ${styles.desktopRail} ${collapsed ? styles.railCollapsed : ""}`}>
          {navigation(collapsed, true)}
          {researchHistory(collapsed)}
          <div className={styles.history}><AnalysisHistorySidebar onChanged={onHistoryChanged} onEntries={onEntries} collapsed={collapsed} /></div>
          {footer(collapsed)}
        </div>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className={styles.drawer}>
            <SheetTitle className="sr-only">工作台導覽</SheetTitle>
            <SheetDescription className="sr-only">開啟專利研究、匯入資料或過往分析。</SheetDescription>
            <div className={styles.rail}>
              {navigation(false)}
              {researchHistory(false)}
              <div className={styles.history} onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setMenuOpen(false); }}>
                <AnalysisHistorySidebar onChanged={onHistoryChanged} onEntries={onEntries} collapsed={false} />
              </div>
              {footer(false)}
            </div>
          </SheetContent>
        </Sheet>
        {searchOpen && <WorkspaceSearch onClose={() => setSearchOpen(false)} onOpenChat={onOpenChat} onOpenJob={onOpenJob} />}
        <div className={styles.body}>
          <header className={styles.topbar}>
            <Button variant="ghost" size="icon" className={styles.mobileToggle} onClick={() => setMenuOpen(true)} aria-label="開啟導覽選單" aria-expanded={menuOpen}><Menu size={20} /></Button>
            {tabBar}
          </header>
          <main id="workspace-main" tabIndex={-1} className={styles.main} aria-label={title ?? "專利研究"}>{children}</main>

        </div>
      </div>
    </MotionConfig></WorkspaceUserProvider>
  );
}
