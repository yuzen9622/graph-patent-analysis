"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import { SEQUENTIAL_BLUE } from "@/lib/concept-time";
import { INSTITUTION_TYPE_COLORS, type InstitutionType, type ColorMode, type Unit, SOURCE_FILE_COLORS, SOURCE_OVERLAP_COLOR } from "@/lib/graph-view";
import type { IpcLevel } from "@/lib/ipc-filter";
import type { GraphData, GraphMethodology, GraphMode } from "@/types/graph";

interface Props {
  mode: GraphMode;
  showSemantic: boolean;
  minSupport: number;
  colorMode?: ColorMode;
  unit?: Unit;
  /** PRD v2 / P2: 可用來源檔與當前篩選（供來源檔圖例）。 */
  allSourceFiles?: string[];
  sourceFiles?: string[];
  methodology: GraphMethodology;
  capabilityWarning?: string;
  stats: GraphData["stats"];
  paperMode?: boolean;
  /** PRD v2 / P5: 依 IPC 著色時的層級（配合 ipcLegend 芯片）。 */
  ipcLevel?: IpcLevel;
  /** PRD v2 / P5: 依 IPC 著色時的顯例（key/color/count，count 遞过，由 layout 算）。 */
  ipcLegend?: Array<{ key: string; color: string; count: number }>;
}

