"use client";

import { useState } from "react";
import { FileImage, Download } from "lucide-react";
import {
  isFullLabelBlocked,
  fullLabelBlockedMessage,
  type PublicationDpi,
  type PublicationLabelMode,
} from "@/lib/publication-export";

export interface PublicationGenerateOptions {
  mode: "overview" | "subgraph";
  widthMm: number;
  dpi: PublicationDpi;
  labelMode: PublicationLabelMode;
  centerNodeId?: string;
  hops?: 1 | 2;
}

interface Props {
  /** M1 整體圖的節點數，用於 §3 封鎖矩陣判斷。 */
  overviewNodeCount: number;
  /** 目前畫布上選取的節點（M2 子圖的中心）；沒選就是 null。 */
  selectedNodeId: string | null;
  selectedNodeLabel: string | null;
  /** 純函數：給中心節點與 hop 數，回傳子圖會有幾個節點（用於封鎖矩陣判斷）。 */
  getSubgraphNodeCount: (nodeId: string, hops: 1 | 2) => number;
  disabled: boolean;
  disabledReason?: string;
  onGenerate: (options: PublicationGenerateOptions) => void;
}

const WIDTH_PRESETS: Array<[number, string]> = [
  [85, "85mm"],
  [120, "120mm"],
  [180, "180mm"],
];
const LABEL_OPTIONS: Array<[PublicationLabelMode, string]> = [
  ["primary", "僅主要概念"],
  ["all", "全部概念"],
  ["none", "不顯示"],
];
const DPI_OPTIONS: PublicationDpi[] = [300, 600];
const HOP_OPTIONS: Array<1 | 2> = [1, 2];

/**
 * PRD-Q8 出版圖選項面板：M1 整體圖／M2 局部子圖共用一個面板，圖幅支援
 * 85/120/180mm 快捷值＋自訂 mm，另有 300/600dpi。觸發後由父層呼叫
 * GraphViewer 的 onPublicationCaptureReady 產生圖片。
 */
