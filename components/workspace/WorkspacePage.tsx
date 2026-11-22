"use client";

import { Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import ProgressPanel from "@/components/ProgressPanel";
import { useResearchService } from "@/components/research/use-research";
import { notifyHistoryChanged, getHistoryHref, type HistoryEntry } from "@/lib/analysis-history";
import { ChatPanel } from "./ChatPanel";
import { WorkspaceShell, type WorkspaceSection } from "./WorkspaceShell";
import { WorkspaceTabs, type WorkspaceTab } from "./WorkspaceTabs";
import styles from "./workspace.module.css";

function tabFromHref(href: string): WorkspaceTab {
  const { pathname, searchParams } = new URL(href, "https://workspace.local");
  const graph = pathname === "/analysis" || searchParams.has("jobId") || searchParams.get("tab") === "graph";
  const chat = pathname.startsWith("/c/") ? pathname.slice(3) : null;
  const job = searchParams.get("researchId");
  const analysis = searchParams.get("jobId") ?? searchParams.get("id");
  const draft = searchParams.get("draft");
  const resource = graph ? `graph:${analysis ?? "home"}` : chat ? `chat:${chat}` : job ? `research:${job}` : `draft:${draft ?? "home"}`;
  const title = graph ? searchParams.has("jobId") ? "分析進度" : "專利知識圖譜"
    : job ? "專利研究" : draft && /^\d+$/.test(draft) ? `新對話 ${draft}` : "新對話";
  return { key: resource, resource, href, kind: graph ? "graph" : "chat", section: "research", title };
}

function WorkspaceContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const href = pathname + (query ? `?${query}` : "");
  const [tabs, setTabs] = useState(() => [tabFromHref(href)]);
  const [seenHref, setSeenHref] = useState(href);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const shared = useResearchService();
  const nextDraft = useRef(2);
  const route = tabFromHref(href);
  const current = tabs.find(tab => tab.resource === route.resource);

  // Deep links, Back/Forward and changes to graph filters all enter here.
  if (seenHref !== href) {
    setSeenHref(href);
    if (!current) {
      // A saved conversation keeps its original panel key when a draft is first sent.
      let key = route.resource;
      while (tabs.some(tab => tab.key === key)) key += "-new";
      setTabs([...tabs, { ...route, key }]);
    }
    else if (current.href !== href) setTabs(tabs.map(tab => tab === current ? { ...tab, href } : tab));
  }

  function select(tab: WorkspaceTab) {
    if (tab.href !== href) router.push(tab.href, { scroll: false });
  }
  function newChat() {
    while (tabs.some(tab => tab.resource === `draft:${nextDraft.current}`)) nextDraft.current++;
    router.push(`/?draft=${nextDraft.current++}`, { scroll: false });
  }
  function close(tab: WorkspaceTab) {
    const index = tabs.findIndex(item => item.key === tab.key);
    const remaining = tabs.filter(item => item.key !== tab.key);
    setTabs(remaining);
    if (current?.key !== tab.key) return;
    const neighbor = remaining[index] ?? remaining[index - 1];
    if (neighbor) {
      router.replace(neighbor.href, { scroll: false });
      document.getElementById(`tab-${neighbor.key}`)?.focus();
    } else newChat();
  }

  function setSection(key: string, section: WorkspaceSection) {
    setTabs(items => items.map(item => item.key === key ? { ...item, section } : item));
  }
  function navigate(section: WorkspaceSection) {
    const tab = current?.kind === "chat" ? current : tabs.findLast(item => item.kind === "chat");
    if (tab) {
      setSection(tab.key, section);
      select(tab);
    } else {
      const next = tabFromHref("/");
      setTabs(items => [...items, { ...next, section }]);
      select(next);
    }
  }
  function openResearch(location: string) {
    const target = tabFromHref(location);
    const existing = tabs.find(tab => tab.resource === target.resource);
    if (existing) setSection(existing.key, "research");
    select(existing ?? target);
  }
  function updateLocation(tab: WorkspaceTab, next: string) {
    const target = tabFromHref(next);
    setTabs(items => items.some(item => item.key !== tab.key && item.resource === target.resource)
      ? items.filter(item => item.key !== tab.key)
      : items.map(item => item.key === tab.key ? { ...item, resource: target.resource, href: next } : item));
    if (tabFromHref(window.location.pathname + window.location.search).resource === tab.resource) {
      window.history.replaceState(null, "", next);
    }
  }
  const rename = useCallback((key: string, title: string) => {
    setTabs(items => items.some(item => item.key === key && item.title !== title)
      ? items.map(item => item.key === key ? { ...item, title } : item) : items);
  }, []);

  const chats = shared.service?.chats ?? [];
  const jobs = shared.service?.jobs ?? [];
  function label(tab: WorkspaceTab) {
    if (tab.section === "import") return "匯入 Excel";
    const [type, id] = tab.resource.split(":");
    if (type === "graph") {
      const entry = entries.find(entry => entry.id === id);
      return entry?.title ?? entry?.filename.replace(/\.xlsx$/i, "") ?? tab.title;
    }
    if (type === "research") {
      const job = jobs.find(item => item.id === id);
      return job?.title || job?.keywords.join("、") || job?.summary || tab.title;
    }
    const chat = chats.find(item => type === "chat" && item.id === id);
    return chat?.title || chat?.preview || tab.title;
  }

  return <WorkspaceShell activeTab={route.kind} chatTitle={current ? label(current) : null}
    tabBar={<WorkspaceTabs tabs={tabs} active={current?.key ?? ""} label={label} onSelect={select} onClose={close} onNew={newChat} onReorder={setTabs} />}
    onHistoryChanged={(kind, id, deleted) => {
      if (deleted) {
        const tab = tabs.find(item => item.resource === `${kind}:${id}`);
        if (tab) close(tab);
      }
      if (kind === "graph") notifyHistoryChanged();
      else void shared.refreshService();
    }}
    chats={chats} jobs={jobs} chatId={pathname.startsWith("/c/") ? pathname.slice(3) : null}
    selectedJob={params.get("researchId")} onEntries={setEntries}
    onOpenChat={id => openResearch(`/c/${encodeURIComponent(id)}`)}
    onOpenJob={id => openResearch(`/?researchId=${encodeURIComponent(id)}`)}
    onNewChat={newChat} section={current?.section ?? "research"} onSectionChange={navigate}>
    {tabs.map(tab => <div key={tab.key} id={`panel-${tab.key}`} role="tabpanel" aria-labelledby={`tab-${tab.key}`}
      hidden={current?.key !== tab.key} className={styles.panel} data-kind={tab.kind}>
      {tab.kind === "chat" ? <ChatPanel tabKey={tab.key} href={tab.href} section={tab.section} shared={shared}
        onTitle={rename} updateChatLocation={next => updateLocation(tab, next)} onSection={section => setSection(tab.key, section)} />
        : current?.key === tab.key && (params.get("jobId")
          ? <div className={styles.progress}><ProgressPanel key={tab.resource} jobId={params.get("jobId")!} /></div>
          : pathname === "/analysis" ? children : <div className={styles.graphEmpty}>
            <h1>專利知識圖譜</h1>
            {entries.map(entry => <button key={entry.id} onClick={() => router.push(getHistoryHref(entry))}>{entry.title ?? entry.filename}</button>)}
            <button onClick={() => navigate("import")}>匯入 Excel</button>
          </div>)}
    </div>)}
  </WorkspaceShell>;
}

export default function WorkspacePage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loader2 className="m-auto animate-spin" aria-label="載入中" />}><WorkspaceContent>{children}</WorkspaceContent></Suspense>;
}
