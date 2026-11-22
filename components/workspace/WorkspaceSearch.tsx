"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Network, MessageSquare, FileSearch } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getHistoryHref } from "@/lib/analysis-history";

type Result = { id: string; kind: "graph" | "chat" | "research"; title: string; date: string; running: boolean };
const groups = ["知識圖譜", "研究歷史"] as const;
const groupOf = (result: Result) => result.kind === "graph" ? groups[0] : groups[1];
const keyOf = (result: Result) => result.kind + result.id;

export function WorkspaceSearch({ onClose, onOpenChat, onOpenJob }: {
  onClose: () => void; onOpenChat: (id: string) => void; onOpenJob: (id: string) => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<typeof groups[number] | null>(null);
  const [selected, setSelected] = useState("");
  const [response, setResponse] = useState<{ term: string; results: Result[]; failed?: boolean }>();
  const term = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/workspace-search?q=" + encodeURIComponent(term), { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!controller.signal.aborted) setResponse({ term, results: data.results });
      } catch {
        if (!controller.signal.aborted) setResponse({ term, results: [], failed: true });
      }
    }, term ? 150 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term]);

  const ready = response?.term === term;
  const sections = groups.filter(group => !filter || filter === group).map(group => ({
    group, rows: ready ? response.results.filter(result => groupOf(result) === group) : [],
  }));
  const rows = sections.flatMap(section => section.rows);
  const active = rows.find(row => keyOf(row) === selected) ?? rows[0];

  function open(row: Result) {
    setIsOpen(false);
    if (row.kind === "graph") router.push(getHistoryHref({ id: row.id, status: row.running ? "analyzing" : "completed" }));
    else if (row.kind === "chat") onOpenChat(row.id);
    else onOpenJob(row.id);
  }

  return <Dialog open={isOpen} onOpenChange={setIsOpen} onOpenChangeComplete={open => { if (!open) onClose(); }}>
    <DialogContent initialFocus={input} showCloseButton={false} className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[40rem]">
      <DialogTitle className="sr-only">搜尋知識圖譜與 研究歷史</DialogTitle>
      <div className="flex items-center gap-3 px-5 py-4">
        <Search size={18} className="shrink-0 text-muted-foreground" aria-hidden />
        <input ref={input} className="min-w-0 flex-1 bg-transparent text-base outline-none" role="combobox" aria-label="搜尋知識圖譜與 研究歷史"
          aria-expanded aria-controls="workspace-results" aria-activedescendant={active && keyOf(active)}
          placeholder="搜尋知識圖譜與 研究歷史" value={query} onChange={event => { setQuery(event.target.value); setSelected(""); }}
          onKeyDown={event => {
            if (!active || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") { event.preventDefault(); open(active); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const next = rows[(rows.indexOf(active) + rows.length + direction) % rows.length];
              setSelected(keyOf(next));
              document.getElementById(keyOf(next))?.scrollIntoView({ block: "nearest" });
            }
          }} />
        <button aria-label="關閉搜尋" className="rounded bg-muted px-2 text-xs text-muted-foreground" onClick={() => setIsOpen(false)}>esc</button>
      </div>
      <div className="flex gap-2 px-5 pb-3">{groups.map(group => <button key={group} aria-pressed={filter === group}
        className="rounded-full bg-muted px-3 py-1 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        onClick={() => { setFilter(filter === group ? null : group); setSelected(""); input.current?.focus(); }}>{group}</button>)}</div>
      <div id="workspace-results" role="listbox" aria-label="搜尋結果" aria-busy={!ready} className="min-h-28 overflow-y-auto px-2 pb-3">
        {sections.map(({ group, rows }) => rows.length > 0 && <div role="group" aria-label={group} key={group}>
          <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground">{group}</p>
          {rows.map(row => {
            const Icon = row.kind === "graph" ? Network : row.kind === "chat" ? MessageSquare : FileSearch;
            return <button key={keyOf(row)} id={keyOf(row)} type="button" role="option" tabIndex={-1} aria-selected={active === row}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left aria-selected:bg-muted"
              onMouseMove={() => setSelected(keyOf(row))} onClick={() => open(row)}>
              <Icon size={15} className="shrink-0 text-muted-foreground" aria-hidden /><span className="flex-1 truncate">{row.title}</span>
              <time dateTime={row.date} className="text-xs text-muted-foreground">{new Date(row.date).toLocaleDateString("zh-TW", { month: "short", day: "numeric" })}</time>
            </button>;
          })}
        </div>)}
      </div>
      {!rows.length && <p role="status" className="px-5 pb-5 text-sm text-muted-foreground">{!ready ? "搜尋中…" : response.failed ? "無法載入搜尋結果，請重新開啟搜尋。" : term ? "找不到符合的紀錄" : "尚無紀錄"}</p>}
      <footer className="flex gap-5 border-t bg-muted/50 px-5 py-2 text-xs text-muted-foreground"><span>↑↓ 選取</span><span>↵ 開啟</span><span className="ml-auto">esc 關閉</span></footer>
    </DialogContent>
  </Dialog>;
}