export default function PublicationExportPanel({
  overviewNodeCount,
  selectedNodeId,
  selectedNodeLabel,
  getSubgraphNodeCount,
  disabled,
  disabledReason,
  onGenerate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [figureMode, setFigureMode] = useState<"overview" | "subgraph">("overview");
  const [widthMm, setWidthMm] = useState(180);
  const [dpi, setDpi] = useState<PublicationDpi>(300);
  const [labelMode, setLabelMode] = useState<PublicationLabelMode>("primary");
  const [hops, setHops] = useState<1 | 2>(2);
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

  const isSubgraph = figureMode === "subgraph";
  const needsCenterNode = isSubgraph && !selectedNodeId;
  const effectiveNodeCount = isSubgraph
    ? selectedNodeId
      ? getSubgraphNodeCount(selectedNodeId, hops)
      : 0
    : overviewNodeCount;
  // §2 M2：子圖一律全標籤，忽略下方的標籤選擇。
  const effectiveLabelMode: PublicationLabelMode = isSubgraph ? "all" : labelMode;

  // §3 矩陣原本是硬擋；碰撞避讓已經會自動省略重疊標籤，不會畫出疊字的圖，
  // 所以這裡改成「示警 + 使用者勾選承擔」——下載後會誠實回報實際放上幾個、省略幾個。
  const risky = effectiveLabelMode === "all" && isFullLabelBlocked(effectiveNodeCount, widthMm);
  const canGenerate = !needsCenterNode && (!risky || acknowledgeRisk);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-pressed={open}
        title={disabled ? disabledReason ?? "等待圖譜佈局完成" : "產生可放入論文的出版圖（PRD-Q8 M1/M2）"}
        className={`inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground transition-colors duration-150 ${
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
        }`}
        aria-label="出版整體圖選項"
      >
        <FileImage size={12} />
        出版圖
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 w-72 rounded-lg border border-border bg-background p-3 shadow-md">
          <p className="text-xs font-semibold text-foreground mb-2">出版圖（PRD-Q8）</p>

          <div className="mb-3">
            <div
              className="inline-flex rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label="M1／M2"
            >
              {(
                [
                  ["overview", "M1 整體圖"],
                  ["subgraph", "M2 局部子圖"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFigureMode(value)}
                  aria-pressed={figureMode === value}
                  className={`rounded px-2 py-1 text-[0.7rem] transition-colors ${
                    figureMode === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {isSubgraph && (
            <div className="mb-3 space-y-2">
              <p className="text-[0.65rem] text-muted-foreground">
                中心節點：
                {selectedNodeLabel ? (
                  <span className="font-medium text-foreground">{selectedNodeLabel}</span>
                ) : (
                  <span className="text-destructive">請先在圖上點選一個節點</span>
                )}
              </p>
              <div>
                <p className="text-[0.65rem] text-muted-foreground mb-1.5">範圍（hop）</p>
                <div
                  className="inline-flex rounded-md border border-border bg-background p-0.5"
                  role="group"
                  aria-label="hop 範圍"
                >
                  {HOP_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setHops(value)}
                      aria-pressed={hops === value}
                      className={`rounded px-2 py-1 text-[0.7rem] transition-colors ${
                        hops === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {value} 步
                    </button>
                  ))}
                </div>
              </div>
              {selectedNodeId && (
                <p className="text-[0.65rem] text-muted-foreground">
                  子圖節點數：{effectiveNodeCount}（全部顯示中文標籤）
                </p>
              )}
            </div>
          )}

          <div className="mb-3">
            <p className="text-[0.65rem] text-muted-foreground mb-1.5">圖幅</p>
            <div
              className="inline-flex rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label="圖幅快捷值"
            >
              {WIDTH_PRESETS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWidthMm(value)}
                  aria-pressed={widthMm === value}
                  className={`rounded px-2 py-1 text-[0.7rem] transition-colors ${
                    widthMm === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-1.5 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
              自訂
              <input
                type="number"
                min={40}
                max={400}
                value={widthMm}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) setWidthMm(next);
                }}
                className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-[0.7rem] text-foreground"
              />
              mm
            </label>
          </div>

          <div className="mb-3">
            <p className="text-[0.65rem] text-muted-foreground mb-1.5">解析度</p>
            <div
              className="inline-flex rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label="dpi"
            >
              {DPI_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDpi(value)}
                  aria-pressed={dpi === value}
                  className={`rounded px-2 py-1 text-[0.7rem] transition-colors ${
                    dpi === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {value}dpi
                </button>
              ))}
            </div>
          </div>

          {isSubgraph ? (
            <p className="mb-3 text-[0.65rem] leading-relaxed text-muted-foreground">
              子圖固定顯示完整標籤（規格：局部子圖是唯一允許全標籤的場合）。
            </p>
          ) : (
            <div className="mb-3">
              <p className="text-[0.65rem] text-muted-foreground mb-1.5">標籤</p>
              <div
                className="inline-flex rounded-md border border-border bg-background p-0.5"
                role="group"
                aria-label="標籤"
              >
                {LABEL_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLabelMode(value)}
                    aria-pressed={labelMode === value}
                    className={`rounded px-2 py-1 text-[0.7rem] transition-colors ${
                      labelMode === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {risky && (
            <div className="mb-2 space-y-1.5">
              <p className="text-[0.65rem] leading-relaxed text-destructive">
                {fullLabelBlockedMessage(effectiveNodeCount)}
                重疊的標籤會被自動省略，不會畫出疊字的圖；下載後會顯示實際放上幾個。
              </p>
              <label className="flex items-start gap-1.5 text-[0.65rem] text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledgeRisk}
                  onChange={(event) => setAcknowledgeRisk(event.target.checked)}
                  className="mt-0.5"
                />
                <span>我了解部分標籤可能被自動省略，仍要產生</span>
              </label>
            </div>
          )}

          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => {
              onGenerate({
                mode: figureMode,
                widthMm,
                dpi,
                labelMode,
                centerNodeId: isSubgraph ? selectedNodeId ?? undefined : undefined,
                hops: isSubgraph ? hops : undefined,
              });
              setOpen(false);
            }}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
              !canGenerate
                ? "cursor-not-allowed border-border bg-background text-muted-foreground opacity-50"
                : "cursor-pointer border-primary bg-primary text-primary-foreground hover:opacity-90"
            }`}
          >
            <Download size={12} />
            產生並下載
          </button>
        </div>
      )}
    </div>
  );
}
