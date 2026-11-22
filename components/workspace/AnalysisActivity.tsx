"use client";

import { TodoList, type TodoItem } from "@/components/agents/todo-list";
import { AgentActivity } from "@/components/agents/agent-activity";

interface Props {
  status: "running" | "done" | "cancelled" | "error";
  done: number;
  total: number;
  batches: Array<{ batchIndex: number; titles: string[] }>;
}

export function AnalysisActivity({ status, done, total, batches }: Props) {
  const stopped = status === "cancelled" || status === "error";
  const extracted = status === "done" || (total > 0 && done >= total);
  const items: TodoItem[] = [
    { id: "extract", title: "擷取專利內容", status: extracted ? "completed" : stopped ? "cancelled" : "in-progress", detail: total > 0 ? `${done} / ${total} 筆` : "等待伺服器回報進度" },
    { id: "result", title: "整理圖譜與分析報告", status: status === "done" ? "completed" : stopped ? "cancelled" : extracted ? "in-progress" : "pending" },
  ];
  return (
    <div className="space-y-6">
      <TodoList items={items} title="分析步驟" collapseOnComplete={false} labels={{ label: "分析步驟", progress: "已完成 {completed} / {total} 個步驟", pending: "等待中", inProgress: "處理中", completed: "已完成", cancelled: "已停止", empty: "尚無步驟" }} />
      {batches.length > 0 && <AgentActivity
        items={batches.map((entry, index) => ({ id: `${entry.batchIndex}-${index}`, type: "step" as const, label: entry.titles[0], status: "complete" as const, meta: `批次 ${entry.batchIndex + 1} · ${entry.titles.length} 筆` }))}
        status={status === "running" ? "working" : "complete"}
        activeLabel="專利處理紀錄"
        summary={`已回報 ${batches.length} 個批次`}
        collapseOnComplete={false}
      />}
    </div>
  );
}
