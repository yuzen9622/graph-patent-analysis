"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2, Copy, Check, Download, FileText, ImageDown, GitCompare } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Sidebar from "./Sidebar";
import AnalysisHistorySidebar from "./AnalysisHistorySidebar";
import GraphLegend from "./GraphLegend";
import PublicationExportPanel, { type PublicationGenerateOptions } from "./PublicationExportPanel";
import { selectGraphView, sourceFilesOf, applicantAvailability, type ColorMode, type EdgeWeightMetric, type Unit } from "@/lib/graph-view";
import { ipcLegendItems, ipcTreeOf, DEFAULT_IPC_LEVEL, type IpcLevel } from "@/lib/ipc-filter";
import { parseViewQuery, toViewQueryString } from "@/lib/view-url";
import type { PositionSnapshotProvider } from "@/lib/export-positions";
import { subgraphNodeIds } from "@/lib/publication-export";
import { TEMPORAL_OPACITY_LINE } from "@/lib/temporal";
import type { ImageCapture, PublicationCapture } from "./GraphViewer";
import type { GraphData, GraphEdge, GraphMode, GraphNode, NodeType } from "@/types/graph";

// Load vis-network component client-side only
const GraphViewer = dynamic(() => import("./GraphViewer"), { ssr: false });

interface Props {
  graph: GraphData;
  jobId: string;
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  const clean = (value: string): string | null => {
    const unquoted = value.trim().replace(/^"|"$/g, "");
    const filename = unquoted.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_");
    return filename || null;
  };
  const extended = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(header)?.[1];
  if (extended) {
    const raw = extended.trim().replace(/^"|"$/g, "");
    const separator = raw.indexOf("''");
    try {
      const filename = clean(decodeURIComponent(separator >= 0 ? raw.slice(separator + 2) : raw));
      if (filename) return filename;
    } catch {
      // Fall through to the ordinary filename parameter.
    }
  }

  const basic = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(header);
  return basic ? clean(basic[1] ?? basic[2]) : null;
}

function loadPngImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("匯出圖片解碼失敗"));
    img.src = dataUrl;
  });
}

