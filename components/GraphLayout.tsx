"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart2,
  Copy,
  Check,
  Download,
  GitCompare,
  ImageDown,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import Sidebar from "./Sidebar";
import AnalysisHistorySidebar from "./AnalysisHistorySidebar";
import CompareSetupPanel from "./CompareSetupPanel";
import CompareSummary from "./CompareSummary";
import DiffLegend from "./DiffLegend";
import FloatingLegend from "./FloatingLegend";
import SubgraphBanner from "./SubgraphBanner";
import PublicationExportPanel, {
  type PublicationGenerateOptions,
} from "./PublicationExportPanel";
import {
  selectGraphView,
  sourceFilesOf,
  applicantAvailability,
  type ColorMode,
  type EdgeWeightMetric,
  type Unit,
} from "@/lib/graph-view";
import {
  ipcLegendItems,
  ipcTreeOf,
  DEFAULT_IPC_LEVEL,
  type IpcLevel,
} from "@/lib/ipc-filter";
import { parseViewQuery, toViewQueryString } from "@/lib/view-url";
import {
  buildDifferenceView,
  countSharedConcepts,
  membershipHiddenIds,
  panelScopesDistinct,
  suggestNewPanelScope,
  suggestPanelScopes,
  type DiffMembership,
} from "@/lib/graph-compare";
import {
  compareAnnotationLines,
  compareExportFilename,
  compareLegendItems,
  COMPARE_TITLE,
  panelLabel,
  scopeLabel,
  type CommonFilterInput,
  type CompareViewTab,
} from "@/lib/compare-export";
import {
  extractKeywordSubgraphView,
  extractSubgraphView,
  isNodeMatchingKeyword,
  type KeywordSubgraphHops,
  type SubgraphHops,
  type SubgraphState,
} from "@/lib/graph-subgraph";
import type { GraphViewport } from "@/lib/graph-viewport";
import type { PositionSnapshotProvider } from "@/lib/export-positions";
import { subgraphNodeIds } from "@/lib/publication-export";
import { TEMPORAL_OPACITY_LINE } from "@/lib/temporal";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { composeCompareImage } from "@/lib/compare-image";
import {
  resolveInspectionView,
  type InspectionViewSource,
} from "@/lib/inspection-view";
import type { ImageCapture, PublicationCapture } from "./GraphViewer";
import type {
  GraphData,
  GraphEdge,
  GraphMode,
  GraphNode,
  NodeType,
} from "@/types/graph";

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
      const filename = clean(
        decodeURIComponent(separator >= 0 ? raw.slice(separator + 2) : raw),
      );
      if (filename) return filename;
    } catch {
      // Fall through to the ordinary filename parameter.
    }
  }

  const basic = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(header);
  return basic ? clean(basic[1] ?? basic[2]) : null;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** 比較工作區：off（單一檢視）→ setup（選面板範圍）→ active（比較中）。 */
type CompareUiState = "off" | "setup" | "active";

