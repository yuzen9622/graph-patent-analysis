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

  function navigation() {
    return (
      <nav className={styles.navigation} aria-label="工作台導覽">
        <Button variant="ghost" size="default" className="justify-start" aria-label="新對話" title="新對話" onClick={() => { onNewChat(); setMenuOpen(false); }}>
          <SquarePen aria-hidden />新對話
        </Button>
        <Button type="button" size="default" className="justify-start" variant="ghost" onClick={() => { setMenuOpen(false); setSearchOpen(true); }} aria-haspopup="dialog" aria-label="搜尋">
          <Search size={18} aria-hidden />搜尋
        </Button>
        <Button type="button" size="default" className="justify-start" variant={activeTab === "chat" && section === "import" ? "secondary" : "ghost"} onClick={() => navigate("import")} aria-current={activeTab === "chat" && section === "import" ? "page" : undefined} aria-label="匯入 Excel">
          <FileSpreadsheet size={18} aria-hidden />匯入 Excel
        </Button>
        <Button nativeButton={false} render={<Link href="/synonyms" />} size="default" variant="ghost" className="justify-start" aria-label="同義詞管理">
          <BookOpen size={18} aria-hidden />同義詞管理
        </Button>
      </nav>
    );
  }

  function researchHistory() {
    const entries = [
      ...chats.map(chat => ({ ...chat, kind: "chat" as const, label: chat.title ?? chat.preview, date: chat.updated_at })),
      ...jobs.map(job => ({ ...job, kind: "research" as const, label: job.title ?? (job.keywords.join("、") || job.summary), date: job.created_at })),
    ].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.date) - Date.parse(a.date));
    if (!entries.length) return null;
    return <nav aria-label="研究歷史" className={styles.researchHistory}>
      <p className="px-2 text-xs text-muted-foreground">研究歷史</p>
      {entries.map(({ kind, id, label, pinned }) => <HistoryMenu key={kind + id} kind={kind} id={id} title={label} pinned={pinned} onChanged={onHistoryChanged}>
        <Button variant={id === (kind === "chat" ? chatId : selectedJob) ? "secondary" : "ghost"}
          size="default" className="min-w-0 justify-start"
          title={label} aria-label={label} onClick={() => { (kind === "chat" ? onOpenChat : onOpenJob)(id); setMenuOpen(false); }}>
          {pinned ? <Pin aria-label="已釘選" /> : <MessageSquare aria-hidden />}<span className="truncate">{label}</span>
        </Button>
      </HistoryMenu>)}
    </nav>;
  }

  function footer() {
    return <footer className={styles.railFooter}>
      <Button variant="ghost" size="sm" nativeButton={false}
        className="justify-start" aria-label="資料來源 TwIP Search"
        render={<a href="https://cloud.tipo.gov.tw/s690/twipsearch/#/" target="_blank" rel="noopener noreferrer" />}>
        <ArrowUpRight aria-hidden />TwIP Search
      </Button>
      <div className={styles.account}><UserMenu compact={false} /><ModeToggle /></div>
    </footer>;
  }

  return (
    <WorkspaceUserProvider><MotionConfig reducedMotion="user">
      <div className={styles.shell} data-collapsed={collapsed}>
        <a className={styles.skip} href="#workspace-main">跳至主要內容</a>
        <header className={styles.topbar}>
          <div className={styles.railControls}>
            <Button variant="ghost" size="icon" className={styles.desktopToggle} onClick={() => setCollapsed(value => !value)}
              aria-label={collapsed ? "展開側欄" : "收合側欄"} aria-expanded={!collapsed} aria-controls="workspace-sidebar">
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            <Button variant="ghost" size="icon" className={styles.mobileToggle} onClick={() => setMenuOpen(true)} aria-label="開啟導覽選單" aria-expanded={menuOpen}><Menu size={20} /></Button>
          </div>
          {tabBar}
        </header>
        <div id="workspace-sidebar" className={styles.desktopRail} inert={collapsed}>
          <div className={styles.rail}>
            {navigation()}
            {researchHistory()}
            <div className={styles.history}><AnalysisHistorySidebar onChanged={onHistoryChanged} onEntries={onEntries} collapsed={false} /></div>
            {footer()}
          </div>
        </div>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className={styles.drawer}>
            <SheetTitle className="sr-only">工作台導覽</SheetTitle>
            <SheetDescription className="sr-only">開啟專利研究、匯入資料或過往分析。</SheetDescription>
            <div className={styles.rail}>
              {navigation()}
              {researchHistory()}
              <div className={styles.history} onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setMenuOpen(false); }}>
                <AnalysisHistorySidebar onChanged={onHistoryChanged} onEntries={onEntries} collapsed={false} />
              </div>
              {footer()}
            </div>
          </SheetContent>
        </Sheet>
        {searchOpen && <WorkspaceSearch onClose={() => setSearchOpen(false)} onOpenChat={onOpenChat} onOpenJob={onOpenJob} />}
        <div className={styles.body}>
          <main id="workspace-main" tabIndex={-1} className={styles.main} aria-label={title ?? "專利研究"}>{children}</main>

        </div>
      </div>
    </MotionConfig></WorkspaceUserProvider>
  );
}