/** 比較模式匯出：左右兩張畫面 PNG 併成一張，白底、中間留一條分隔線。 */
async function composeSideBySide(
  leftDataUrl: string,
  rightDataUrl: string,
): Promise<string | null> {
  try {
    const [left, right] = await Promise.all([
      loadPngImage(leftDataUrl),
      loadPngImage(rightDataUrl),
    ]);
    const gap = 24;
    const width = left.width + gap + right.width;
    const height = Math.max(left.height, right.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(left, 0, 0);
    ctx.drawImage(right, left.width + gap, 0);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left.width + gap / 2, 0);
    ctx.lineTo(left.width + gap / 2, height);
    ctx.stroke();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export default function GraphLayout({ graph, jobId }: Props) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [mode, setMode] = useState<GraphMode>("concept");
  // LLM 語意虛線已停用（幾乎不會被勾選，且在論文中難以說明）；固定關閉。
  const showSemantic = false;
  const [minSupport, setMinSupport] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>("community");
  const [edgeWeight, setEdgeWeight] = useState<EdgeWeightMetric>("jaccard");
  const [unit, setUnit] = useState<Unit>("patent");
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  // 比較模式（試做版）：同一份分析裡，左右兩側各自選來源檔子集並排比較；
  // 其餘篩選條件（年份/單位/顏色/IPC…）共用，只有來源檔各自獨立。
  const [compareMode, setCompareMode] = useState(false);
  const [sourceFilesRight, setSourceFilesRight] = useState<string[]>([]);
  const [ipcLevel, setIpcLevel] = useState<IpcLevel>(DEFAULT_IPC_LEVEL);
  const [ipcFilter, setIpcFilter] = useState<string[]>([]);
  // 分析範圍中位年／全史中位年切換已移除（PRD：時序 UI mode 未實作，畫面幾乎無變化）；固定用分析範圍。
  const temporalReference = 'active' as const;
  const [showCitations, setShowCitations] = useState(false);
  const [paperMode, setPaperMode] = useState(false);
  const [yearRange, setYearRange] = useState<[number, number]>(
    graph.stats.year_range,
  );
  const [visibleLayers, setVisibleLayers] = useState<Set<NodeType>>(
    new Set<NodeType>(["applicant", "patent", "concept"]),
  );
  const [hiddenCommunities, setHiddenCommunities] = useState<Set<number>>(
    new Set(),
  );
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const positionSnapshotProviderRef = useRef<PositionSnapshotProvider | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [hasPositionSnapshotProvider, setHasPositionSnapshotProvider] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const imageCaptureLeftRef = useRef<ImageCapture | null>(null);
  const imageCaptureRightRef = useRef<ImageCapture | null>(null);
  const [imageLeftReady, setImageLeftReady] = useState(false);
  const [imageRightReady, setImageRightReady] = useState(false);
  const imageExportReady = compareMode ? imageLeftReady && imageRightReady : imageLeftReady;
  const publicationCaptureRef = useRef<PublicationCapture | null>(null);
  const [publicationReady, setPublicationReady] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [publicationNotice, setPublicationNotice] = useState<string | null>(null);

  const handlePositionSnapshotProvider = useCallback((provider: PositionSnapshotProvider | null) => {
    positionSnapshotProviderRef.current = provider;
    setReadyKey(provider?.key ?? null);
    setHasPositionSnapshotProvider(provider !== null);
    setExportError(null);
  }, []);

  const handleImageCaptureReadyLeft = useCallback((capture: ImageCapture | null) => {
    imageCaptureLeftRef.current = capture;
    setImageLeftReady(capture !== null);
  }, []);

  const handleImageCaptureReadyRight = useCallback((capture: ImageCapture | null) => {
    imageCaptureRightRef.current = capture;
    setImageRightReady(capture !== null);
  }, []);

  const handlePublicationCaptureReady = useCallback((capture: PublicationCapture | null) => {
    publicationCaptureRef.current = capture;
    setPublicationReady(capture !== null);
  }, []);

  const handleExportImage = useCallback(async () => {
    const left = imageCaptureLeftRef.current?.();
    if (!left) return;
    let dataUrl = left;
    if (compareMode) {
      const right = imageCaptureRightRef.current?.();
      if (!right) return;
      const composed = await composeSideBySide(left, right);
      if (!composed) return;
      dataUrl = composed;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `patent-graph-${jobId.slice(0, 8)}${compareMode ? "-compare" : ""}.png`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [compareMode, jobId]);

  // 兩側面板共用的篩選條件（來源檔除外）——比較模式下左右各自的 sourceFiles
  // 疊上這份共用選項，其餘（年份/單位/顏色/IPC…）保持一致才有得比。
  const sharedViewOptions = useMemo(
    () => ({
      mode,
      showSemantic,
      minSupport,
      yearRange,
      colorMode,
      edgeWeight,
      unit,
      ipcLevel,
      ipcFilter,
      temporalReference,
      showCitations,
    }),
    [
      mode,
      showSemantic,
      minSupport,
      yearRange,
      colorMode,
      edgeWeight,
      unit,
      ipcLevel,
      ipcFilter,
      temporalReference,
      showCitations,
    ],
  );

  const layoutSnapshotKey = useMemo(
    () => JSON.stringify({ ...sharedViewOptions, sourceFiles }),
    [sharedViewOptions, sourceFiles],
  );
  const layoutSnapshotKeyRight = useMemo(
    () => JSON.stringify({ ...sharedViewOptions, sourceFiles: sourceFilesRight }),
    [sharedViewOptions, sourceFilesRight],
  );

  // PRD v2 / P2: 可用來源檔清單（供「依來源檔著色」與「來源檔篩選」）。
  const allSourceFiles = useMemo(() => sourceFilesOf(graph), [graph]);
  // P9: 家單位資料可用性（stored／rebuildable／none）——決定「家」切換是否可用。
  const applicantDataAvailability = useMemo(
    () => applicantAvailability(graph),
    [graph],
  );
  // PRD v2 / P5: IPC 樹（目前層級）與圖例（依 IPC 著色用）。
  const ipcTree = useMemo(() => ipcTreeOf(graph, ipcLevel), [graph, ipcLevel]);
  const ipcLegend = useMemo(() => ipcLegendItems(graph, ipcLevel), [graph, ipcLevel]);
  const hasIpcData = ipcLegend.length > 0;

  // ── PRD v2 / P3 (N6): view state lives in the URL so a shared link restores
  // the exact view (gradient colouring included). Hydrate once from the query
  // on mount, then mirror every change back with history.replaceState — never
  // a navigation, so the canvas is not remounted. Both directions are pure and
  // unit-tested in lib/view-url.ts.
  const hydratedRef = useRef(false);
  const syncedOnceRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const parsed = parseViewQuery(window.location.search);
    // This one-time URL hydration intentionally initializes local view state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (parsed.mode) setMode(parsed.mode);
    if (parsed.colorMode) setColorMode(parsed.colorMode);
    if (parsed.edgeWeight) setEdgeWeight(parsed.edgeWeight);
    if (parsed.unit && (parsed.unit !== "applicant" || applicantDataAvailability !== "none")) {
      setUnit(parsed.unit);
      // P9: 舊格式若不純粹可用（無機構資料），URL 殘留的 unit=applicant 視為無效，回到篇。
    }
    if (parsed.sourceFiles) setSourceFiles(parsed.sourceFiles);
    if (parsed.ipcLevel) setIpcLevel(parsed.ipcLevel);
    if (parsed.ipcFilter) setIpcFilter(parsed.ipcFilter);
    if (parsed.showCitations !== undefined) setShowCitations(parsed.showCitations);
    if (parsed.minSupport !== undefined) setMinSupport(parsed.minSupport);
    if (parsed.paperMode) setPaperMode(parsed.paperMode);
    if (parsed.yearRange) setYearRange(parsed.yearRange);
    hydratedRef.current = true;
    // Intentional: run once with the initial URL, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    // Skip the very first run: it would overwrite the just-hydrated URL with
    // the pre-hydration (default) values. From the second run on, mirror.
    if (!syncedOnceRef.current) {
      syncedOnceRef.current = true;
      return;
    }
    const query = toViewQueryString({ mode, showSemantic, paperMode, colorMode, minSupport, yearRange, edgeWeight, unit, sourceFiles, ipcLevel, ipcFilter, temporalReference, showCitations });
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }, [mode, colorMode, showSemantic, minSupport, paperMode, yearRange, edgeWeight, unit, sourceFiles, ipcLevel, ipcFilter, temporalReference, showCitations]);

  const view = useMemo(
    () => selectGraphView(graph, { ...sharedViewOptions, sourceFiles }),
    [graph, sharedViewOptions, sourceFiles],
  );
  const viewRight = useMemo(
    () =>
      compareMode
        ? selectGraphView(graph, { ...sharedViewOptions, sourceFiles: sourceFilesRight })
        : null,
    [compareMode, graph, sharedViewOptions, sourceFilesRight],
  );
  const selectedViewNode = selectedNode
    ? view.nodes.find((node) => node.id === selectedNode.id) ??
      viewRight?.nodes.find((node) => node.id === selectedNode.id) ??
      null
    : null;
  const selectedViewEdge = selectedEdge
    ? view.edges.find((edge) => edge.id === selectedEdge.id) ??
      viewRight?.edges.find((edge) => edge.id === selectedEdge.id) ??
      null
    : null;

  const getSubgraphNodeCount = useCallback(
    (nodeId: string, hops: 1 | 2) => subgraphNodeIds(nodeId, view.edges, hops).size,
    [view.edges],
  );

  const handleGeneratePublicationFigure = useCallback(
    (options: PublicationGenerateOptions) => {
      const capture = publicationCaptureRef.current;
      if (!capture) return;
      const [y0, y1] = view.stats.year_range;
      const caption = [
        `分析樣本：${view.stats.applicant_count} 家機構、${view.stats.patent_count} 篇專利${
          y0 && y1 ? `｜年份 ${y0}–${y1}` : ""
        }｜分析單位：${unit === "applicant" ? "家（機構）" : "篇（專利）"}`,
        `社群方法：${graph.methodology.community_algorithm}｜座標僅供排版，不代表定量距離`,
        TEMPORAL_OPACITY_LINE,
      ];
      const result = capture({ ...options, caption });
      if (!result) {
        setPublicationError("匯出失敗，請確認圖譜佈局已完成後重試。");
        setPublicationNotice(null);
        return;
      }
      setPublicationError(null);
      setPublicationNotice(
        result.placedLabels < result.requestedLabels
          ? `已放置 ${result.placedLabels}/${result.requestedLabels} 個標籤，其餘因版面重疊被自動省略。`
          : null,
      );
      const link = document.createElement("a");
      link.href = result.dataUrl;
      const modeSuffix = options.mode === "subgraph" ? "-subgraph" : "";
      link.download = `patent-graph-publication${modeSuffix}-${options.widthMm}mm-${jobId.slice(0, 8)}.png`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [graph.methodology.community_algorithm, jobId, unit, view.stats],
  );

  const selectMode = useCallback((nextMode: GraphMode) => {
    setMode(nextMode);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const exportReady =
    hasPositionSnapshotProvider && readyKey === layoutSnapshotKey;

  const exportQuery = new URLSearchParams({
    mode,
    llm: "0",
    paper: paperMode ? "1" : "0",
    colorMode,
    minSupport: String(minSupport),
    yearStart: String(yearRange[0]),
    yearEnd: String(yearRange[1]),
  });
  if (edgeWeight && edgeWeight !== "jaccard") exportQuery.set("el", edgeWeight);
  if (unit && unit !== "patent") exportQuery.set("unit", unit);
  for (const source of sourceFiles) exportQuery.append("source", source);
  if (showCitations) exportQuery.set('citations', '1');
  if (ipcLevel !== DEFAULT_IPC_LEVEL) exportQuery.set("ipcLevel", String(ipcLevel));
  for (const key of ipcFilter) exportQuery.append("ipc", key);
  const exportQueryString = exportQuery.toString();

  const handleOfflineExport = useCallback(async () => {
    const provider = positionSnapshotProviderRef.current;
    if (
      !provider ||
      readyKey !== layoutSnapshotKey ||
      provider.key !== layoutSnapshotKey ||
      exporting
    ) return;

    const positions = provider.getPositions();
    if (!positions) return;

    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(
        `/api/export/${encodeURIComponent(jobId)}?${exportQueryString}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ positions }),
        },
      );
      if (!response.ok) throw new Error(`Export failed (${response.status})`);

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = filenameFromContentDisposition(
          response.headers.get("Content-Disposition"),
        ) ?? "patent-graph.html";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      }
    } catch {
      setExportError("匯出失敗，請重試。");
    } finally {
      setExporting(false);
    }
  }, [exportQueryString, exporting, jobId, layoutSnapshotKey, readyKey]);

  const handleCopy = useCallback(() => {
    if (typeof window !== "undefined") {
      void navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const toggleLayer = useCallback((type: NodeType) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleCommunity = useCallback((id: number) => {
    setHiddenCommunities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Header ── */}
      <header className="shrink-0 bg-accent border-b border-border px-4 py-2.5 flex items-center justify-between gap-3 min-h-[52px]">
        <Link href="/" className="flex items-center gap-2.5 min-w-0 hover:opacity-85 transition-opacity">
          <BarChart2
            size={20}
            className="text-success shrink-0"
            aria-hidden
          />
          <div className="min-w-0">
            <h1 className="font-serif text-base font-bold text-foreground leading-tight truncate">
              專利知識圖譜分析
            </h1>
            <p className="text-[0.65rem] text-foreground leading-none mt-0.5 font-mono">
              {jobId.slice(0, 8)}…
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-md border border-border bg-background p-0.5" aria-label="圖譜模式">
            {([
              ["concept", "技術概念網路"],
              ["context", "專利脈絡圖"],
              ["institution", "機構網絡"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => selectMode(value)}
                aria-pressed={mode === value}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  mode === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCompareMode((value) => !value)}
            disabled={allSourceFiles.length <= 1}
            aria-pressed={compareMode}
            title={
              allSourceFiles.length <= 1
                ? "此分析只有一個來源檔，無法比較"
                : "左右並排比較不同來源檔子集（試做版）"
            }
            className={`inline-flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              compareMode
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-foreground hover:bg-accent"
            }`}
          >
            <GitCompare size={12} />
            比較模式
          </button>
          <button
            type="button"
            onClick={() => setPaperMode((value) => !value)}
            aria-pressed={paperMode}
            className={`inline-flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-1.5 transition-colors ${
              paperMode
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-foreground hover:bg-accent"
            }`}
          >
            <FileText size={12} />
            論文檢視
          </button>
          {!paperMode && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors duration-150 cursor-pointer"
              aria-label="複製分享連結"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-success" />
                  已複製
                </>
              ) : (
                <>
                  <Copy size={12} />
                  複製連結
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleOfflineExport()}
            disabled={!exportReady || exporting || compareMode}
            title={
              compareMode
                ? "比較模式下無法匯出離線 HTML，請先關閉比較模式"
                : exportError ?? (exportReady ? "下載離線 HTML 圖譜" : "等待圖譜佈局完成")
            }
            className={`inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground transition-colors duration-150 ${
              !exportReady || exporting || compareMode
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
            }`}
            aria-label="下載離線 HTML 圖譜"
          >
            <Download size={12} />
            {exporting ? "匯出中…" : "離線 HTML"}
          </button>
          <button
            type="button"
            onClick={() => void handleExportImage()}
            disabled={!imageExportReady}
            title={
              imageExportReady
                ? compareMode
                  ? "下載左右並排的比較 PNG 圖片"
                  : "下載目前畫面的 PNG 圖片"
                : "等待圖譜佈局完成"
            }
            className={`inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground transition-colors duration-150 ${
              !imageExportReady
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
            }`}
            aria-label="匯出目前畫面為 PNG 圖片"
          >
            <ImageDown size={12} />
            {compareMode ? "匯出圖片（併圖）" : "匯出圖片"}
          </button>
          <PublicationExportPanel
            overviewNodeCount={view.nodes.length}
            selectedNodeId={selectedViewNode?.id ?? null}
            selectedNodeLabel={selectedViewNode?.label ?? null}
            getSubgraphNodeCount={getSubgraphNodeCount}
            disabled={!publicationReady || compareMode}
            disabledReason={compareMode ? "比較模式下無法產生出版圖，請先關閉比較模式" : undefined}
            onGenerate={handleGeneratePublicationFigure}
          />
          {(exportError || publicationError) && (
            <span
              role="status"
              title={exportError ?? publicationError ?? undefined}
              className="max-w-28 truncate text-xs text-destructive"
            >
              {exportError ?? publicationError}
            </span>
          )}
          {!exportError && !publicationError && publicationNotice && (
            <span
              role="status"
              title={publicationNotice}
              className="max-w-40 truncate text-xs text-muted-foreground"
            >
              {publicationNotice}
            </span>
          )}
        </div>
      </header>

      {/* ── Main area: graph + sidebar ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* History sidebar — hidden on mobile */}
        <div className={`${paperMode ? "hidden" : "hidden md:flex"} shrink-0`}>
          <AnalysisHistorySidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />
        </div>

        {/* Graph canvas */}
        <div className="relative flex-1 min-w-0 overflow-hidden flex">
          <div
            className={`relative min-w-0 overflow-hidden flex-1 ${
              compareMode ? "border-r border-border" : ""
            }`}
          >
            {compareMode && (
              <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
                <span className="font-medium text-foreground">左圖</span>
                {" · "}
                {sourceFiles.length === 0 ? "全部來源" : sourceFiles.join("、")}
                {" · "}
                {view.stats.applicant_count} 家 · {view.stats.patent_count} 篇
              </div>
            )}
            <GraphViewer
              nodes={view.nodes}
              edges={view.edges}
              citationEdges={view.citationEdges}
              analysis={mode === "concept" ? graph.analysis : undefined}
              onNodeSelect={setSelectedNode}
              onEdgeSelect={setSelectedEdge}
              positionSnapshotKey={layoutSnapshotKey}
              onPositionSnapshotProvider={handlePositionSnapshotProvider}
              onImageCaptureReady={handleImageCaptureReadyLeft}
              onPublicationCaptureReady={handlePublicationCaptureReady}
              yearRange={yearRange}
              edgeWeight={edgeWeight}
              unit={unit}
              visibleLayers={
                mode === "concept"
                  ? new Set<NodeType>(["concept"])
                  : mode === "institution"
                    ? new Set<NodeType>(["applicant"])
                    : visibleLayers
              }
              hiddenCommunities={
                mode === "concept" || mode === "institution"
                  ? hiddenCommunities
                  : undefined
              }
              focusNodeId={focusNodeId}
            />
            <GraphLegend
              mode={mode}
              minSupport={minSupport}
              colorMode={colorMode}
              unit={unit}
              sourceFiles={sourceFiles}
              allSourceFiles={allSourceFiles}
              methodology={graph.methodology}
              capabilityWarning={view.capabilityWarning}
              stats={view.stats}
              paperMode={paperMode}
              ipcLevel={ipcLevel}
              ipcLegend={ipcLegend}
            />
          </div>

          {compareMode && viewRight && (
            <div className="relative min-w-0 overflow-hidden flex-1">
              <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
                <span className="font-medium text-foreground">右圖</span>
                {" · "}
                {sourceFilesRight.length === 0 ? "全部來源" : sourceFilesRight.join("、")}
                {" · "}
                {viewRight.stats.applicant_count} 家 · {viewRight.stats.patent_count} 篇
              </div>
              <GraphViewer
                nodes={viewRight.nodes}
                edges={viewRight.edges}
                citationEdges={viewRight.citationEdges}
                analysis={mode === "concept" ? graph.analysis : undefined}
                onNodeSelect={setSelectedNode}
                onEdgeSelect={setSelectedEdge}
                positionSnapshotKey={layoutSnapshotKeyRight}
                onImageCaptureReady={handleImageCaptureReadyRight}
                yearRange={yearRange}
                edgeWeight={edgeWeight}
                unit={unit}
                visibleLayers={
                  mode === "concept"
                    ? new Set<NodeType>(["concept"])
                    : mode === "institution"
                      ? new Set<NodeType>(["applicant"])
                      : visibleLayers
                }
                hiddenCommunities={
                  mode === "concept" || mode === "institution"
                    ? hiddenCommunities
                    : undefined
                }
                focusNodeId={focusNodeId}
              />
            </div>
          )}
        </div>

        {/* Right sidebar */}
        {!paperMode && (
          <Sidebar
            nodes={view.nodes}
            allNodes={graph.nodes}
            edges={view.edges}
            communities={view.communities}
            aiReport={graph.ai_report}
            yearRange={yearRange}
            fullYearRange={graph.stats.year_range}
            selectedNode={selectedViewNode}
            selectedEdge={selectedViewEdge}
            methodology={graph.methodology}
            mode={mode}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            unit={unit}
            onUnitChange={setUnit}
            allSourceFiles={allSourceFiles}
            sourceFiles={sourceFiles}
            onSourceFilesChange={setSourceFiles}
            compareMode={compareMode}
            sourceFilesRight={sourceFilesRight}
            onSourceFilesRightChange={setSourceFilesRight}
            ipcLevel={ipcLevel}
            onIpcLevelChange={(level) => {
              setIpcLevel(level);
              setIpcFilter([]);
            }}
            ipcFilter={ipcFilter}
            onIpcFilterChange={setIpcFilter}
            ipcTree={ipcTree}
            hasIpcData={hasIpcData}
            applicantAvailability={applicantDataAvailability}
            minSupport={minSupport}
            maxSupport={viewRight ? Math.max(view.maxSupport, viewRight.maxSupport) : view.maxSupport}
            visibleLayers={visibleLayers}
            hiddenCommunities={hiddenCommunities}
            onYearChange={setYearRange}
            onLayerToggle={toggleLayer}
            onCommunityToggle={toggleCommunity}
            onNodeFocus={setFocusNodeId}
            onNodeSelect={(node) => {
              setSelectedNode(node);
              if (node) setSelectedEdge(null);
            }}
            onEdgeClose={() => setSelectedEdge(null)}
            onMinSupportChange={setMinSupport}
            showCitations={showCitations}
            onCitationsChange={setShowCitations}
          />
        )}
      </div>
    </div>
  );
}
