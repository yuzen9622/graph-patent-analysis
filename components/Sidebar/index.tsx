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
import type { ColorMode, EdgeWeightMetric, Unit, ApplicantAvailability } from "@/lib/graph-view";
import { SOURCE_FILE_COLORS } from "@/lib/graph-view";
import type { IpcLevel, IpcTreeNode } from "@/lib/ipc-filter";
import IpcTree from "./IpcTree";
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
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
  /** P9: 家單位資料可用性（stored／rebuildable／none）。'none' 時停用「家」切換。 */
  applicantAvailability: ApplicantAvailability;
  /** PRD v2 / P2: 可選的來源檔清單與須選取。 */
  allSourceFiles: string[];
  sourceFiles: string[];
  onSourceFilesChange: (files: string[]) => void;
  /** PRD v2 / P5: IPC 層級與篩選（樹狀多選，S8）。 */
  ipcLevel: IpcLevel;
  onIpcLevelChange: (level: IpcLevel) => void;
  ipcFilter: string[];
  onIpcFilterChange: (keys: string[]) => void;
  ipcTree: IpcTreeNode[];
  hasIpcData: boolean;
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
  unit,
  onUnitChange,
  applicantAvailability,
  allSourceFiles,
  sourceFiles,
  onSourceFilesChange,
  ipcLevel,
  onIpcLevelChange,
  ipcFilter,
  onIpcFilterChange,
  ipcTree,
  hasIpcData,
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
                    <p className="text-xs text-foreground font-medium mb-2">年份範圍</p>
                    <YearFilter
                      value={yearRange}
                      fullRange={fullYearRange}
                      onChange={onYearChange}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-foreground font-medium mb-2">
                      分析單位
                    </p>
                    <div
                      className="inline-flex rounded-md border border-border bg-background p-0.5"
                      role="group"
                      aria-label="分析單位"
                    >
                      {(
                        [
                          ["patent", "篇（專利）"],
                          ["applicant", "家（機構）"],
                        ] as const
                      ).map(([value, label]) => {
                        const disabled = value === "applicant" && applicantAvailability === "none";
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => onUnitChange(value)}
                            disabled={disabled}
                            aria-pressed={unit === value}
                            title={
                              disabled
                                ? "此分析未含機構資料，無法使用「家（機構）」單位"
                                : undefined
                            }
                            className={`rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              unit === value
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[0.65rem] text-muted-foreground mt-1.5 leading-relaxed">
                      {applicantAvailability === "none"
                        ? "此分析未含機構資料，無法使用「家（機構）」單位；請重新執行分析。"
                        : unit === "applicant"
                          ? "門檻/大小/線寬改以「機構家數」計；同一機構跨篇碰過兩概念也算共同投入。" +
                            (applicantAvailability === "rebuildable"
                              ? "（此分析為舊格式，「家」計量由專利—機構結構重建）"
                              : "")
                          : "門檻/大小/線寬以「專利篇數」計。"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground font-medium mb-2">
                      概念顏色
                    </p>
                    <div
                      className="inline-flex rounded-md border border-border bg-background p-0.5"
                      role="group"
                      aria-label="概念顏色模式"
                    >
                      {( [
                        ["community", "社群色"],
                          ["community_applicants", "社群色（家）"],
                          ["first_year", "首次出現年"],
                          ...(allSourceFiles.length > 1
                            ? ([["source", "依來源檔"]] as const)
                            : []),
                          ...(hasIpcData ? ([["ipc", "依 IPC"]] as const) : []),
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
                        顏色＝「家」單位 Louvain 社群（同一機構跨篇碰過的概念對分）；分區獨立於「篇」單位社群。
                      </p>
                    )}
                    {colorMode === "source" && (
                      <p className="text-[0.65rem] text-muted-foreground mt-1.5 leading-relaxed">
                        顏色＝該概念在哪幾個來源檔出現；單獨一文用該檔本色，跨多檔概念用灰紫共享色。<br/>只著色不篩選——想只看某檔再往下「來源檔篩選」。
                      </p>
                    )}
                    {colorMode === "ipc" && (
                      <p className="text-[0.65rem] text-muted-foreground mt-1.5 leading-relaxed">
                        顏色＝概念優勢 IPC（L{ipcLevel}）：該概念的多數專利落在哪個分類。IPC 篩選請見下方「IPC 分類篩選」。
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
                  <div>
                    <p className="text-xs text-foreground font-medium mb-2">
                      來源檔案篩選
                    </p>
                    {allSourceFiles.length <= 1 ? (
                      <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                        此分析只有一個來源檔；多檔上傳後可用來源檔篩選做「比對」。
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1.5">
                          {allSourceFiles.map((file, i) => {
                            const active = sourceFiles.includes(file);
                            return (
                              <label
                                key={file}
                                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                                  active
                                    ? "border-primary bg-primary/5"
                                    : "border-border bg-background"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={active}
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? [...sourceFiles, file]
                                      : sourceFiles.filter((f) => f !== file);
                                    onSourceFilesChange(next);
                                  }}
                                  className="mt-0.5"
                                />
                                <span className="inline-flex items-center gap-1.5 min-w-0">
                                  <span
                                    aria-hidden
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{
                                      background:
                                        SOURCE_FILE_COLORS[i % SOURCE_FILE_COLORS.length],
                                    }}
                                  />
                                  <span className="truncate">{file}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSourceFilesChange([])}
                            aria-pressed={sourceFiles.length === 0}
                            className="rounded border border-border px-2 py-1 text-[0.65rem] text-muted-foreground hover:bg-accent"
                          >
                            全部來源
                          </button>
                          <p className="text-[0.65rem] text-muted-foreground self-center">
                            {sourceFiles.length === 0
                              ? "未篩選（顯示全圖）"
                              : `篩選 ${sourceFiles.length} 個檔（任一來源命中即保留）`}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                  {hasIpcData && (
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-foreground font-medium mb-2">IPC 層級</p>
                        <span className="font-mono text-primary">L{ipcLevel}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={ipcLevel}
                        onChange={(event) =>
                          onIpcLevelChange(Number(event.target.value) as IpcLevel)
                        }
                        className="w-full accent-primary"
                        aria-label="IPC 層級"
                      />
                      <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                        {ipcLevel} 級（{["L1 部", "L2 類", "L3 次類", "L4 主類", "L5 次目"][ipcLevel - 1]}）。<br/>切換層級會清空 IPC 篩選。
                      </p>
                      <p className="mt-3 text-xs text-foreground font-medium mb-1.5">IPC 分類篩選</p>
                      <IpcTree
                        nodes={ipcTree}
                        level={ipcLevel}
                        selected={ipcFilter}
                        onToggle={(key) =>
                          onIpcFilterChange(
                            ipcFilter.includes(key)
                              ? ipcFilter.filter((k) => k !== key)
                              : [...ipcFilter, key],
                          )
                        }
                      />
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => onIpcFilterChange([])}
                          className="rounded border border-border px-2 py-1 text-[0.65rem] text-muted-foreground hover:bg-accent"
                        >
                          全部 IPC
                        </button>
                        <p className="text-[0.65rem] text-muted-foreground self-center">
                          {ipcFilter.length === 0
                            ? "未篩選（顯示全圖）"
                            : `篩選 ${ipcFilter.length} 個 IPC（任一命中即保留）`}
                        </p>
                      </div>
                    </div>
                  )}
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
                      <span className="font-medium">
                        {unit === "applicant" ? "最低共同家數" : "最低共同專利數"}
                      </span>
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
                    概念統計與關係指標由選定的年份／來源檔／IPC 子集重新計算；門檻只過濾顯示。
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
