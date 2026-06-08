"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { GraphNode } from "@/types/graph";

interface Props {
  nodes: GraphNode[];
  onNodeFocus: (nodeId: string) => void;
  onNodeSelect: (node: GraphNode) => void;
}

export default function SearchBox({ nodes, onNodeFocus, onNodeSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const results =
    query.trim().length > 0
      ? nodes
          .filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 20)
      : [];

  const handleSelect = useCallback(
    (node: GraphNode) => {
      onNodeFocus(node.id);
      onNodeSelect(node);
      setQuery(node.label);
      setOpen(false);
    },
    [onNodeFocus, onNodeSelect],
  );

  const clear = useCallback(() => {
    setQuery("");
    setOpen(false);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const TYPE_LABELS = { applicant: "申請人", patent: "專利", concept: "概念" };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 primary-foreground pointer-events-none"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋節點…"
          className="pl-8 pr-7 h-8 text-xs bg-accent border-border primary-foreground placeholder:primary-foreground focus-visible:ring-ring"
          aria-label="搜尋節點"
          autoComplete="off"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 primary-foreground hover:text-muted-foreground cursor-pointer"
            aria-label="清除搜尋"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg max-h-52 overflow-y-auto"
        >
          {results.map((node) => (
            <li
              key={node.id}
              role="option"
              aria-selected={false}
              onClick={() => handleSelect(node)}
              className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-accent transition-colors"
            >
              <span
                aria-hidden
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: node.color }}
              />
              <span className="text-muted-foreground flex-1 truncate">
                {node.label}
              </span>
              <span className="primary-foreground shrink-0">
                {TYPE_LABELS[node.type]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-background border border-border rounded-md px-3 py-2 text-xs primary-foreground">
          找不到「{query}」相關節點
        </div>
      )}
    </div>
  );
}
