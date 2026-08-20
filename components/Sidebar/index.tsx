"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Network,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tags,
} from "lucide-react";
import { useState, useMemo } from "react";
import SearchBox from "./SearchBox";
import NodeInfo from "./NodeInfo";
import EdgeInfo from "./EdgeInfo";
import YearFilter from "./YearFilter";
import LayerToggle from "./LayerToggle";
import CommunityLegend from "./CommunityLegend";
import AIReport from "./AIReport";
import SourceFileChecklist from "./SourceFileChecklist";
import type { ColorMode, Unit, ApplicantAvailability } from "@/lib/graph-view";
import type { IpcLevel, IpcTreeNode } from "@/lib/ipc-filter";
import IpcTree from "./IpcTree";
import type { CompareCount } from "@/lib/graph-compare";
import type {
  GraphNode,
  GraphEdge,
  Community,
  NodeType,
  GraphMethodology,
  GraphMode,
} from "@/types/graph";

interface Props {
  /** 左側主檢視的節點；僅供固定搜尋列使用。 */
  nodes: GraphNode[];
  /** 主檢視社群；供下方社群圖例使用。 */
  communities: Community[];
  /** 每次實際選取遞增，強制 inspector 重置為預設展開／收合狀態。 */
  inspectionKey: string;
  /** 目前 inspector 所屬檢視的資料，與搜尋資料刻意分開。 */
  inspectionNodes: GraphNode[];
  inspectionEdges: GraphEdge[];
  /** 完整節點資料僅供關係中的專利 ID 解析；不影響相鄰節點計算。 */
  inspectionLookupNodes: GraphNode[];
  inspectionCommunities: Community[];
  aiReport: string;
  yearRange: [number, number];
  fullYearRange: [number, number];
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  methodology: GraphMethodology;
  mode: GraphMode;
  /** 脈絡圖「兩檔共享概念」統計（2026-08-09）；非脈絡圖或無兩檔可比較時為 null。 */
  sharedConceptCount: CompareCount | null;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  unit: Unit;
  onUnitChange: (unit: Unit) => void;
  /** P9: 家單位資料可用性（stored／rebuildable／none）。'none' 時停用「家」切換。 */
  applicantAvailability: ApplicantAvailability;
  /** PRD v2 / P2: 可選的來源檔清單與須選取。 */
  allSourceFiles: string[];
  sourceFiles: string[];
  onSourceFilesChange: (files: string[]) => void;
  /** 比較模式：右圖獨立的來源檔選取；左圖沿用上面的 sourceFiles。 */
  compareMode: boolean;
  sourceFilesRight: string[];
  onSourceFilesRightChange: (files: string[]) => void;
  /** 比較模式中面板 3+ 的非空範圍數（供篩選計數）。 */
  extraPanelCount: number;
  /** PRD v2 / P5: IPC 層級與篩選（樹狀多選，S8）。 */
  ipcLevel: IpcLevel;
  onIpcLevelChange: (level: IpcLevel) => void;
  ipcFilter: string[];
  onIpcFilterChange: (keys: string[]) => void;
  ipcTree: IpcTreeNode[];
  hasIpcData: boolean;
  ipcLegend?: Array<{ key: string; color: string; count: number }>;
  minSupport: number;
  maxSupport: number;
  visibleLayers: Set<NodeType>;
  hiddenCommunities: Set<number>;
  onYearChange: (range: [number, number]) => void;
  onLayerToggle: (type: NodeType) => void;
  onCommunityToggle: (id: number) => void;
  onNodeFocus: (nodeId: string) => void;
  /** 固定搜尋列的選取，一律指向左側主檢視。 */
  onSearchNodeSelect: (node: GraphNode) => void;
  /** inspector 內相鄰節點的選取，保留目前 inspector 的來源。 */
  onInspectorNodeSelect: (node: GraphNode) => void;
  onInspectorClose: () => void;
  onMinSupportChange: (value: number) => void;
  /** 重設所有篩選條件（年份／來源檔／IPC／門檻／圖層／社群／引用線）。 */
  onResetFilters: () => void;
  /** P6 獨立的引用虛線證據圖層（僅概念模式）。 */
  showCitations: boolean;
  onCitationsChange: (value: boolean) => void;
}

interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  /** 顯示在標題右側的計數徽章（例如隱藏中的社群數）。 */
  count?: number;
  /** 此區有作用中的設定／篩選時顯示警示點。 */
  active?: boolean;
  /** Accordion 的唯一識別值；由外層 defaultValue 決定初始展開。 */
  value: string;
  /** 傳給 AccordionItem 根元素（例如 flex 容器內的 flex-1）。 */
  className?: string;
  /** 顯示在收合標題列右側的獨立操作，不會縮窄收合內容。 */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

function Section({
  title,
  icon,
  count,
  active,
  value,
  className,
  headerAction,
  children,
}: SectionProps) {
  return (
    <AccordionItem value={value} className={cn("w-full", className)}>
      <div className="flex justify-between gap-1 flex-1">
        <AccordionTrigger className="min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-xs font-semibold tracking-wide hover:no-underline  cursor-pointer">
          {icon && (
            <span className="text-muted-foreground shrink-0" aria-hidden>
              {icon}
            </span>
          )}
          <span className="text-xs font-semibold text-foreground tracking-wide flex-1">
            {title}
          </span>
          {active && (
            <span
              className="size-1.5 rounded-full bg-warning shrink-0"
              title="此區有作用中的設定"
              aria-label="此區有作用中的設定"
            />
          )}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-primary/10 text-primary font-mono text-[0.7rem] leading-none px-1.5 py-1 shrink-0 tabular-nums">
              {count}
            </span>
          )}
        </AccordionTrigger>
        {headerAction}
      </div>
      <AccordionContent className="px-3 pb-3">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** 目前的篩選條件有幾項生效（供標題計數與重設按鈕用）。 */
interface InspectorProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  inspectionNodes: GraphNode[];
  inspectionEdges: GraphEdge[];
  inspectionLookupNodes: GraphNode[];
  inspectionCommunities: Community[];
  methodology: GraphMethodology;
  onClose: () => void;
  onNodeSelect: (node: GraphNode) => void;
  onNodeFocus: (nodeId: string) => void;
}

/** 底部獨立 inspector：新選取時由呼叫端 key remount，預設展開且內容獨立捲動。 */
function Inspector({
  selectedNode,
  selectedEdge,
  inspectionNodes,
  inspectionEdges,
  inspectionLookupNodes,
  inspectionCommunities,
  methodology,
  onClose,
  onNodeSelect,
  onNodeFocus,
}: InspectorProps) {
  const [open, setOpen] = useState(true);
  const title = selectedEdge ? "關係資訊" : "節點資訊";

  return (
    <section
      className="shrink-0 border-t border-border bg-background"
      aria-label="節點與關係詳細資訊"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          aria-label={`${open ? "收合" : "展開"}${title}`}
          className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <Network
            size={13}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="flex-1 text-xs font-semibold tracking-wide text-foreground">
            {title}
          </span>
          <span className="text-[0.7rem] text-muted-foreground group-data-[panel-open]:hidden">
            展開
          </span>
          <ChevronDown
            size={13}
            className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea
            className="max-h-[40svh] border-t border-border"
            aria-label={`${title}內容`}
          >
            <div className="p-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                {selectedEdge ? (
                  <EdgeInfo
                    edge={selectedEdge}
                    nodes={inspectionLookupNodes}
                    methodology={methodology}
                    onClose={onClose}
                  />
                ) : selectedNode ? (
                  <NodeInfo
                    node={selectedNode}
                    edges={inspectionEdges}
                    nodes={inspectionNodes}
                    communities={inspectionCommunities}
                    onClose={onClose}
                    onNodeSelect={onNodeSelect}
                    onNodeFocus={onNodeFocus}
                  />
                ) : null}
              </div>
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/** IPC 層級 slider ＋ 樹狀多選篩選（P5 S8；2026-08-09 起概念與脈絡圖共用）。 */
function IpcFilterSection({
  ipcLevel,
  onIpcLevelChange,
  ipcFilter,
  onIpcFilterChange,
  ipcTree,
  colorByKey,
}: {
  ipcLevel: IpcLevel;
  onIpcLevelChange: (level: IpcLevel) => void;
  ipcFilter: string[];
  onIpcFilterChange: (keys: string[]) => void;
  ipcTree: IpcTreeNode[];
  colorByKey?: Map<string, string>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-foreground font-medium mb-2">IPC 層級</p>
        <span className="font-mono text-primary tabular-nums">L{ipcLevel}</span>
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
      <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
        {ipcLevel} 級（
        {["L1 部", "L2 類", "L3 次類", "L4 主類", "L5 次目"][ipcLevel - 1]}）。
        <br />
        切換層級會清空 IPC 篩選。
      </p>
      <p className="mt-3 text-xs text-foreground font-medium mb-1.5">
        IPC 分類篩選
      </p>
      <IpcTree
        nodes={ipcTree}
        level={ipcLevel}
        selected={ipcFilter}
        colorByKey={colorByKey}
        onToggle={(key) =>
          onIpcFilterChange(
            ipcFilter.includes(key)
              ? ipcFilter.filter((k) => k !== key)
              : [...ipcFilter, key],
          )
        }
      />
      <div className="mt-2 flex gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onIpcFilterChange([])}
          className="h-auto rounded px-2 py-1 text-[0.7rem] text-muted-foreground hover:bg-accent"
        >
          全部 IPC
        </Button>
        <p className="text-[0.7rem] text-muted-foreground self-center">
          {ipcFilter.length === 0
            ? "未篩選（顯示全圖）"
            : `篩選 ${ipcFilter.length} 個 IPC（任一命中即保留）`}
        </p>
      </div>
    </div>
  );
}

