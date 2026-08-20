"use client";

import { Disc, Layers, RotateCcw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import type { SubgraphHops } from "@/lib/graph-subgraph";

interface Props {
  centerNodeLabel: string;
  hops: SubgraphHops;
  onHopsChange: (hops: SubgraphHops) => void;
  onExit: () => void;
  nodeCount: number;
  edgeCount: number;
}

export default function SubgraphBanner({
  centerNodeLabel,
  hops,
  onHopsChange,
  onExit,
  nodeCount,
  edgeCount,
}: Props) {
  return (
    <aside
      aria-label="關鍵字聚焦子圖控制列"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex max-w-[min(90vw,36rem)] flex-wrap items-center justify-between gap-2.5 rounded-lg border border-primary/30 bg-background/95 px-3.5 py-2 text-xs shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary shrink-0">
          <Disc className="size-3.5" aria-hidden />
        </span>
        <span className="text-muted-foreground shrink-0 font-medium">
          關鍵字技術圖譜：
        </span>
        <Badge
          variant="secondary"
          className="max-w-[12rem] truncate font-semibold text-foreground px-2 py-0.5"
          title={centerNodeLabel}
        >
          {centerNodeLabel}
        </Badge>
        <span className="text-[0.7rem] text-muted-foreground whitespace-nowrap">
          （{nodeCount} 個概念 · {edgeCount} 條關聯）
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.7rem] text-muted-foreground mr-0.5 font-medium">
            探索範圍:
          </span>
          <ButtonGroup>
            <Button
              variant={hops === 1 ? "default" : "outline"}
              size="xs"
              onClick={() => onHopsChange(1)}
              className="h-6 px-2 text-[0.7rem] cursor-pointer"
              title="只顯示與此關鍵字直接相連的核心技術（第 1 層）"
            >
              直接相關
            </Button>
            <Button
              variant={hops === 2 ? "default" : "outline"}
              size="xs"
              onClick={() => onHopsChange(2)}
              className="h-6 px-2 text-[0.7rem] cursor-pointer"
              title="包含直接技術再向外延伸的應用脈絡（第 2 層，建議）"
            >
              延伸技術
            </Button>
            <Button
              variant={hops === 3 ? "default" : "outline"}
              size="xs"
              onClick={() => onHopsChange(3)}
              className="h-6 px-2 text-[0.7rem] cursor-pointer"
              title="向外探索 3 層，發掘跨領域潛在技術關聯"
            >
              廣泛探索
            </Button>
          </ButtonGroup>
        </div>

        <Button
          variant="ghost"
          size="xs"
          onClick={onExit}
          className="h-6 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
          title="退出局部子圖，返回完整圖譜"
        >
          <RotateCcw className="size-3" />
          返回完整圖譜
        </Button>
      </div>
    </aside>
  );
}
