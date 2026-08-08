"use client";

import type { IpcLevel, IpcTreeNode } from "@/lib/ipc-filter";

interface Props {
  nodes: IpcTreeNode[];
  /** 目前層級：等於此層的節點才是可勾選的葉。 */
  level: IpcLevel;
  selected: string[];
  onToggle: (key: string) => void;
}

/**
 * PRD v2 / P5 (S8): IPC 階層樹的多選清單。父層節點只是導覽（顯示該 key 的
 * 專利數），只有「目前層級」的葉可以勾選；命中任一即納入（OR，S2）。
 * 全部展開（不折疊）——IPC 樹深度 ≤5，樣本資料規模下可讀。
 */
export default function IpcTree({ nodes, level, selected, onToggle }: Props) {
  return (
    <ul className="space-y-0.5 text-xs">
      {nodes.map((node) => (
        <IpcNode key={node.key} node={node} level={level} selected={selected} onToggle={onToggle} />
      ))}
    </ul>
  );
}

function IpcNode({
  node,
  level,
  selected,
  onToggle,
}: {
  node: IpcTreeNode;
  level: IpcLevel;
  selected: string[];
  onToggle: (key: string) => void;
}) {
  if (node.level === level) {
    const checked = selected.includes(node.key);
    return (
      <li className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/60">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(node.key)}
          aria-label={`IPC ${node.key}`}
          className="shrink-0"
        />
        <span className="font-mono text-foreground">{node.key}</span>
        <span className="ml-auto font-mono text-muted-foreground">{node.count}</span>
      </li>
    );
  }
  return (
    <li>
      <p className="flex items-center gap-1.5 px-1 py-0.5 text-muted-foreground">
        <span className="font-mono text-foreground/80 font-medium">{node.key}</span>
        <span className="ml-auto font-mono">{node.count}</span>
      </p>
      <ul className="ml-3 border-l border-border/60 pl-2 space-y-0.5">
        {node.children.map((child) => (
          <IpcNode key={child.key} node={child} level={level} selected={selected} onToggle={onToggle} />
        ))}
      </ul>
    </li>
  );
}
