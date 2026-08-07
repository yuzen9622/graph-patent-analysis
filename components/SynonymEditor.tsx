"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// PRD v2 / P1 同義詞編輯器。
// 編輯全域同義詞詞典；每次跑分析時把當下詞典「快照」進該分析（不可變），
// 所以這裡的編輯永遠不會改動過去已完成的圖。

export interface SynonymGroup {
  id: string;
  canonical: string;
  aliases: string[];
  note?: string;
}

interface ApiResult {
  groups: SynonymGroup[];
  warnings: string[];
}

interface EditorRow {
  key: number;
  id?: string;                 // existing group id, or undefined for a new row
  canonical: string;
  aliases: string;              // comma/space separated for the input field
  note: string;
  saved: boolean;               // existing-from-server vs. brand new
}

let rowSeq = 1;

function groupToRow(group: SynonymGroup): EditorRow {
  return {
    key: rowSeq++,
    id: group.id,
    canonical: group.canonical,
    aliases: group.aliases.join(", "),
    note: group.note ?? "",
    saved: true,
  };
}

function parseAliases(raw: string): string[] {
  return raw
    .split(/[,，、;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SynonymEditor() {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");

  const update = useCallback((key: number, patch: Partial<EditorRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const replaceRows = useCallback((next: ApiResult) => {
    setRows(next.groups.map(groupToRow));
    setWarnings(next.warnings ?? []);
  }, []);

  const fetchAll = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/synonyms", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "讀取失敗");
      replaceRows((await res.json()) as ApiResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    }
  }, [replaceRows]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  async function saveRow(key: number) {
    setError("");
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    if (!row.canonical.trim()) {
      setError("canonical（代表標籤）不能為空");
      return;
    }
    try {
      const res = await fetch("/api/synonyms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id ?? null,
          canonical: row.canonical.trim(),
          aliases: parseAliases(row.aliases),
          note: row.note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "儲存失敗");
      }
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    }
  }

  async function deleteRow(key: number) {
    setError("");
    const row = rows.find((r) => r.key === key);
    if (!row?.id) {
      setRows((prev) => prev.filter((r) => r.key !== key));
      return;
    }
    try {
      const res = await fetch(`/api/synonyms?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "刪除失敗");
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除失敗");
    }
  }

  function addRow() {
    const key = rowSeq++;
    setRows((prev) => [
      ...prev,
      { key, id: undefined, canonical: "", aliases: "", note: "", saved: false },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          合併規則套用在共現計算的輸入層——把「AI」「人工智能」都歸到「人工智慧」。
          每次分析落庫當下的快照，所以日後編輯不會改寫舊分析。
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAll} type="button">
            <RefreshCw size={14} className="mr-1.5" aria-hidden />
            重新整理
          </Button>
          <Button size="sm" onClick={addRow} type="button">
            <Plus size={14} className="mr-1.5" aria-hidden />
            新增同義詞群組
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert>
          <AlertTitle className="mb-1">詞典衝突</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            尚無同義詞群組。先新增一組，例如「人工智慧 ↔ AI」。
          </p>
        )}
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
          >
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`canonical-${row.key}`}>代表標籤 (canonical)</Label>
                <Input
                  id={`canonical-${row.key}`}
                  value={row.canonical}
                  onChange={(e) => update(row.key, { canonical: e.target.value })}
                  placeholder="人工智慧"
                  className="sm:min-w-40"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={`aliases-${row.key}`}>同義詞（逗號或空格分隔）</Label>
                <Input
                  id={`aliases-${row.key}`}
                  value={row.aliases}
                  onChange={(e) => update(row.key, { aliases: e.target.value })}
                  placeholder="AI, 人工智能"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:w-44">
                <Label htmlFor={`note-${row.key}`}>備註</Label>
                <Input
                  id={`note-${row.key}`}
                  value={row.note}
                  onChange={(e) => update(row.key, { note: e.target.value })}
                  placeholder="選填"
                />
              </div>
              <div className="flex gap-1.5">
                <Button size="icon" variant="default" onClick={() => saveRow(row.key)} aria-label="儲存">
                  <Check size={15} />
                </Button>
                <Button size="icon" variant="outline" onClick={() => deleteRow(row.key)} aria-label="刪除">
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}