export default function GraphLegend({
  mode,
  showSemantic,
  minSupport,
  methodology,
  capabilityWarning,
  stats,
  paperMode = false,
  colorMode = "community",
  unit = "patent",
  allSourceFiles = [],
  ipcLevel = 3,
  ipcLegend = [],
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const isConceptMode = mode === "concept";
  const isInstMode = mode === "institution";
  const isOpen = paperMode || expanded;
  const window = methodology.time_window ?? null;
  const isGradient = isConceptMode && colorMode === "first_year" && !!window;
  const isSourceColour = isConceptMode && colorMode === "source";
  const isIpcColour = isConceptMode && colorMode === "ipc";
  const IPC_LEVEL_NAMES: Record<number, string> = {
    1: "L1 部",
    2: "L2 類",
    3: "L3 次類",
    4: "L4 主類",
    5: "L5 次目",
  };

  return (
    <div className="absolute bottom-3 left-3 z-10 w-[min(25rem,calc(100%-1.5rem))]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        disabled={paperMode}
        title={paperMode ? "論文檢視會固定顯示圖例" : undefined}
        aria-expanded={isOpen}
        aria-controls="graph-method-legend"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-background/95"
      >
        <Info aria-hidden className="size-3.5" />
        圖例與方法
        <ChevronDown
          aria-hidden
          className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <section
          id="graph-method-legend"
          className="mt-2 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border border-border bg-background/95 p-3 shadow-md backdrop-blur-sm"
          aria-label="圖譜視覺編碼圖例"
        >
          <div className="mb-2">
            <h2 className="text-xs font-semibold text-foreground">
              {isInstMode
                ? "機構網絡"
                : isConceptMode
                  ? "技術概念網絡"
                  : "專利脈絡圖"}
            </h2>
            <p className="mt-0.5 text-[0.65rem] leading-relaxed text-muted-foreground">
              {isInstMode
                ? "圓點＝一家機構；邊＝兩家機構共同投入的技術概念（點開邊看共享概念清單）"
                : isConceptMode
                  ? "用於觀察技術概念的共現關係與社群結構"
                  : "用於追溯申請人、專利與技術概念之間的資料關係"}
            </p>
          </div>

          <ul className="space-y-2 text-[0.7rem] leading-relaxed text-foreground">
            {isInstMode ? (
              <>
                <LegendItem marker={<InstitutionNodeMarker />}>
                  節點大小＝該機構涉足的不同技術概念數，非專利篇數（1 概念＝23、4
                  概念＝28、9 概念＝33）
                </LegendItem>
                <LegendItem marker={<InstitutionLineMarker />}>
                  邊＝兩家機構共同投入的概念 ≥ {minSupport} 個；線粗∝共享概念數
                </LegendItem>
                <LegendItem marker={<CommunityMarker />}>
                  顏色＝機構類型（銀行／金控／保險／大學／…）
                </LegendItem>
                <li className="flex flex-wrap gap-x-2 gap-y-1 pt-1">
                  {(
                    Object.entries(INSTITUTION_TYPE_COLORS) as Array<
                      [InstitutionType, string]
                    >
                  ).map(([type, color]) => (
                    <span key={type} className="inline-flex items-center gap-1">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ background: color }}
                      />
                      {type}
                    </span>
                  ))}
                </li>
              </>
            ) : isConceptMode ? (
              <>
                <LegendItem marker={<NodeScaleMarker />}>
                  {unit === "applicant"
                    ? "概念大小＝涵蓋該概念的不同機構家數，非專利篇數（1 家＝16、4 家＝22、9 家＝28）"
                    : "概念大小＝包含該概念的不同專利篇數（1 篇＝16、4 篇＝22、9 篇＝28）"}
                </LegendItem>
                <LegendItem marker={<SolidLineMarker />}>
                  {unit === "applicant"
                    ? `實線粗細＝共同投入的機構家數（support）；目前只顯示家數門檻 ≥ ${minSupport}`
                    : `實線粗細＝共同出現的不同專利篇數（support）；目前只顯示 support ≥ ${minSupport}`}
                </LegendItem>
                {isGradient ? (
                  <LegendItem marker={<TimeBar window={window} />}>
                    顏色＝概念首次出現的申請年份漸層（{window![0]} 早 → {window![1]} 晚）
                  </LegendItem>
                ) : isIpcColour ? (
                  <>
                    <LegendItem marker={<IpcChips legend={ipcLegend} />}>
                      顏色＝概念優勢 IPC（{IPC_LEVEL_NAMES[ipcLevel] ?? `L${ipcLevel}`}）；無 IPC 專利的概念維持中性灰
                    </LegendItem>
                    <LegendItem marker={<span className="size-2.5 rounded-full" style={{ background: "#94a3b8" }} />}>
                      無 IPC 資料的概念＝中性（不屬任何分類）
                    </LegendItem>
                  </>
                ) : isSourceColour ? (
                  <>
                    <LegendItem marker={<SourceChips files={allSourceFiles} />}>
                      依來源檔著色：某概念只出現在某一檔→該檔本色
                    </LegendItem>
                    <LegendItem marker={<span className="size-2.5 rounded-full" style={{ background: SOURCE_OVERLAP_COLOR }} />}>
                      同時出現在 ≥2 個來源檔的概念＝共享紫灰
                    </LegendItem>
                  </>
                ) : (
                  <LegendItem marker={<CommunityMarker />}>
                    顏色＝以 support 加權的 Louvain 技術社群
                  </LegendItem>
                )}
                <LegendItem marker={<DashedLineMarker />}>
                  虛線＝LLM 語意關係（{showSemantic ? "目前顯示" : "目前關閉"}）
                </LegendItem>
              </>
            ) : (
              <>
                <LegendItem marker={<ContextNodesMarker />}>
                  申請人大小＝其專利篇數（1 篇＝23、4 篇＝28）；概念大小同上
                </LegendItem>
                <LegendItem marker={<PatentMarker />}>
                  專利節點固定大小，不表示重要性
                </LegendItem>
                <LegendItem marker={<StructuralLineMarker />}>
                  結構線＝「申請了」或「包含」的資料關係；線寬不表示強度
                </LegendItem>
              </>
            )}
          </ul>

          <div className="mt-3 border-t border-border pt-2 text-[0.65rem] leading-relaxed text-muted-foreground">
            <p>
              分析樣本：{stats.applicant_count} 家機構、{stats.patent_count} 篇專利
              {hasYearRange(stats.year_range)
                ? `，年份 ${stats.year_range[0]}–${stats.year_range[1]}`
                : ""}
            </p>
            {isConceptMode && (
              <p>
                社群方法：{methodology.community_algorithm}；
                {unit === "applicant" ? "家計邊權重（同一機構跨篇）" : "邊權重＝共同專利篇數"}
              </p>
            )}
            {isGradient && window && (
              <p>
                首次出現年範圍：{window[0]}–{window[1]}（由資料自動得出，非寫死）
              </p>
            )}
            <p className="mt-1 font-medium text-foreground">
              座標僅供排版，不代表定量距離。
            </p>
          </div>

          {capabilityWarning && (
            <div
              role="status"
              className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[0.65rem] leading-relaxed text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>{capabilityWarning}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function LegendItem({
  marker,
  children,
}: {
  marker: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className="flex w-9 shrink-0 items-center justify-center">
        {marker}
      </span>
      <span>{children}</span>
    </li>
  );
}

function TimeBar({ window }: { window: [number, number] }) {
  // 用階梯色塊逼近 sRGB 逐通道 lerp，視覺等價且與節點取色一致。
  const stops = SEQUENTIAL_BLUE.map((hex, i) => `#${hex} ${Math.round((i / (SEQUENTIAL_BLUE.length - 1)) * 100)}%`)
  const css = `linear-gradient(to right, ${stops.join(", ")})`;
  return (
    <span className="block w-9" title={`${window[0]} → ${window[1]}`}>
      <span className="block h-2 w-9 rounded-sm" style={{ background: css }} />
    </span>
  );
}

function NodeScaleMarker() {
  return (
    <span className="flex items-end gap-1">
      <span className="size-2 rounded-full bg-emerald-600" />
      <span className="size-3.5 rounded-full bg-emerald-600" />
    </span>
  );
}

function ContextNodesMarker() {
  return (
    <span className="flex items-center gap-1">
      <span className="size-3.5 rounded-full bg-blue-600" />
      <span className="size-2.5 rounded-full bg-emerald-600" />
    </span>
  );
}

function PatentMarker() {
  return <span className="size-3 rounded-sm bg-orange-500" />;
}

function CommunityMarker() {
  return (
    <span className="flex gap-1">
      <span className="size-2.5 rounded-full bg-violet-500" />
      <span className="size-2.5 rounded-full bg-cyan-500" />
    </span>
  );
}

/** 來源檔色點：一檔一色，最多示三檔（超出顯示 +n）。 */
function SourceChips({ files }: { files: string[] }) {
  const shown = files.slice(0, 3);
  return (
    <span className="flex gap-1">
      {shown.map((f, i) => (
        <span
          key={f}
          className="size-2.5 rounded-full"
          style={{
            background: SOURCE_FILE_COLORS[i % SOURCE_FILE_COLORS.length],
          }}
        />
      ))}
      {files.length > shown.length && (
        <span className="text-[0.6rem] text-muted-foreground">+{files.length - shown.length}</span>
      )}
    </span>
  );
}

/** 依 IPC 著色的色块：最多示 6 個分類，超出顯示 +n。 */
function IpcChips({ legend }: { legend: Array<{ key: string; color: string; count: number }> }) {
  const shown = legend.slice(0, 6);
  return (
    <span className="flex gap-1">
      {shown.map((item) => (
        <span
          key={item.key}
          className="size-2.5 rounded-full"
          title={`${item.key}（${item.count} 篇）`}
          style={{ background: item.color }}
        />
      ))}
      {legend.length > shown.length && (
        <span className="text-[0.6rem] text-muted-foreground">+{legend.length - shown.length}</span>
      )}
    </span>
  );
}

function SolidLineMarker() {
  return <span className="h-1 w-8 rounded-full bg-slate-500" />;
}

function DashedLineMarker() {
  return <span className="w-8 border-t-2 border-dashed border-violet-500" />;
}

function StructuralLineMarker() {
  return <span className="w-8 border-t border-slate-400" />;
}

function InstitutionNodeMarker() {
  return (
    <span className="flex items-end gap-1">
      <span className="size-3 rounded-full bg-slate-500" />
      <span className="size-2 rounded-full bg-slate-400" />
    </span>
  );
}

function InstitutionLineMarker() {
  return <span className="h-1 w-8 rounded-full bg-slate-600" />;
}

function hasYearRange(range: [number, number]) {
  return range.every(Number.isFinite) && range[0] > 0 && range[1] > 0;
}