export default function GraphLayout({ graph, jobId }: Props) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [inspectionSource, setInspectionSource] =
    useState<InspectionViewSource | null>(null);
  /** 每次實際選取都遞增，使 inspector 即使選到相同 id 也會回到預設展開／收合狀態。 */
  const [inspectionVersion, setInspectionVersion] = useState(0);
  const clearInspection = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setInspectionSource(null);
  }, []);
  /** GraphViewer 會在同一次點擊對另一種選取送出 null；忽略它以保留剛設定的來源。 */
  const selectInspectionNode = useCallback(
    (node: GraphNode | null, source: InspectionViewSource) => {
      if (!node) return;
      setSelectedNode(node);
      setSelectedEdge(null);
      setInspectionSource(source);
      setInspectionVersion((version) => version + 1);
    },
    [],
  );
  const selectInspectionEdge = useCallback(
    (edge: GraphEdge | null, source: InspectionViewSource) => {
      if (!edge) return;
      setSelectedEdge(edge);
      setSelectedNode(null);
      setInspectionSource(source);
      setInspectionVersion((version) => version + 1);
    },
    [],
  );
  const [mode, setMode] = useState<GraphMode>("concept");
  // LLM 語意虛線已停用（幾乎不會被勾選，且在論文中難以說明）；固定關閉。
  const showSemantic = false;
  const [minSupport, setMinSupport] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>("community");
  const [edgeWeight, setEdgeWeight] = useState<EdgeWeightMetric>("jaccard");
  const [unit, setUnit] = useState<Unit>("patent");
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  // N 面板比較工作區：同一份分析裡，每個面板各自選來源檔子集；
  // 其餘篩選條件（年份/單位/顏色/IPC…）共用，只有來源檔各自獨立。
  const [compareUi, setCompareUi] = useState<CompareUiState>("off");
  const compareMode = compareUi === "active";
  const [compareView, setCompareView] =
    useState<CompareViewTab>("side-by-side");
  // 面板 0／1 沿用既有 sourceFiles／sourceFilesRight（側欄可直接編輯），
  // 面板 2..5 放在 extraPanels（由設定面板管理）。
  const [sourceFilesRight, setSourceFilesRight] = useState<string[]>([]);
  const [extraPanels, setExtraPanels] = useState<string[][]>([]);
  const [setupPanels, setSetupPanels] = useState<string[][]>([]);
  const [hiddenMemberships, setHiddenMemberships] = useState<
    Set<DiffMembership>
  >(new Set());
  // 並排時各面板共用的視窗；GraphViewer 內部會把等價的更新回彈掉，不會互推。
  const [compareViewport, setCompareViewport] = useState<GraphViewport | null>(
    null,
  );
  // 圖片（PNG）匯出：輕量版 ImageCapture 逐面板註冊（並排）與差異檢視各一；
  // ready flags 存 state，capture 就緒／卸載時才會觸發重繪更新按鈕可用性。
  const imageCaptureRefs = useRef<(ImageCapture | null)[]>([]);
  const diffImageCaptureRef = useRef<ImageCapture | null>(null);
  const [imageReadyFlags, setImageReadyFlags] = useState<boolean[]>([]);
  const [diffImageReady, setDiffImageReady] = useState(false);
  const [imageExporting, setImageExporting] = useState(false);
  const [imageExportError, setImageExportError] = useState<string | null>(null);
  const [ipcLevel, setIpcLevel] = useState<IpcLevel>(DEFAULT_IPC_LEVEL);
  const [ipcFilter, setIpcFilter] = useState<string[]>([]);
  // 分析範圍中位年／全史中位年切換已移除（PRD：時序 UI mode 未實作，畫面幾乎無變化）；固定用分析範圍。
  const temporalReference = "active" as const;
  const [showCitations, setShowCitations] = useState(false);
  const [yearRange, setYearRange] = useState<[number, number]>(
    graph.stats.year_range,
  );
  const debouncedMinSupport = useDebouncedValue(minSupport, 200);
  const debouncedYearRange = useDebouncedValue(yearRange, 200);
  const [visibleLayers, setVisibleLayers] = useState<Set<NodeType>>(
    new Set<NodeType>(["applicant", "patent", "concept"]),
  );
  const [hiddenCommunities, setHiddenCommunities] = useState<Set<number>>(
    new Set(),
  );
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>();
  const [subgraphState, setSubgraphState] = useState<SubgraphState | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const positionSnapshotProviderRef = useRef<PositionSnapshotProvider | null>(
    null,
  );
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [hasPositionSnapshotProvider, setHasPositionSnapshotProvider] =
    useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const publicationCaptureRef = useRef<PublicationCapture | null>(null);
  const [publicationReady, setPublicationReady] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [publicationNotice, setPublicationNotice] = useState<string | null>(
    null,
  );

  const handlePositionSnapshotProvider = useCallback(
    (provider: PositionSnapshotProvider | null) => {
      positionSnapshotProviderRef.current = provider;
      setReadyKey(provider?.key ?? null);
      setHasPositionSnapshotProvider(provider !== null);
      setExportError(null);
    },
    [],
  );

  const handlePublicationCaptureReady = useCallback(
    (capture: PublicationCapture | null) => {
      publicationCaptureRef.current = capture;
      setPublicationReady(capture !== null);
    },
    [],
  );

  // 兩側面板共用的篩選條件（來源檔除外）——比較模式下左右各自的 sourceFiles
  // 疊上這份共用選項，其餘（年份/單位/顏色/IPC…）保持一致才有得比。
  const sharedViewOptions = useMemo(
    () => ({
      mode,
      showSemantic,
      minSupport: debouncedMinSupport,
      yearRange: debouncedYearRange,
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
      debouncedMinSupport,
      debouncedYearRange,
      colorMode,
      edgeWeight,
      unit,
      ipcLevel,
      ipcFilter,
      temporalReference,
      showCitations,
    ],
  );

  // 面板範圍：面板 0／1 沿用既有 state（側欄可直接編輯），面板 2..5 在 extraPanels。
  const panelScopes = useMemo(
    () => [sourceFiles, sourceFilesRight, ...extraPanels],
    [sourceFiles, sourceFilesRight, extraPanels],
  );
  const layoutSnapshotKeys = useMemo(
    () =>
      panelScopes.map((scope, index) =>
        JSON.stringify({
          ...sharedViewOptions,
          panel: index,
          sourceFiles: scope,
          subgraph: index === 0 && subgraphState ? subgraphState : undefined,
        }),
      ),
    [sharedViewOptions, panelScopes, subgraphState],
  );
  const layoutSnapshotKeyDiff = useMemo(
    () =>
      JSON.stringify({
        ...sharedViewOptions,
        compare: "difference",
        panelScopes,
      }),
    [sharedViewOptions, panelScopes],
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
  const ipcLegend = useMemo(
    () => ipcLegendItems(graph, ipcLevel),
    [graph, ipcLevel],
  );
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
    if (
      parsed.unit &&
      (parsed.unit !== "applicant" || applicantDataAvailability !== "none")
    ) {
      setUnit(parsed.unit);
      // P9: 舊格式若不純粹可用（無機構資料），URL 殘留的 unit=applicant 視為無效，回到篇。
    }
    if (parsed.sourceFiles) setSourceFiles(parsed.sourceFiles);
    if (parsed.ipcLevel) setIpcLevel(parsed.ipcLevel);
    if (parsed.ipcFilter) setIpcFilter(parsed.ipcFilter);
    if (parsed.showCitations !== undefined)
      setShowCitations(parsed.showCitations);
    if (parsed.minSupport !== undefined) setMinSupport(parsed.minSupport);
    if (parsed.yearRange) setYearRange(parsed.yearRange);
    if (parsed.compareView) setCompareView(parsed.compareView);
    if (parsed.panelScopes && parsed.panelScopes.length >= 2) {
      // 新格式：面板範圍全部來自 panelN 參數。
      setSourceFiles(parsed.panelScopes[0]);
      setSourceFilesRight(parsed.panelScopes[1]);
      setExtraPanels(parsed.panelScopes.slice(2));
    } else {
      // 舊格式：source／rsource 兩側（比較已由 compare=1 啟用時）。
      if (parsed.sourceFiles) setSourceFiles(parsed.sourceFiles);
      if (parsed.sourceFilesRight) setSourceFilesRight(parsed.sourceFilesRight);
    }
    // 只有一個來源檔（或面板範圍重複）時比較無意義，這時就回到一般檢視。
    const hydratedPanels = parsed.panelScopes
      ? parsed.panelScopes
      : [parsed.sourceFiles ?? [], parsed.sourceFilesRight ?? []];
    if (
      parsed.compare &&
      allSourceFiles.length > 1 &&
      hydratedPanels.length >= 2 &&
      panelScopesDistinct(hydratedPanels, allSourceFiles)
    ) {
      setCompareUi("active");
    }
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
    const query = toViewQueryString({
      mode,
      showSemantic,
      colorMode,
      minSupport,
      yearRange,
      edgeWeight,
      unit,
      sourceFiles,
      ipcLevel,
      ipcFilter,
      temporalReference,
      showCitations,
      compare: compareMode,
      compareView,
      panelScopes: compareMode ? panelScopes : undefined,
    });
    // toViewQueryString 只序列化檢視狀態；id 是路由參數，覆寫時必須保留，
    // 否則重新整理／複製連結會找不到這份分析。
    const search = new URLSearchParams(query);
    const currentId = new URLSearchParams(window.location.search).get("id");
    if (currentId) search.set("id", currentId);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${search.toString()}`,
    );
  }, [
    mode,
    colorMode,
    showSemantic,
    minSupport,
    yearRange,
    edgeWeight,
    unit,
    sourceFiles,
    ipcLevel,
    ipcFilter,
    temporalReference,
    showCitations,
    compareMode,
    compareView,
    panelScopes,
  ]);

  const panelViews = useMemo(
    () =>
      compareMode
        ? panelScopes.map((scope) =>
            selectGraphView(graph, {
              ...sharedViewOptions,
              sourceFiles: scope,
            }),
          )
        : null,
    [compareMode, graph, sharedViewOptions, panelScopes],
  );
  const view = useMemo(
    () => selectGraphView(graph, { ...sharedViewOptions, sourceFiles }),
    [graph, sharedViewOptions, sourceFiles],
  );
  const focusedView = useMemo(() => {
    if (!subgraphState) return null;
    if (subgraphState.kind === "keyword") {
      return extractKeywordSubgraphView(view, {
        query: subgraphState.query,
        hops: subgraphState.hops,
      });
    }
    return extractSubgraphView(view, {
      centerNodeId: subgraphState.centerNodeId,
      hops: subgraphState.hops,
    });
  }, [view, subgraphState]);
  const displayView = focusedView ?? view;
  const timeWindow = useMemo(() => {
    const years = displayView.nodes
      .filter((n) => n.type === "concept" && n.first_year !== undefined)
      .map((n) => n.first_year!);
    if (years.length === 0) return null;
    return [Math.min(...years), Math.max(...years)] as [number, number];
  }, [displayView.nodes]);
  // 差異（聯集）檢視：節點⁃邊都是複本，不會動到各面板檢視本身。
  const difference = useMemo(
    () =>
      compareMode && panelViews && panelViews.length >= 2
        ? buildDifferenceView(panelViews)
        : null,
    [compareMode, panelViews],
  );
  const membershipHidden = useMemo(
    () =>
      difference ? membershipHiddenIds(difference, hiddenMemberships) : null,
    [difference, hiddenMemberships],
  );
  // 脈絡圖「兩檔共享概念」統計（2026-08-09）：比較模式取 A/B 兩面板檢視節點的聯集；
  // 否則分析恰有兩來源檔時，取目前脈絡圖檢視——隨年份／IPC／最低支持度子集重算。
  const sharedConceptCount = useMemo(() => {
    if (mode !== "context") return null;
    if (compareMode && panelViews && panelViews.length >= 2) {
      const byId = new Map<string, GraphNode>();
      for (const node of [...panelViews[0]!.nodes, ...panelViews[1]!.nodes]) {
        byId.set(node.id, node);
      }
      return countSharedConcepts(
        Array.from(byId.values()),
        sourceFiles,
        sourceFilesRight,
      );
    }
    if (allSourceFiles.length === 2) {
      return countSharedConcepts(
        view.nodes,
        [allSourceFiles[0]!],
        [allSourceFiles[1]!],
      );
    }
    return null;
  }, [
    mode,
    compareMode,
    panelViews,
    sourceFiles,
    sourceFilesRight,
    allSourceFiles,
    view.nodes,
  ]);
  const compareLabels = useMemo(
    () =>
      compareMode
        ? panelScopes.map((scope) => scopeLabel(scope, allSourceFiles))
        : [],
    [allSourceFiles, compareMode, panelScopes],
  );
  const commonFilters = useMemo<CommonFilterInput>(
    () => ({
      mode: sharedViewOptions.mode,
      unit: sharedViewOptions.unit,
      colorMode: sharedViewOptions.colorMode,
      edgeWeight: sharedViewOptions.edgeWeight,
      minSupport: sharedViewOptions.minSupport,
      yearRange: sharedViewOptions.yearRange,
      ipcLevel: sharedViewOptions.ipcLevel,
      ipcFilter: sharedViewOptions.ipcFilter,
      showCitations: sharedViewOptions.showCitations,
    }),
    [sharedViewOptions],
  );
  const viewerLayers = useMemo(
    () =>
      mode === "concept"
        ? new Set<NodeType>(["concept"])
        : mode === "institution"
          ? new Set<NodeType>(["applicant"])
          : visibleLayers,
    [mode, visibleLayers],
  );
  const viewerHiddenCommunities = useMemo(
    () =>
      mode === "concept" || mode === "institution"
        ? hiddenCommunities
        : undefined,
    [mode, hiddenCommunities],
  );

  const openCompareSetup = useCallback(() => {
    clearInspection();
    setSubgraphState(null);
    const suggestion = suggestPanelScopes(allSourceFiles, [
      sourceFiles,
      sourceFilesRight,
      ...extraPanels,
    ]);
    setSetupPanels(suggestion);
    setCompareUi("setup");
  }, [
    allSourceFiles,
    clearInspection,
    extraPanels,
    sourceFiles,
    sourceFilesRight,
  ]);

  const startCompare = useCallback(() => {
    // `CompareSetupPanel` 已停用無效按鈕；這層仍守住不變量，避免日後呼叫端略過 UI。
    if (
      setupPanels.length < 2 ||
      !panelScopesDistinct(setupPanels, allSourceFiles)
    )
      return;
    setSourceFiles(setupPanels[0]);
    setSourceFilesRight(setupPanels[1]);
    setExtraPanels(setupPanels.slice(2));
    setHiddenMemberships(new Set());
    setCompareViewport(null);
    setImageReadyFlags([]);
    setDiffImageReady(false);
    setImageExportError(null);
    clearInspection();
    setCompareUi("active");
  }, [allSourceFiles, clearInspection, setupPanels]);

  const exitCompare = useCallback(() => {
    clearInspection();
    setCompareUi("off");
    setCompareViewport(null);
    setImageReadyFlags([]);
    setDiffImageReady(false);
    setImageExportError(null);
  }, [clearInspection]);

  const swapCompareScopes = useCallback(() => {
    // 僅兩面板時的交換語意；三面板以上沒有單一「交換 A/B」可定義。
    if (panelScopes.length !== 2) return;
    clearInspection();
    setSourceFiles(sourceFilesRight);
    setSourceFilesRight(sourceFiles);
  }, [clearInspection, panelScopes.length, sourceFiles, sourceFilesRight]);

  // 活躍比較期間仍可從側欄調整面板 1／2；若任兩面板有效範圍相同，
  // 就回到設定面板，讓使用者看見並修正，而不是默默顯示兩張相同的圖。
  const updateActiveCompareScope = useCallback(
    (side: "left" | "right", next: string[]) => {
      const nextPanels =
        side === "left"
          ? [next, sourceFilesRight, ...extraPanels]
          : [sourceFiles, next, ...extraPanels];
      if (!panelScopesDistinct(nextPanels, allSourceFiles)) {
        clearInspection();
        setSetupPanels(nextPanels);
        setCompareUi("setup");
        return;
      }
      clearInspection();
      if (side === "left") setSourceFiles(next);
      else setSourceFilesRight(next);
    },
    [
      allSourceFiles,
      clearInspection,
      extraPanels,
      sourceFiles,
      sourceFilesRight,
    ],
  );

  const swapSetupScopes = useCallback(() => {
    setSetupPanels((prev) => {
      if (prev.length !== 2) return prev;
      return [prev[1], prev[0]];
    });
  }, []);

  // 設定面板中新增一個面板：預設範圍是第一個沒被用到的來源檔。
  const addSetupPanel = useCallback(() => {
    setSetupPanels((prev) => {
      if (prev.length >= 6) return prev;
      return [...prev, suggestNewPanelScope(prev, allSourceFiles)];
    });
  }, [allSourceFiles]);

  const removeSetupPanel = useCallback((index: number) => {
    setSetupPanels((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const changeCompareView = useCallback(
    (tab: CompareViewTab) => {
      clearInspection();
      setCompareView(tab);
      setCompareViewport(null);
      // 分頁切換會卸載／重掛 viewer；清掉圖片匯出就緒旗標，
      // 避免拿上一頁的舊 capture 誤導按鈕可用性。
      setImageReadyFlags([]);
      setDiffImageReady(false);
      imageCaptureRefs.current = [];
      diffImageCaptureRef.current = null;
    },
    [clearInspection],
  );

  const toggleMembership = useCallback((membership: DiffMembership) => {
    setHiddenMemberships((prev) => {
      const next = new Set(prev);
      if (next.has(membership)) next.delete(membership);
      else next.add(membership);
      return next;
    });
  }, []);

  const inspectionView = resolveInspectionView(inspectionSource, {
    main: displayView,
    panels: panelViews,
    difference: difference?.view,
  });
  const selectedViewNode = selectedNode
    ? (inspectionView?.nodes.find((node) => node.id === selectedNode.id) ??
      null)
    : null;
  const selectedViewEdge = selectedEdge
    ? (inspectionView?.edges.find((edge) => edge.id === selectedEdge.id) ??
      null)
    : null;

  const getSubgraphNodeCount = useCallback(
    (nodeId: string, hops: 1 | 2) =>
      subgraphNodeIds(nodeId, view.edges, hops).size,
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

  const handleImageCaptureReady = useCallback((index: number) => {
    return (capture: ImageCapture | null) => {
      imageCaptureRefs.current[index] = capture;
      setImageReadyFlags((prev) => {
        const next = [...prev];
        while (next.length <= index) next.push(false);
        next[index] = capture !== null;
        return next;
      });
    };
  }, []);

  const handleDiffImageCaptureReady = useCallback(
    (capture: ImageCapture | null) => {
      diffImageCaptureRef.current = capture;
      setDiffImageReady(capture !== null);
    },
    [],
  );

  // 圖片（PNG）匯出：非比較模式＝目前畫面單張；比較模式＝逐面板擷取後
  // 組合成帶標題、指標與圖例的白底圖（並排 N 面板／差異單張聯集圖）。
  const imageExportReady = !compareMode
    ? imageReadyFlags[0] === true
    : compareView === "difference"
      ? diffImageReady
      : imageReadyFlags.slice(0, panelScopes.length).every(Boolean);

  const handleExportImage = useCallback(async () => {
    const panelCount = panelScopes.length;
    const captures =
      compareMode && compareView === "difference"
        ? [diffImageCaptureRef.current]
        : compareMode
          ? imageCaptureRefs.current.slice(0, panelCount)
          : [imageCaptureRefs.current[0]];
    const dataUrls = captures.map((capture) => capture?.() ?? null);
    if (dataUrls.some((dataUrl) => dataUrl === null)) return;
    setImageExporting(true);
    setImageExportError(null);
    try {
      if (!compareMode) {
        downloadDataUrl(dataUrls[0]!, `patent-graph-${jobId.slice(0, 8)}.png`);
        return;
      }
      if (!difference) return;
      const panels = dataUrls.map((dataUrl, index) => ({
        label:
          compareView === "difference"
            ? "差異（聯集）檢視"
            : panelCount <= 2
              ? `${panelLabel(index, panelCount)}${index === 0 ? "（左）" : "（右）"}· ${compareLabels[index]}`
              : `面板 ${index + 1}：${compareLabels[index]}`,
        dataUrl: dataUrl!,
      }));
      const composed = await composeCompareImage({
        title: COMPARE_TITLE,
        annotationLines: compareAnnotationLines({
          labels: compareLabels,
          metrics: difference.metrics,
          tab: compareView,
          ...commonFilters,
        }),
        legend: compareLegendItems(panelCount),
        panels,
      });
      downloadDataUrl(
        composed,
        compareExportFilename(jobId, "png", compareView),
      );
    } catch {
      setImageExportError("圖片匯出失敗，請重試。");
    } finally {
      setImageExporting(false);
    }
  }, [
    commonFilters,
    compareLabels,
    compareMode,
    compareView,
    difference,
    jobId,
    panelScopes.length,
  ]);

  const selectMode = useCallback(
    (nextMode: GraphMode) => {
      setMode(nextMode);
      clearInspection();
      setSubgraphState(null);
    },
    [clearInspection],
  );

  // 差異檢視只有一張圖，凍結座標來自那張；其餘情況沿用面板 1。
  const compareHtmlExport = compareMode && compareView === "difference";
  const activeSnapshotKey = compareHtmlExport
    ? layoutSnapshotKeyDiff
    : layoutSnapshotKeys[0];
  const offlineExportBlocked = compareMode && !compareHtmlExport;
  const exportReady =
    hasPositionSnapshotProvider && readyKey === activeSnapshotKey;

  const exportQuery = new URLSearchParams({
    mode,
    llm: "0",
    colorMode,
    minSupport: String(minSupport),
    yearStart: String(yearRange[0]),
    yearEnd: String(yearRange[1]),
  });
  if (edgeWeight && edgeWeight !== "jaccard") exportQuery.set("el", edgeWeight);
  if (unit && unit !== "patent") exportQuery.set("unit", unit);
  if (showCitations) exportQuery.set("citations", "1");
  if (ipcLevel !== DEFAULT_IPC_LEVEL)
    exportQuery.set("ipcLevel", String(ipcLevel));
  for (const key of ipcFilter) exportQuery.append("ipc", key);
  if (compareHtmlExport) {
    exportQuery.set("compare", "1");
    for (const [index, scope] of panelScopes.entries()) {
      for (const source of scope) exportQuery.append(`panel${index}`, source);
    }
  } else {
    for (const source of sourceFiles) exportQuery.append("source", source);
  }
  const exportQueryString = exportQuery.toString();

  const handleOfflineExport = useCallback(async () => {
    const provider = positionSnapshotProviderRef.current;
    if (
      !provider ||
      offlineExportBlocked ||
      readyKey !== activeSnapshotKey ||
      provider.key !== activeSnapshotKey ||
      exporting
    )
      return;

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
        link.download =
          filenameFromContentDisposition(
            response.headers.get("Content-Disposition"),
          ) ??
          (compareHtmlExport
            ? compareExportFilename(jobId, "html", "difference")
            : "patent-graph.html");
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
  }, [
    activeSnapshotKey,
    compareHtmlExport,
    exportQueryString,
    exporting,
    jobId,
    offlineExportBlocked,
    readyKey,
  ]);

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

  const handleSearchKeyword = useCallback(
    (query: string) => {
      const clean = query.trim();
      if (!clean) return;
      const matchedCount = view.nodes.filter((n) =>
        isNodeMatchingKeyword(n, clean),
      ).length;
      setSubgraphState({
        kind: "keyword",
        query: clean,
        matchedCount,
        hops: 1, // 預設 1 層 (包含直接相關技術)
      });
      clearInspection();
    },
    [view.nodes, clearInspection],
  );

  const handleEnterSubgraph = useCallback((node: GraphNode) => {
    setSubgraphState({
      kind: "node",
      centerNodeId: node.id,
      centerNodeLabel: node.label,
      hops: 2,
    });
    setFocusNodeId(node.id);
    setSelectedNode(node);
    setSelectedEdge(null);
  }, []);

  const handleExitSubgraph = useCallback(() => {
    setSubgraphState(null);
  }, []);

  const handleKeywordHopsChange = useCallback((hops: KeywordSubgraphHops) => {
    setSubgraphState((prev) =>
      prev && prev.kind === "keyword" ? { ...prev, hops } : prev,
    );
  }, []);

  const handleNodeHopsChange = useCallback((hops: SubgraphHops) => {
    setSubgraphState((prev) =>
      prev && prev.kind === "node" ? { ...prev, hops } : prev,
    );
  }, []);

  /** 重設所有篩選（年份／來源檔／IPC／門檻／圖層／社群／引用線）。 */
  const handleResetFilters = useCallback(() => {
    clearInspection();
    setSubgraphState(null);
    setYearRange(graph.stats.year_range);
    setMinSupport(1);
    setIpcFilter([]);
    setShowCitations(false);
    setVisibleLayers(new Set<NodeType>(["applicant", "patent", "concept"]));
    setHiddenCommunities(new Set());
    setSourceFiles([]);
    setSourceFilesRight([]);
    setExtraPanels([]);
    // 重設後所有面板都回到「全部來源」＝彼此重複，比較失去意義，直接結束比較。
    if (compareMode) exitCompare();
  }, [clearInspection, graph.stats.year_range, compareMode, exitCompare]);

  // 切換到另一份分析時 page 不會 remount（同一個 route，只換 id query），
  // 所以綁在資料上的篩選必須手動歸零；純檢視偏好（mode／配色／圖層…）保留。
  // 但兩個能力相依的偏好要額外檢查：新分析若缺家單位資料或機構結構邊，
  // 保留現況會畫出空圖／錯圖（UI 上這些選項本來就會因能力不足而停用，
  // 切換分析後不應被靜默保留），所以退回有效狀態。
  const prevJobIdRef = useRef(jobId);
  useEffect(() => {
    if (prevJobIdRef.current === jobId) return;
    prevJobIdRef.current = jobId;
    clearInspection();
    setSubgraphState(null);
    setFocusNodeId(undefined);
    setYearRange(graph.stats.year_range);
    setMinSupport(1);
    setIpcLevel(DEFAULT_IPC_LEVEL);
    setIpcFilter([]);
    setSourceFiles([]);
    setSourceFilesRight([]);
    setExtraPanels([]);
    setHiddenCommunities(new Set());
    setCompareUi("off");
    setCompareView("side-by-side");
    // 「家」單位：新分析完全沒有機構資料時退回篇單位
    // （applicantAvailability 'none' 會畫出邊數 0、大小誤讀成篇數的空圖）。
    setUnit(
      unit === "applicant" && applicantDataAvailability === "none"
        ? "patent"
        : unit,
    );
    // 「機構網路」模式：機構視圖由 申請了 結構邊重建，缺省時是零節點空圖。
    setMode(
      mode === "institution" &&
        !graph.edges.some(
          (edge) => edge.kind === "structural" && edge.relation === "申請了",
        )
        ? "concept"
        : mode,
    );
  }, [jobId, graph, clearInspection, mode, unit, applicantDataAvailability]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Header ── */}
      <header className="shrink-0 bg-accent border-b border-border px-4 py-2.5 flex items-center justify-between gap-3 min-h-[52px]">
        <Link
          href="/"
          className="flex items-center gap-2.5 min-w-0 hover:opacity-85 transition-opacity"
        >
          <BarChart2 size={20} className="text-success shrink-0" aria-hidden />
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
          <ButtonGroup
            aria-label="圖譜模式"
            className="rounded-md border border-border bg-background "
          >
            {(
              [
                ["concept", "技術概念網路"],
                ["context", "專利脈絡圖"],
                ["institution", "機構網路"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={mode === value ? "default" : "ghost"}
                size="xs"
                onClick={() => selectMode(value)}
                aria-pressed={mode === value}
                className={`h-auto rounded px-2.5 py-1 text-xs ${
                  mode === value
                    ? ""
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </Button>
            ))}
          </ButtonGroup>
          <Button
            type="button"
            variant={compareUi !== "off" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              compareUi === "off" ? openCompareSetup() : exitCompare()
            }
            disabled={allSourceFiles.length <= 1}
            aria-pressed={compareUi !== "off"}
            title={
              allSourceFiles.length <= 1
                ? "此分析只有一個來源檔，無法比較"
                : "設定多面板來源檔範圍並比較"
            }
            className={`h-auto gap-1.5 py-1.5 text-xs disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-40 ${
              compareUi !== "off" ? "border-primary" : "hover:bg-accent"
            }`}
          >
            <GitCompare size={12} />
            比較
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-auto gap-1.5 py-1.5 text-xs hover:border-accent hover:bg-accent hover:text-accent-foreground cursor-pointer"
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
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleOfflineExport()}
            disabled={!exportReady || exporting || offlineExportBlocked}
            title={
              offlineExportBlocked
                ? "並排檢視無法匯出離線 HTML，請先切到「差異」檢視"
                : (exportError ??
                  (exportReady ? "下載離線 HTML 圖譜" : "等待圖譜佈局完成"))
            }
            className={`h-auto gap-1.5 py-1.5 text-xs disabled:pointer-events-auto ${
              !exportReady || exporting || offlineExportBlocked
                ? "cursor-not-allowed"
                : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
            }`}
            aria-label="下載離線 HTML 圖譜"
          >
            <Download size={12} />
            {exporting
              ? "匯出中…"
              : compareMode
                ? "離線 HTML（差異）"
                : "離線 HTML"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleExportImage()}
            disabled={!imageExportReady || imageExporting}
            title={
              imageExportReady
                ? compareMode
                  ? "下載帶標題、面板來源、共用篩選與指標的比較 PNG"
                  : "下載目前畫面的 PNG 圖片"
                : "等待圖譜佈局完成"
            }
            className={`h-auto gap-1.5 py-1.5 text-xs disabled:pointer-events-auto ${
              !imageExportReady || imageExporting
                ? "cursor-not-allowed"
                : "cursor-pointer hover:bg-accent hover:text-accent-foreground"
            }`}
            aria-label={
              compareMode ? "匯出比較 PNG" : "匯出目前畫面為 PNG 圖片"
            }
          >
            <ImageDown size={12} />
            {imageExporting
              ? "匯出中…"
              : compareMode
                ? "匯出比較 PNG"
                : "匯出圖片"}
          </Button>
          <PublicationExportPanel
            overviewNodeCount={view.nodes.length}
            selectedNodeId={selectedViewNode?.id ?? null}
            selectedNodeLabel={selectedViewNode?.label ?? null}
            getSubgraphNodeCount={getSubgraphNodeCount}
            disabled={!publicationReady || compareUi !== "off"}
            disabledReason={
              compareUi !== "off"
                ? "出版圖是單張圖譜的 PRD 規格，比較工作區不適用；請先結束比較。"
                : undefined
            }
            onGenerate={handleGeneratePublicationFigure}
          />
          {(exportError || publicationError || imageExportError) && (
            <span
              role="status"
              title={
                exportError ?? publicationError ?? imageExportError ?? undefined
              }
              className="max-w-28 truncate text-xs text-destructive"
            >
              {exportError ?? publicationError ?? imageExportError}
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
        <div className="hidden md:flex shrink-0">
          <AnalysisHistorySidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((c) => !c)}
          />
        </div>

        {/* Graph canvas */}
        <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
          {compareMode && difference && (
            <CompareSummary
              labels={compareLabels}
              filters={commonFilters}
              metrics={difference.metrics}
              tab={compareView}
              onTabChange={changeCompareView}
              onSwap={panelScopes.length === 2 ? swapCompareScopes : undefined}
              onExit={exitCompare}
              onEditScope={openCompareSetup}
            />
          )}
          <div className="relative flex flex-1 min-w-0 overflow-hidden">
            <CompareSetupPanel
              open={compareUi === "setup"}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) exitCompare();
              }}
              allSourceFiles={allSourceFiles}
              panels={setupPanels}
              onPanelsChange={setSetupPanels}
              onSwap={swapSetupScopes}
              onCancel={exitCompare}
              onStart={startCompare}
              onAddPanel={addSetupPanel}
              onRemovePanel={removeSetupPanel}
            />
            {compareMode &&
            compareView === "difference" &&
            difference &&
            membershipHidden ? (
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <GraphViewer
                  nodes={difference.view.nodes}
                  edges={difference.view.edges}
                  citationEdges={difference.view.citationEdges}
                  onNodeSelect={(node) =>
                    selectInspectionNode(node, { kind: "difference" })
                  }
                  onEdgeSelect={(edge) =>
                    selectInspectionEdge(edge, { kind: "difference" })
                  }
                  onSelectionClear={clearInspection}
                  positionSnapshotKey={layoutSnapshotKeyDiff}
                  onPositionSnapshotProvider={handlePositionSnapshotProvider}
                  onImageCaptureReady={handleDiffImageCaptureReady}
                  yearRange={yearRange}
                  edgeWeight={edgeWeight}
                  unit={unit}
                  visibleLayers={viewerLayers}
                  hiddenCommunities={viewerHiddenCommunities}
                  hiddenNodeIds={membershipHidden.nodes}
                  hiddenEdgeIds={membershipHidden.edges}
                  focusNodeId={focusNodeId}
                />
                <DiffLegend
                  hidden={hiddenMemberships}
                  onToggle={toggleMembership}
                  visibleNodeCount={
                    difference.view.nodes.length - membershipHidden.nodes.size
                  }
                  totalNodeCount={difference.view.nodes.length}
                  panelCount={panelScopes.length}
                />
              </div>
            ) : compareMode && panelViews ? (
              <div
                className={`flex min-w-0 flex-1 overflow-hidden ${
                  panelViews.length > 2 ? "overflow-x-auto" : ""
                }`}
              >
                {panelViews.map((panelView, index) => (
                  <div
                    key={index}
                    className={`relative min-w-0 overflow-hidden ${
                      index < panelViews.length - 1
                        ? "border-r border-border"
                        : ""
                    } ${
                      panelViews.length > 2 ? "min-w-[28rem] flex-1" : "flex-1"
                    }`}
                  >
                    <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
                      <span className="font-medium text-foreground">
                        {panelLabel(index, panelViews.length)}
                        {panelViews.length <= 2
                          ? index === 0
                            ? "（左）"
                            : "（右）"
                          : ""}
                      </span>
                      {" · "}
                      {compareLabels[index]}
                      {" · "}
                      {panelView.stats.applicant_count} 家 ·{" "}
                      {panelView.stats.patent_count} 篇
                    </div>
                    <GraphViewer
                      nodes={panelView.nodes}
                      edges={panelView.edges}
                      citationEdges={panelView.citationEdges}
                      analysis={mode === "concept" ? graph.analysis : undefined}
                      onNodeSelect={(node) =>
                        selectInspectionNode(node, { kind: "panel", index })
                      }
                      onEdgeSelect={(edge) =>
                        selectInspectionEdge(edge, { kind: "panel", index })
                      }
                      onSelectionClear={clearInspection}
                      positionSnapshotKey={layoutSnapshotKeys[index]}
                      onPositionSnapshotProvider={
                        handlePositionSnapshotProvider
                      }
                      onImageCaptureReady={handleImageCaptureReady(index)}
                      viewport={compareViewport}
                      onViewportChange={setCompareViewport}
                      yearRange={yearRange}
                      edgeWeight={edgeWeight}
                      unit={unit}
                      visibleLayers={viewerLayers}
                      hiddenCommunities={viewerHiddenCommunities}
                      focusNodeId={focusNodeId}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="relative min-w-0 flex-1 overflow-hidden">
                {subgraphState && (
                  <SubgraphBanner
                    state={subgraphState}
                    onKeywordHopsChange={handleKeywordHopsChange}
                    onNodeHopsChange={handleNodeHopsChange}
                    onExit={handleExitSubgraph}
                    nodeCount={displayView.nodes.length}
                    edgeCount={displayView.edges.length}
                  />
                )}
                <GraphViewer
                  nodes={displayView.nodes}
                  edges={displayView.edges}
                  citationEdges={displayView.citationEdges}
                  analysis={mode === "concept" ? graph.analysis : undefined}
                  onNodeSelect={(node) =>
                    selectInspectionNode(node, { kind: "main" })
                  }
                  onEdgeSelect={(edge) =>
                    selectInspectionEdge(edge, { kind: "main" })
                  }
                  onSelectionClear={clearInspection}
                  positionSnapshotKey={layoutSnapshotKeys[0]}
                  onPositionSnapshotProvider={handlePositionSnapshotProvider}
                  onCaptureReady={handlePublicationCaptureReady}
                  onImageCaptureReady={handleImageCaptureReady(0)}
                  yearRange={yearRange}
                  edgeWeight={edgeWeight}
                  unit={unit}
                  visibleLayers={viewerLayers}
                  hiddenCommunities={viewerHiddenCommunities}
                  focusNodeId={focusNodeId}
                />
              </div>
            )}

            {/* 右下角顏色圖例清單（社群色／首次出現年／IPC分類／機構／來源檔／脈絡圖） */}
            <FloatingLegend
              mode={mode}
              colorMode={colorMode}
              communities={view.communities}
              hiddenCommunities={hiddenCommunities}
              onToggleCommunity={toggleCommunity}
              ipcLegend={ipcLegend}
              ipcLevel={ipcLevel}
              yearRange={yearRange}
              fullYearRange={graph.stats.year_range}
              timeWindow={timeWindow}
              allSourceFiles={allSourceFiles}
              visibleLayers={visibleLayers}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <Sidebar
          nodes={view.nodes}
          communities={view.communities}
          inspectionKey={`${inspectionVersion}:${inspectionSource?.kind ?? "none"}${
            inspectionSource?.kind === "panel"
              ? `:${inspectionSource.index}`
              : ""
          }`}
          inspectionNodes={inspectionView?.nodes ?? []}
          inspectionEdges={inspectionView?.edges ?? []}
          inspectionLookupNodes={graph.nodes}
          inspectionCommunities={inspectionView?.communities ?? []}
          aiReport={graph.ai_report}
          yearRange={yearRange}
          fullYearRange={graph.stats.year_range}
          selectedNode={selectedViewNode}
          selectedEdge={selectedViewEdge}
          methodology={graph.methodology}
          mode={mode}
          sharedConceptCount={sharedConceptCount}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          unit={unit}
          onUnitChange={setUnit}
          allSourceFiles={allSourceFiles}
          sourceFiles={sourceFiles}
          onSourceFilesChange={
            compareMode
              ? (next) => updateActiveCompareScope("left", next)
              : setSourceFiles
          }
          compareMode={compareMode}
          sourceFilesRight={sourceFilesRight}
          onSourceFilesRightChange={(next) =>
            updateActiveCompareScope("right", next)
          }
          extraPanelCount={
            extraPanels.filter((scope) => scope.length > 0).length
          }
          ipcLevel={ipcLevel}
          onIpcLevelChange={(level) => {
            setIpcLevel(level);
            setIpcFilter([]);
          }}
          ipcFilter={ipcFilter}
          onIpcFilterChange={setIpcFilter}
          ipcTree={ipcTree}
          hasIpcData={hasIpcData}
          ipcLegend={ipcLegend}
          applicantAvailability={applicantDataAvailability}
          minSupport={minSupport}
          maxSupport={
            panelViews && panelViews.length > 0
              ? Math.max(...panelViews.map((panel) => panel.maxSupport))
              : view.maxSupport
          }
          visibleLayers={visibleLayers}
          hiddenCommunities={hiddenCommunities}
          onYearChange={setYearRange}
          onLayerToggle={toggleLayer}
          onCommunityToggle={toggleCommunity}
          onNodeFocus={setFocusNodeId}
          onSearchNodeSelect={(node) =>
            selectInspectionNode(node, { kind: "main" })
          }
          onInspectorNodeSelect={(node) =>
            selectInspectionNode(node, inspectionSource ?? { kind: "main" })
          }
          onInspectorClose={clearInspection}
          onMinSupportChange={setMinSupport}
          onResetFilters={handleResetFilters}
          showCitations={showCitations}
          onCitationsChange={setShowCitations}
          subgraphCenterId={
            subgraphState?.kind === "node"
              ? subgraphState.centerNodeId
              : undefined
          }
          onEnterSubgraph={handleEnterSubgraph}
          onExitSubgraph={handleExitSubgraph}
          onSearchKeyword={handleSearchKeyword}
        />
      </div>
    </div>
  );
}
