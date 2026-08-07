"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import SearchBox from "./SearchBox";
import NodeInfo from "./NodeInfo";
import EdgeInfo from "./EdgeInfo";
import YearFilter from "./YearFilter";
import LayerToggle from "./LayerToggle";
import CommunityLegend from "./CommunityLegend";
import AIReport from "./AIReport";
import type { ColorMode, EdgeWeightMetric } from "@/lib/graph-view";
import type {
  GraphNode,
  GraphEdge,
  Community,
  NodeType,
  GraphMethodology,
  GraphMode,
} from "@/types/graph";

interface Props {
  nodes: GraphNode[];
  allNodes: GraphNode[];
  edges: GraphEdge[];
  communities: Community[];
  aiReport: string;
  yearRange: [number, number];
  fullYearRange: [number, number];
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  methodology: GraphMethodology;
  mode: GraphMode;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  edgeWeight: EdgeWeightMetric;
  onEdgeWeightChange: (metric: EdgeWeightMetric) => void;
  showSemantic: boolean;
  minSupport: number;
  maxSupport: number;
  visibleLayers: Set<NodeType>;
  hiddenCommunities: Set<number>;
  onYearChange: (range: [number, number]) => void;
  onLayerToggle: (type: NodeType) => void;
  onCommunityToggle: (id: number) => void;
  onNodeFocus: (nodeId: string) => void;
  onNodeSelect: (node: GraphNode | null) => void;
  onEdgeClose: () => void;
  onSemanticChange: (value: boolean) => void;
  onMinSupportChange: (value: number) => void;
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-2 group cursor-pointer">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export default function Sidebar({
  nodes,
  allNodes,
  edges,
  communities,
  aiReport,
  yearRange,
  fullYearRange,
  selectedNode,
  selectedEdge,
  methodology,
  mode,
  colorMode,
  onColorModeChange,
  edgeWeight,
  onEdgeWeightChange,
  showSemantic,
  minSupport,
  maxSupport,
  visibleLayers,
  hiddenCommunities,
  onYearChange,
  onLayerToggle,
  onCommunityToggle,
  onNodeFocus,
  onNodeSelect,
  onEdgeClose,
  onSemanticChange,
  onMinSupportChange,
}: Props) {
  return (
    <aside
      className="w-[300px] shrink-0 bg-background border-l border-border flex flex-col overflow-y-auto"
      aria-label="控制側邊欄"
    >
      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-0.5">
          {/* Search */}
          <div className="pb-3">
            <SearchBox
              nodes={nodes}
              onNodeFocus={onNodeFocus}
              onNodeSelect={(n) => onNodeSelect(n)}
            />
          </div>

          <Separator className="bg-border" />

          {/* Node Info */}
          <Section title="節點／關係資訊">
            {selectedEdge ? (
              <EdgeInfo
                edge={selectedEdge}
                nodes={allNodes}
                methodology={methodology}
                onClose={onEdgeClose}
              />
            ) : selectedNode ? (
              <NodeInfo
                node={selectedNode}
                edges={edges}
                nodes={nodes}
                communities={communities}
                onClose={() => onNodeSelect(null)}
                onNodeSelect={(n) => {
                  onNodeSelect(n);
                  onNodeFocus(n.id);
                }}
                onNodeFocus={onNodeFocus}
              />
            ) : (
              <p className="text-xs text-muted-foreground pb-1">
                點擊圖譜中的節點或線條以查看詳情
              </p>
            )}
          </Section>

          <Separator className="bg-border" />

          {/* Filters */}
          <Section title="篩選器">
            <div className="space-y-4">
              {mode === "context" ? (
                <>
              <div>
                <p className="text-xs text-foreground font-medium mb-2">年份範圍</p>
                <YearFilter
                  value={yearRange}
                  fullRange={fullYearRange}
                  onChange={onYearChange}
                />
              </div>
              <div>
                <p className="text-xs text-foreground font-medium mb-2">節點層</p>
                <LayerToggle
                  visibleLayers={visibleLayers}
                  onToggle={onLayerToggle}
                />
              </div>
                </>
              ) : mode === "institution" ? (
                <>
                  <label className="block text-xs text-foreground">
                    <span className="flex justify-between mb-2">
                      <span className="font-medium">最低共享概念數</span>
                      <span className="font-mono text-primary">{minSupport}</span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={Math.max(1, maxSupport)}
                      value={Math.min(minSupport, Math.max(1, maxSupport))}
                      onChange={(event) => onMinSupportChange(Number(event.target.value))}
                      className="w-full accent-primary"
                    />
                  </label>
                  <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                    邊＝兩家機構共同投入 ≥ 該數量的技術概念；調高以聚焦強連帶。
                  </p>
                  <div>
                    <p className="text-xs text-foreground font-medium mb-2">機構類型</p>
                    <ul className="space-y-1.5">
                      {communities.map((c) => (
                        <li key={c.name} className="flex items-center gap-2 text-xs">
                          <span
                            aria-hidden
                            className="size-2.5 rounded-full shrink-0"
                            style={{ background: c.color }}
                          />
                          <span className="text-muted-foreground">{c.name}</span>
                          <span className="ml-auto font-mono text-primary">{c.node_count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-foreground font-medium mb-2">
                      概念顏色
                    </p>
                    <div
                      className="inline-flex rounded-md border border-border bg-background p-0.5"
                      role="group"
                      aria-label="概念顏色模式"
                    >
                      {(
                        [
                          ["community", "社群色"],
                          ["community_applicants", "社群色（家）"],
                          ["first_year", "首次出現年"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onColorModeChange(value)}
                          aria-pressed={colorMode === value}
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            colorMode === value
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {colorMode === "first_year" && (
                      <p className="text-[0.65rem] text-muted-foreground mt-1.5 leading-relaxed">
                        顏色＝概念首次出現的申請年份（漸層由早至晚）；切換只影響顯示，不改變資料。
                      </p>
                    )}
                    {colorMode === "community_applicants" && (
                      <p className="text-[0.65rem] text-muted-foreground mt-1.5 leading-relaxed">
                        顏色＝「家」單位 Louvain 社群（同一機構跨篇碰過的概念聚類）；分區獨立於「篇」單位社群。
                      </p>
                    )}
                    <div className="mt-3">
                      <p className="text-xs text-foreground font-medium mb-2">
                        線寬指標
                      </p>
                      <div
                        className="inline-flex rounded-md border border-border bg-background p-0.5"
                        role="group"
                        aria-label="線寬指標"
                      >
                        {(
                          [
                            ["jaccard", "Jaccard"],
                            ["npmi", "NPMI"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => onEdgeWeightChange(value)}
                            aria-pressed={edgeWeight === value}
                            className={`rounded px-2 py-1 text-xs transition-colors ${
                              edgeWeight === value
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[0.65rem] text-muted-foreground mt-1.5 leading-relaxed">
                        線寬用有界指標（Jaccard 或 NPMI）；NPMI 在 p_ij=1 時不顯示。指標皆為全量計算，門檻只過濾顯示。
                      </p>
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showSemantic}
                      onChange={(event) => onSemanticChange(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      顯示 LLM 語意關係
                      <span className="block text-[0.65rem] text-muted-foreground mt-0.5">
                        虛線僅為模型判讀證據，不參與社群與排版
                      </span>
                    </span>
                  </label>
                  <label className="block text-xs text-foreground">
                    <span className="flex justify-between mb-2">
                      <span className="font-medium">最低共同專利數</span>
                      <span className="font-mono text-primary">{minSupport}</span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={Math.max(1, maxSupport)}
                      value={Math.min(minSupport, Math.max(1, maxSupport))}
                      onChange={(event) => onMinSupportChange(Number(event.target.value))}
                      className="w-full accent-primary"
                    />
                  </label>
                  <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                    概念統計涵蓋完整分析樣本；概念模式不套用年份篩選。
                  </p>
                </>
              )}
            </div>
          </Section>

          <Separator className="bg-border" />

          {/* Community Legend */}
          {mode === "concept" && communities.length > 0 && (
            <>
              <Section title="技術社群">
                <CommunityLegend
                  communities={communities}
                  hiddenCommunities={hiddenCommunities}
                  onToggle={onCommunityToggle}
                />
              </Section>
              <Separator className="bg-border" />
            </>
          )}

          {/* AI Report */}
          {aiReport && (
            <Section title="AI 趨勢報告" defaultOpen={false}>
              <AIReport html={aiReport} />
            </Section>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
