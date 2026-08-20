"use client";

import { Disc, RotateCcw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import type {
  KeywordSubgraphHops,
  SubgraphHops,
  SubgraphState,
} from "@/lib/graph-subgraph";

interface Props {
  state: SubgraphState;
  onKeywordHopsChange: (hops: KeywordSubgraphHops) => void;
  onNodeHopsChange: (hops: SubgraphHops) => void;
  onExit: () => void;
  nodeCount: number;
  edgeCount: number;
}

export default function SubgraphBanner({
  state,
  onKeywordHopsChange,
  onNodeHopsChange,
  onExit,
  nodeCount,
  edgeCount,
}: Props) {
  const isKeyword = state.kind === "keyword";

  return (
    <aside
      aria-label="關鍵字主題圖譜控制列"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex max-w-[min(92vw,44rem)] flex-wrap items-center justify-between gap-2.5 rounded-lg border border-primary/30 bg-background/95 px-3.5 py-2 text-xs shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary shrink-0">
          {isKeyword ? (
            <Sparkles className="size-3.5 text-primary" aria-hidden />
          ) : (
            <Disc className="size-3.5 text-primary" aria-hidden />
          )}
        </span>
        <span className="text-muted-foreground shrink-0 font-medium">
          {isKeyword ? "關鍵字主題圖譜：" : "單一技術子圖："}
        </span>
        <Badge
          variant="secondary"
          className="max-w-[14rem] truncate font-semibold text-foreground px-2 py-0.5"
          title={isKeyword ? state.query : state.centerNodeLabel}
        >
          {isKeyword ? `「${state.query}」` : state.centerNodeLabel}
        </Badge>
        <span className="text-[0.7rem] text-muted-foreground whitespace-nowrap">
          （{nodeCount} 個概念 · {edgeCount} 條關聯
          {isKeyword && state.matchedCount > 0
            ? ` · 含 ${state.matchedCount} 個相符詞`
            : ""}
          ）
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.7rem] text-muted-foreground mr-0.5 font-medium">
            探索範圍:
          </span>
          {isKeyword ? (
            <ButtonGroup>
              <Button
                variant={state.hops === 0 ? "default" : "outline"}
                size="xs"
                onClick={() => onKeywordHopsChange(0)}
                className="h-6 px-2 text-[0.7rem] cursor-pointer"
                title="只顯示包含此關鍵字的概念及彼此間的關聯"
              >
                僅相符概念
              </Button>
              <Button
                variant={state.hops === 1 ? "default" : "outline"}
                size="xs"
                onClick={() => onKeywordHopsChange(1)}
                className="h-6 px-2 text-[0.7rem] cursor-pointer"
                title="包含所有相符概念，以及直接共現的周邊相關技術（推薦）"
              >
                直接相關 (推薦)
              </Button>
              <Button
                variant={state.hops === 2 ? "default" : "outline"}
                size="xs"
                onClick={() => onKeywordHopsChange(2)}
                className="h-6 px-2 text-[0.7rem] cursor-pointer"
                title="向外探索 2 層相關技術脈絡"
              >
                廣泛探索
              </Button>
            </ButtonGroup>
          ) : (
            <ButtonGroup>
              <Button
                variant={state.hops === 1 ? "default" : "outline"}
                size="xs"
                onClick={() => onNodeHopsChange(1)}
                className="h-6 px-2 text-[0.7rem] cursor-pointer"
                title="只顯示與此概念直接相連的核心技術"
              >
                直接相關
              </Button>
              <Button
                variant={state.hops === 2 ? "default" : "outline"}
                size="xs"
                onClick={() => onNodeHopsChange(2)}
                className="h-6 px-2 text-[0.7rem] cursor-pointer"
                title="包含直接技術再向外延伸的應用脈絡（推薦）"
              >
                延伸技術 (推薦)
              </Button>
              <Button
                variant={state.hops === 3 ? "default" : "outline"}
                size="xs"
                onClick={() => onNodeHopsChange(3)}
                className="h-6 px-2 text-[0.7rem] cursor-pointer"
                title="向外探索 3 層，發掘跨領域潛在技術關聯"
              >
                廣泛探索
              </Button>
            </ButtonGroup>
          )}
        </div>

        <Button
          variant="ghost"
          size="xs"
          onClick={onExit}
          className="h-6 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
          title="退出主題圖譜，返回完整圖譜"
        >
          <RotateCcw className="size-3" />
          返回完整圖譜
        </Button>
      </div>
    </aside>
  );
}