/** 最低支持度 slider（概念視圖與脈絡圖共用；2026-08-09）。 */
function MinSupportControl({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs text-foreground">
      <span className="flex justify-between mb-2">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-primary tabular-nums">{value}</span>
      </span>
      <input
        type="range"
        min={1}
        max={Math.max(1, max)}
        value={Math.min(value, Math.max(1, max))}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}

function countActiveFilters(props: {
  mode: GraphMode;
  yearRange: [number, number];
  fullYearRange: [number, number];
  sourceFiles: string[];
  sourceFilesRight: string[];
  compareMode: boolean;
  extraPanelCount: number;
  ipcFilter: string[];
  minSupport: number;
  showCitations: boolean;
  visibleLayers: Set<NodeType>;
  hiddenCommunities: Set<number>;
}): number {
  let n = 0;
  if (
    props.yearRange[0] !== props.fullYearRange[0] ||
    props.yearRange[1] !== props.fullYearRange[1]
  )
    n++;
  if (props.mode === "concept" || props.mode === "institution") {
    if (props.sourceFiles.length > 0) n++;
    if (props.compareMode && props.sourceFilesRight.length > 0) n++;
    if (props.compareMode && props.extraPanelCount > 0) n++;
    if (props.ipcFilter.length > 0) n++;
    if (props.minSupport > 1) n++;
  }
  if (props.mode === "concept") {
    if (props.showCitations) n++;
    if (props.hiddenCommunities.size > 0) n++;
  }
  if (props.mode === "context" || props.mode === "concept") {
    if (props.visibleLayers.size < 3) n++;
  }
  return n;
}

export default function Sidebar({
  nodes,
  communities,
  inspectionKey,
  inspectionNodes,
  inspectionEdges,
  inspectionLookupNodes,
  inspectionCommunities,
  aiReport,
  yearRange,
  fullYearRange,
  selectedNode,
  selectedEdge,
  methodology,
  mode,
  sharedConceptCount,
  colorMode,
  onColorModeChange,
  unit,
  onUnitChange,
  applicantAvailability,
  allSourceFiles,
  sourceFiles,
  onSourceFilesChange,
  compareMode,
  sourceFilesRight,
  onSourceFilesRightChange,
  extraPanelCount,
  ipcLevel,
  onIpcLevelChange,
  ipcFilter,
  onIpcFilterChange,
  ipcTree,
  hasIpcData,
  ipcLegend,
  minSupport,
  maxSupport,
  visibleLayers,
  hiddenCommunities,
  onYearChange,
  onLayerToggle,
  onCommunityToggle,
  onNodeFocus,
  onSearchNodeSelect,
  onInspectorNodeSelect,
  onInspectorClose,
  onMinSupportChange,
  onResetFilters,
  showCitations,
  onCitationsChange,
}: Props) {
  const colorByKey = useMemo(
    () => new Map(ipcLegend?.map((item) => [item.key, item.color]) ?? []),
    [ipcLegend],
  );

  const activeFilterCount = countActiveFilters({
    mode,
    yearRange,
    fullYearRange,
    sourceFiles,
    sourceFilesRight,
    compareMode,
    extraPanelCount,
    ipcFilter,
    minSupport,
    showCitations,
    visibleLayers,
    hiddenCommunities,
  });

  return (
    <aside
      className="w-[300px] shrink-0 bg-background border-l border-border flex flex-col overflow-hidden"
      aria-label="控制側邊欄"
    >
      {/* 常駐搜尋列：捲動時仍可使用 */}
      <div className="shrink-0 border-b border-border bg-background px-3 py-2.5">
        <SearchBox
          nodes={nodes}
          onNodeFocus={onNodeFocus}
          onNodeSelect={onSearchNodeSelect}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="pt-2 space-y-0.5 pb-4">
          <Accordion multiple defaultValue={["filters", "communities"]}>
            {/* ── 篩選器 ── */}
            <Section
              className="w-full"
              value="filters"
              title="篩選器"
              icon={<SlidersHorizontal size={13} />}
              count={activeFilterCount}
              active={activeFilterCount > 0}
              headerAction={
                activeFilterCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={onResetFilters}
                    title="重設年份、來源檔、IPC、門檻、圖層、社群與引用線等所有篩選"
                    className="h-auto shrink-0 rounded-md px-1.5 py-1.5 text-[0.7rem] text-primary hover:bg-primary/10 hover:text-primary cursor-pointer"
                  >
                    <RotateCcw size={11} />
                    重設
                  </Button>
                ) : undefined
              }
            >
              <div className="space-y-4">
                {mode === "context" ? (
                  <>
                    {sharedConceptCount && (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                        <p className="text-xs text-foreground font-medium mb-1.5">
                          兩檔共享概念
                        </p>
                        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
                          <dt className="text-muted-foreground">僅 A</dt>
                          <dd className="font-mono tabular-nums text-right">
                            {sharedConceptCount.aOnly}
                          </dd>
                          <dt className="text-muted-foreground">僅 B</dt>
                          <dd className="font-mono tabular-nums text-right">
                            {sharedConceptCount.bOnly}
                          </dd>
                          <dt className="text-red-600 font-medium">共有</dt>
                          <dd className="font-mono tabular-nums text-right text-red-600">
                            {sharedConceptCount.counts[1]}
                          </dd>
                          <dt className="text-muted-foreground">聯集</dt>
                          <dd className="font-mono tabular-nums text-right">
                            {sharedConceptCount.union}
                          </dd>
                          <dt className="text-muted-foreground">Jaccard</dt>
                          <dd className="font-mono tabular-nums text-right">
                            {sharedConceptCount.jaccard.toFixed(3)}
                          </dd>
                        </dl>
                        <p className="text-[0.65rem] text-muted-foreground mt-1.5">
                          隨年份／IPC／最低支持度篩選重算。
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-foreground font-medium mb-2">
                        年份範圍
                      </p>
                      <YearFilter
                        value={yearRange}
                        fullRange={fullYearRange}
                        onChange={onYearChange}
                      />
                    </div>
                    <div>
                      <p className="text-xs text-foreground font-medium mb-2">
                        最低支持度
                      </p>
                      <MinSupportControl
                        label="概念至少出現在 N 篇專利才顯示"
                        value={minSupport}
                        max={maxSupport}
                        onChange={onMinSupportChange}
                      />
                      <p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
                        概念頻率由目前年份／IPC 子集重算；門檻只過濾顯示。
                      </p>
                    </div>
                    {hasIpcData && (
                      <IpcFilterSection
                        ipcLevel={ipcLevel}
                        onIpcLevelChange={onIpcLevelChange}
                        ipcFilter={ipcFilter}
                        onIpcFilterChange={onIpcFilterChange}
                        ipcTree={ipcTree}
                        colorByKey={colorByKey}
                      />
                    )}
                    <div>
                      <p className="text-xs text-foreground font-medium mb-2">
                        節點層
                      </p>
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
                        <span className="font-mono text-primary tabular-nums">
                          {minSupport}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={Math.max(1, maxSupport)}
                        value={Math.min(minSupport, Math.max(1, maxSupport))}
                        onChange={(event) =>
                          onMinSupportChange(Number(event.target.value))
                        }
                        className="w-full accent-primary"
                      />
                    </label>
                    <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
                      邊＝兩家機構共同投入 ≥
                      該數量的技術概念；調高以聚焦強連帶。
                    </p>
                    <div>
                      <p className="text-xs text-foreground font-medium mb-2">
                        機構類型
                      </p>
                      <ul className="space-y-1.5">
                        {communities.map((c) => (
                          <li
                            key={c.name}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span
                              aria-hidden
                              className="size-2.5 rounded-full shrink-0"
                              style={{ background: c.color }}
                            />
                            <span className="text-muted-foreground">
                              {c.name}
                            </span>
                            <span className="ml-auto font-mono text-primary tabular-nums">
                              {c.node_count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-foreground font-medium mb-2">
                        年份範圍
                      </p>
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
                          const disabled =
                            value === "applicant" &&
                            applicantAvailability === "none";
                          return (
                            <Button
                              key={value}
                              type="button"
                              variant={unit === value ? "default" : "ghost"}
                              size="xs"
                              onClick={() => onUnitChange(value)}
                              disabled={disabled}
                              aria-pressed={unit === value}
                              title={
                                disabled
                                  ? "此分析未含機構資料，無法使用「家（機構）」單位"
                                  : undefined
                              }
                              className={`h-auto rounded px-2 py-1 text-xs disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-40 ${
                                unit === value
                                  ? ""
                                  : "text-foreground/60 hover:text-foreground disabled:hover:text-muted-foreground"
                              }`}
                            >
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                      <p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
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
                        {(
                          [
                            ["community", "社群色"],
                            ["first_year", "首次出現年"],
                            ...(allSourceFiles.length > 1
                              ? ([["source", "依來源檔"]] as const)
                              : []),
                            ...(hasIpcData
                              ? ([["ipc", "依 IPC"]] as const)
                              : []),
                          ] as const
                        ).map(([value, label]) => (
                          <Button
                            key={value}
                            type="button"
                            variant={colorMode === value ? "default" : "ghost"}
                            size="xs"
                            onClick={() => onColorModeChange(value)}
                            aria-pressed={colorMode === value}
                            className={`h-auto rounded px-2 py-1 text-xs ${
                              colorMode === value
                                ? ""
                                : "text-foreground/60 hover:text-foreground"
                            }`}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                      {colorMode === "community" && (
                        <p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
                          {unit === "applicant"
                            ? "顏色＝「家」單位 Louvain 社群（同一機構跨篇碰過的概念對分）；隨分析單位自動切換，分區獨立於「篇」單位社群。"
                            : "顏色＝以 support 加權的 Louvain 技術社群（「篇」單位）。"}
                        </p>
                      )}
                      {colorMode === "first_year" && (
                        <p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
                          顏色＝概念首次出現的申請年份（漸層由早至晚）；切換只影響顯示，不改變資料。
                        </p>
                      )}
                      {colorMode === "community_applicants" && (
                        <p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
                          顏色＝「家」單位 Louvain
                          社群（同一機構跨篇碰過的概念對分）；分區獨立於「篇」單位社群。
                        </p>
                      )}
                      {colorMode === "source" && (
                        <p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
                          顏色＝該概念在哪幾個來源檔出現；單獨一文用該檔本色，跨多檔概念用灰紫共享色。
                          <br />
                          只著色不篩選——想只看某檔再往下「來源檔篩選」。
                        </p>
                      )}
                      {colorMode === "ipc" && (
                        <div className="mt-1.5 space-y-1.5">
                          <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
                            顏色＝概念優勢 IPC（L{ipcLevel}
                            ）：該概念的多數專利落在哪個分類。
                          </p>
                          {ipcLegend && ipcLegend.length > 0 && (
                            <div className="rounded-md border border-border bg-muted/40 p-2 text-xs space-y-1">
                              <p className="text-[0.65rem] font-medium text-foreground">
                                IPC 顏色對照（L{ipcLevel}）：
                              </p>
                              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                                {ipcLegend.map((item) => (
                                  <span
                                    key={item.key}
                                    className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 text-[0.65rem] border border-border/60"
                                  >
                                    <span
                                      className="size-2 rounded-sm shrink-0"
                                      style={{ background: item.color }}
                                    />
                                    <span className="font-mono text-foreground font-medium">
                                      {item.key}
                                    </span>
                                    <span className="text-muted-foreground font-mono">
                                      ({item.count})
                                    </span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-foreground font-medium mb-2">
                        來源檔案篩選
                      </p>
                      {allSourceFiles.length <= 1 ? (
                        <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
                          此分析只有一個來源檔；多檔上傳後可用來源檔篩選做「比對」。
                        </p>
                      ) : compareMode ? (
                        <div className="space-y-3">
                          <SourceFileChecklist
                            label="A（左圖）來源"
                            allSourceFiles={allSourceFiles}
                            sourceFiles={sourceFiles}
                            onChange={onSourceFilesChange}
                          />
                          <SourceFileChecklist
                            label="B（右圖）來源"
                            allSourceFiles={allSourceFiles}
                            sourceFiles={sourceFilesRight}
                            onChange={onSourceFilesRightChange}
                          />
                        </div>
                      ) : (
                        <SourceFileChecklist
                          allSourceFiles={allSourceFiles}
                          sourceFiles={sourceFiles}
                          onChange={onSourceFilesChange}
                        />
                      )}
                    </div>
                    {hasIpcData && (
                      <IpcFilterSection
                        ipcLevel={ipcLevel}
                        onIpcLevelChange={onIpcLevelChange}
                        ipcFilter={ipcFilter}
                        onIpcFilterChange={onIpcFilterChange}
                        ipcTree={ipcTree}
                        colorByKey={colorByKey}
                      />
                    )}
                    <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showCitations}
                        onChange={(event) =>
                          onCitationsChange(event.target.checked)
                        }
                        className="mt-0.5"
                      />
                      <span>
                        顯示引用虛線
                        <span className="block text-[0.7rem] text-muted-foreground mt-0.5">
                          疊上專利間引用關係投影到概念層；可用內部引用篇數不多，畫面通常變化很小
                        </span>
                      </span>
                    </label>
                    <MinSupportControl
                      label={
                        unit === "applicant" ? "最低共同家數" : "最低共同專利數"
                      }
                      value={minSupport}
                      max={maxSupport}
                      onChange={onMinSupportChange}
                    />
                    <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
                      概念統計與關係指標由選定的年份／來源檔／IPC
                      子集重新計算；門檻只過濾顯示。
                    </p>
                  </>
                )}
              </div>
            </Section>

            {/* Community Legend */}
            {mode === "concept" && communities.length > 0 && (
              <Section
                value="communities"
                title="技術社群"
                icon={<Tags size={13} />}
                count={hiddenCommunities.size}
                active={hiddenCommunities.size > 0}
              >
                <CommunityLegend
                  communities={communities}
                  hiddenCommunities={hiddenCommunities}
                  onToggle={onCommunityToggle}
                />
              </Section>
            )}

            {/* AI Report */}
            {aiReport && (
              <Section
                value="ai-report"
                title="AI 趨勢報告"
                icon={<Sparkles size={13} />}
              >
                <AIReport html={aiReport} />
              </Section>
            )}
          </Accordion>
        </div>
      </ScrollArea>

      {selectedEdge || selectedNode ? (
        <Inspector
          key={inspectionKey}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          inspectionNodes={inspectionNodes}
          inspectionEdges={inspectionEdges}
          inspectionLookupNodes={inspectionLookupNodes}
          inspectionCommunities={inspectionCommunities}
          methodology={methodology}
          onClose={onInspectorClose}
          onNodeSelect={onInspectorNodeSelect}
          onNodeFocus={onNodeFocus}
        />
      ) : null}
    </aside>
  );
}
