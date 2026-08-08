"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2, Copy, Check, Download, FileText } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Sidebar from "./Sidebar";
import StatsBar from "./StatsBar";
import AnalysisHistorySidebar from "./AnalysisHistorySidebar";
import GraphLegend from "./GraphLegend";
import { selectGraphView, sourceFilesOf, type ColorMode, type EdgeWeightMetric, type Unit } from "@/lib/graph-view";
import { ipcLegendItems, ipcTreeOf, DEFAULT_IPC_LEVEL, type IpcLevel } from "@/lib/ipc-filter";
import { parseViewQuery, toViewQueryString } from "@/lib/view-url";
import type { GraphData, GraphEdge, GraphMode, GraphNode, NodeType } from "@/types/graph";

// Load vis-network component client-side only
const GraphViewer = dynamic(() => import("./GraphViewer"), { ssr: false });

interface Props {
  graph: GraphData;
  jobId: string;
}

export default function GraphLayout({ graph, jobId }: Props) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [mode, setMode] = useState<GraphMode>("concept");
  const [showSemantic, setShowSemantic] = useState(false);
  const [minSupport, setMinSupport] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>("community");
  const [edgeWeight, setEdgeWeight] = useState<EdgeWeightMetric>("jaccard");
  const [unit, setUnit] = useState<Unit>("patent");
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [ipcLevel, setIpcLevel] = useState<IpcLevel>(DEFAULT_IPC_LEVEL);
  const [ipcFilter, setIpcFilter] = useState<string[]>([]);
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

  // PRD v2 / P2: 可用來源檔清單（供「依來源檔著色」與「來源檔篩選」）。
  const allSourceFiles = useMemo(() => sourceFilesOf(graph), [graph]);
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
    if (parsed.mode) setMode(parsed.mode);
    if (parsed.colorMode) setColorMode(parsed.colorMode);
    if (parsed.edgeWeight) setEdgeWeight(parsed.edgeWeight);
    if (parsed.unit) setUnit(parsed.unit);
    if (parsed.sourceFiles) setSourceFiles(parsed.sourceFiles);
    if (parsed.ipcLevel) setIpcLevel(parsed.ipcLevel);
    if (parsed.ipcFilter) setIpcFilter(parsed.ipcFilter);
    if (parsed.showSemantic !== undefined) setShowSemantic(parsed.showSemantic);
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
    const query = toViewQueryString({ mode, showSemantic, paperMode, colorMode, minSupport, yearRange, edgeWeight, unit, sourceFiles, ipcLevel, ipcFilter });
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }, [mode, colorMode, showSemantic, minSupport, paperMode, yearRange, edgeWeight, unit, sourceFiles, ipcLevel, ipcFilter]);

  const view = useMemo(
    () =>
      selectGraphView(graph, {
        mode,
        showSemantic,
        minSupport,
        yearRange,
        colorMode,
        edgeWeight,
        unit,
        sourceFiles,
        ipcLevel,
        ipcFilter,
      }),
    [graph, mode, showSemantic, minSupport, yearRange, colorMode, edgeWeight, unit, sourceFiles, ipcLevel, ipcFilter],
  );
  const selectedViewNode = selectedNode
    ? view.nodes.find((node) => node.id === selectedNode.id) ?? null
    : null;
  const selectedViewEdge = selectedEdge
    ? view.edges.find((edge) => edge.id === selectedEdge.id) ?? null
    : null;

  const selectMode = useCallback((nextMode: GraphMode) => {
    setMode(nextMode);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const exportQuery = new URLSearchParams({
    mode,
    llm: showSemantic ? "1" : "0",
    paper: paperMode ? "1" : "0",
    colorMode,
    minSupport: String(minSupport),
    yearStart: String(yearRange[0]),
    yearEnd: String(yearRange[1]),
  });
  if (edgeWeight && edgeWeight !== "jaccard") exportQuery.set("el", edgeWeight);
  if (unit && unit !== "patent") exportQuery.set("unit", unit);
  for (const source of sourceFiles) exportQuery.append("source", source);
  if (ipcLevel !== DEFAULT_IPC_LEVEL) exportQuery.set("ipcLevel", String(ipcLevel));
  for (const key of ipcFilter) exportQuery.append("ipc", key);

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
          <a
            href={`/api/export/${jobId}?${exportQuery}`}
            className="inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-accent hover:text-accent-foreground transition-colors duration-150"
            aria-label="下載離線 HTML 圖譜"
          >
            <Download size={12} />
            離線 HTML
          </a>
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
        <div className="relative flex-1 min-w-0 overflow-hidden">
          <GraphViewer
            nodes={view.nodes}
            edges={view.edges}
            analysis={mode === "concept" ? graph.analysis : undefined}
            onNodeSelect={setSelectedNode}
            onEdgeSelect={setSelectedEdge}
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
            showSemantic={showSemantic}
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
            edgeWeight={edgeWeight}
            onEdgeWeightChange={setEdgeWeight}
            unit={unit}
            onUnitChange={setUnit}
            allSourceFiles={allSourceFiles}
            sourceFiles={sourceFiles}
            onSourceFilesChange={setSourceFiles}
            ipcLevel={ipcLevel}
            onIpcLevelChange={(level) => {
              setIpcLevel(level);
              setIpcFilter([]);
            }}
            ipcFilter={ipcFilter}
            onIpcFilterChange={setIpcFilter}
            ipcTree={ipcTree}
            hasIpcData={hasIpcData}
            showSemantic={showSemantic}
            minSupport={minSupport}
            maxSupport={view.maxSupport}
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
            onSemanticChange={setShowSemantic}
            onMinSupportChange={setMinSupport}
          />
        )}
      </div>

      {/* ── Stats bar ── */}
      <StatsBar stats={view.stats} />
    </div>
  );
}
