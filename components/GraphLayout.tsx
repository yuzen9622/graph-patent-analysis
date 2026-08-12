"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	BarChart2,
	Copy,
	Check,
	Download,
	FileText,
	ImageDown,
	GitCompare,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Sidebar from "./Sidebar";
import AnalysisHistorySidebar from "./AnalysisHistorySidebar";
import GraphLegend from "./GraphLegend";
import CompareSetupPanel from "./CompareSetupPanel";
import CompareSummary from "./CompareSummary";
import DiffLegend from "./DiffLegend";
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
	membershipHiddenIds,
	scopesEqual,
	suggestCompareScopes,
	type DiffMembership,
} from "@/lib/graph-compare";
import {
	compareAnnotationLines,
	compareExportFilename,
	compareLegendItems,
	scopeLabel,
	COMPARE_TITLE,
	type CommonFilterInput,
	type CompareViewTab,
} from "@/lib/compare-export";
import { composeCompareImage } from "@/lib/compare-image";
import type { GraphViewport } from "@/lib/graph-viewport";
import type { PositionSnapshotProvider } from "@/lib/export-positions";
import { subgraphNodeIds } from "@/lib/publication-export";
import { TEMPORAL_OPACITY_LINE } from "@/lib/temporal";
import { useDebouncedValue } from "@/lib/use-debounced-value";
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

/** 比較工作區：off（單一檢視）→ setup（選 A/B 範圍）→ active（比較中）。 */
type CompareUiState = "off" | "setup" | "active";

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
	// A/B 比較工作區：同一份分析裡，A（左）、B（右）各自選來源檔子集；
	// 其餘篩選條件（年份/單位/顏色/IPC…）共用，只有來源檔各自獨立。
	const [compareUi, setCompareUi] = useState<CompareUiState>("off");
	const compareMode = compareUi === "active";
	const [compareView, setCompareView] =
		useState<CompareViewTab>("side-by-side");
	const [sourceFilesRight, setSourceFilesRight] = useState<string[]>([]);
	const [setupLeft, setSetupLeft] = useState<string[]>([]);
	const [setupRight, setSetupRight] = useState<string[]>([]);
	const [hiddenMemberships, setHiddenMemberships] = useState<
		Set<DiffMembership>
	>(new Set());
	// 並排時兩側共用的視窗；GraphViewer 內部會把等價的更新回彈掉，不會互推。
	const [compareViewport, setCompareViewport] = useState<GraphViewport | null>(
		null,
	);
	const [ipcLevel, setIpcLevel] = useState<IpcLevel>(DEFAULT_IPC_LEVEL);
	const [ipcFilter, setIpcFilter] = useState<string[]>([]);
	// 分析範圍中位年／全史中位年切換已移除（PRD：時序 UI mode 未實作，畫面幾乎無變化）；固定用分析範圍。
	const temporalReference = "active" as const;
	const [showCitations, setShowCitations] = useState(false);
	const [paperMode, setPaperMode] = useState(false);
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
	const imageCaptureLeftRef = useRef<ImageCapture | null>(null);
	const imageCaptureRightRef = useRef<ImageCapture | null>(null);
	const [imageLeftReady, setImageLeftReady] = useState(false);
	const [imageRightReady, setImageRightReady] = useState(false);
	const [imageExporting, setImageExporting] = useState(false);
	const [imageExportError, setImageExportError] = useState<string | null>(null);
	const imageExportReady =
		compareMode && compareView === "side-by-side"
			? imageLeftReady && imageRightReady
			: imageLeftReady;
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

	const handleImageCaptureReadyLeft = useCallback(
		(capture: ImageCapture | null) => {
			imageCaptureLeftRef.current = capture;
			setImageLeftReady(capture !== null);
		},
		[],
	);

	const handleImageCaptureReadyRight = useCallback(
		(capture: ImageCapture | null) => {
			imageCaptureRightRef.current = capture;
			setImageRightReady(capture !== null);
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

	const layoutSnapshotKey = useMemo(
		() => JSON.stringify({ ...sharedViewOptions, sourceFiles }),
		[sharedViewOptions, sourceFiles],
	);
	const layoutSnapshotKeyRight = useMemo(
		() =>
			JSON.stringify({ ...sharedViewOptions, sourceFiles: sourceFilesRight }),
		[sharedViewOptions, sourceFilesRight],
	);
	const layoutSnapshotKeyDiff = useMemo(
		() =>
			JSON.stringify({
				...sharedViewOptions,
				compare: "difference",
				sourceFiles,
				sourceFilesRight,
			}),
		[sharedViewOptions, sourceFiles, sourceFilesRight],
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
		if (parsed.paperMode) setPaperMode(parsed.paperMode);
		if (parsed.yearRange) setYearRange(parsed.yearRange);
		if (parsed.sourceFilesRight) setSourceFilesRight(parsed.sourceFilesRight);
		if (parsed.compareView) setCompareView(parsed.compareView);
		// 只有一個來源檔（或兩側有效範圍相同）時比較無意義，這時就回到一般檢視。
		if (
			parsed.compare &&
			allSourceFiles.length > 1 &&
			!scopesEqual(parsed.sourceFiles, parsed.sourceFilesRight, allSourceFiles)
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
			paperMode,
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
			sourceFilesRight,
		});
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}?${query}`,
		);
	}, [
		mode,
		colorMode,
		showSemantic,
		minSupport,
		paperMode,
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
		sourceFilesRight,
	]);

	const view = useMemo(
		() => selectGraphView(graph, { ...sharedViewOptions, sourceFiles }),
		[graph, sharedViewOptions, sourceFiles],
	);
	const viewRight = useMemo(
		() =>
			compareMode
				? selectGraphView(graph, {
						...sharedViewOptions,
						sourceFiles: sourceFilesRight,
					})
				: null,
		[compareMode, graph, sharedViewOptions, sourceFilesRight],
	);
	// 差異（聯集）檢視：節點⁃邊都是複本，不會動到 view / viewRight 本身。
	const difference = useMemo(
		() =>
			compareMode && viewRight ? buildDifferenceView(view, viewRight) : null,
		[compareMode, view, viewRight],
	);
	const membershipHidden = useMemo(
		() =>
			difference ? membershipHiddenIds(difference, hiddenMemberships) : null,
		[difference, hiddenMemberships],
	);
	const compareLabels = useMemo(
		() => ({
			a: scopeLabel(sourceFiles, allSourceFiles),
			b: scopeLabel(sourceFilesRight, allSourceFiles),
		}),
		[allSourceFiles, sourceFiles, sourceFilesRight],
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
		const suggestion = suggestCompareScopes(
			allSourceFiles,
			sourceFiles,
			sourceFilesRight,
		);
		setSetupLeft(suggestion.left);
		setSetupRight(suggestion.right);
		setCompareUi("setup");
	}, [allSourceFiles, sourceFiles, sourceFilesRight]);

	const startCompare = useCallback(() => {
		// `CompareSetupPanel` 已停用無效按鈕；這層仍守住不變量，避免日後呼叫端略過 UI。
		if (scopesEqual(setupLeft, setupRight, allSourceFiles)) return;
		setSourceFiles(setupLeft);
		setSourceFilesRight(setupRight);
		setHiddenMemberships(new Set());
		setCompareViewport(null);
		setImageRightReady(false);
		setImageExportError(null);
		setCompareUi("active");
	}, [allSourceFiles, setupLeft, setupRight]);

	const exitCompare = useCallback(() => {
		setCompareUi("off");
		setCompareViewport(null);
		setImageRightReady(false);
		setImageExportError(null);
	}, []);

	const swapCompareScopes = useCallback(() => {
		setSourceFiles(sourceFilesRight);
		setSourceFilesRight(sourceFiles);
	}, [sourceFiles, sourceFilesRight]);

	// 活躍比較期間仍可從側欄調整 A/B；若調成同一有效範圍，就回到設定面板，
	// 讓使用者看見並修正，而不是默默顯示兩張相同的圖。
	const updateActiveCompareScope = useCallback(
		(side: "left" | "right", next: string[]) => {
			const nextLeft = side === "left" ? next : sourceFiles;
			const nextRight = side === "right" ? next : sourceFilesRight;
			if (scopesEqual(nextLeft, nextRight, allSourceFiles)) {
				setSetupLeft(nextLeft);
				setSetupRight(nextRight);
				setCompareUi("setup");
				return;
			}
			if (side === "left") setSourceFiles(next);
			else setSourceFilesRight(next);
		},
		[allSourceFiles, sourceFiles, sourceFilesRight],
	);

	const swapSetupScopes = useCallback(() => {
		setSetupLeft(setupRight);
		setSetupRight(setupLeft);
	}, [setupLeft, setupRight]);

	const changeCompareView = useCallback((tab: CompareViewTab) => {
		setCompareView(tab);
		setCompareViewport(null);
		setImageRightReady(false);
		setImageExportError(null);
	}, []);

	const toggleMembership = useCallback((membership: DiffMembership) => {
		setHiddenMemberships((prev) => {
			const next = new Set(prev);
			if (next.has(membership)) next.delete(membership);
			else next.add(membership);
			return next;
		});
	}, []);

	const handleExportImage = useCallback(async () => {
		const left = imageCaptureLeftRef.current?.();
		if (!left) return;
		setImageExporting(true);
		setImageExportError(null);
		try {
			if (!compareMode || !difference) {
				downloadDataUrl(left, `patent-graph-${jobId.slice(0, 8)}.png`);
				return;
			}
			const panels =
				compareView === "difference"
					? [{ label: "差異（聯集）檢視", dataUrl: left }]
					: [{ label: `A（左）· ${compareLabels.a}`, dataUrl: left }];
			if (compareView === "side-by-side") {
				const right = imageCaptureRightRef.current?.();
				if (!right) throw new Error("右圖尚未就緒");
				panels.push({ label: `B（右）· ${compareLabels.b}`, dataUrl: right });
			}
			const dataUrl = await composeCompareImage({
				title: COMPARE_TITLE,
				annotationLines: compareAnnotationLines({
					...commonFilters,
					aLabel: compareLabels.a,
					bLabel: compareLabels.b,
					metrics: difference.metrics,
					tab: compareView,
				}),
				legend: compareLegendItems(),
				panels,
			});
			downloadDataUrl(
				dataUrl,
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
	]);

	const selectedViewNode = selectedNode
		? (view.nodes.find((node) => node.id === selectedNode.id) ??
			viewRight?.nodes.find((node) => node.id === selectedNode.id) ??
			null)
		: null;
	const selectedViewEdge = selectedEdge
		? (view.edges.find((edge) => edge.id === selectedEdge.id) ??
			viewRight?.edges.find((edge) => edge.id === selectedEdge.id) ??
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

	const selectMode = useCallback((nextMode: GraphMode) => {
		setMode(nextMode);
		setSelectedNode(null);
		setSelectedEdge(null);
	}, []);

	// 差異檢視只有一張圖，凍結座標來自那張；其餘情況沿用左圖。
	const compareHtmlExport = compareMode && compareView === "difference";
	const activeSnapshotKey = compareHtmlExport
		? layoutSnapshotKeyDiff
		: layoutSnapshotKey;
	const offlineExportBlocked = compareMode && !compareHtmlExport;
	const exportReady =
		hasPositionSnapshotProvider && readyKey === activeSnapshotKey;

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
	if (showCitations) exportQuery.set("citations", "1");
	if (ipcLevel !== DEFAULT_IPC_LEVEL)
		exportQuery.set("ipcLevel", String(ipcLevel));
	for (const key of ipcFilter) exportQuery.append("ipc", key);
	if (compareHtmlExport) {
		exportQuery.set("compare", "1");
		for (const source of sourceFilesRight)
			exportQuery.append("rightSource", source);
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

	/** 重設所有篩選（年份／來源檔／IPC／門檻／圖層／社群／引用線）。 */
	const handleResetFilters = useCallback(() => {
		setYearRange(graph.stats.year_range);
		setMinSupport(1);
		setIpcFilter([]);
		setShowCitations(false);
		setVisibleLayers(new Set<NodeType>(["applicant", "patent", "concept"]));
		setHiddenCommunities(new Set());
		setSourceFiles([]);
		setSourceFilesRight([]);
	}, [graph.stats.year_range]);

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
					<div
						className="inline-flex rounded-md border border-border bg-background p-0.5"
						aria-label="圖譜模式"
					>
						{(
							[
								["concept", "技術概念網路"],
								["context", "專利脈絡圖"],
								["institution", "機構網絡"],
							] as const
						).map(([value, label]) => (
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
						onClick={() =>
							compareUi === "off" ? openCompareSetup() : exitCompare()
						}
						disabled={allSourceFiles.length <= 1}
						aria-pressed={compareUi !== "off"}
						title={
							allSourceFiles.length <= 1
								? "此分析只有一個來源檔，無法比較"
								: "設定 A/B 來源檔範圍並比較"
						}
						className={`inline-flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
							compareUi !== "off"
								? "bg-primary text-primary-foreground border-primary"
								: "bg-background border-border text-foreground hover:bg-accent"
						}`}
					>
						<GitCompare size={12} />
						A/B 比較
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
						disabled={!exportReady || exporting || offlineExportBlocked}
						title={
							offlineExportBlocked
								? "並排檢視無法匯出離線 HTML，請先切到「差異」檢視"
								: (exportError ??
									(exportReady ? "下載離線 HTML 圖譜" : "等待圖譜佈局完成"))
						}
						className={`inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground transition-colors duration-150 ${
							!exportReady || exporting || offlineExportBlocked
								? "cursor-not-allowed opacity-50"
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
					</button>
					<button
						type="button"
						onClick={() => void handleExportImage()}
						disabled={!imageExportReady || imageExporting}
						title={
							imageExportReady
								? compareMode
									? "下載帶標題、A/B 來源、共用篩選與指標的比較 PNG"
									: "下載目前畫面的 PNG 圖片"
								: "等待圖譜佈局完成"
						}
						className={`inline-flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground transition-colors duration-150 ${
							!imageExportReady || imageExporting
								? "cursor-not-allowed opacity-50"
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
					</button>
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
					{(exportError || imageExportError || publicationError) && (
						<span
							role="status"
							title={
								exportError ?? imageExportError ?? publicationError ?? undefined
							}
							className="max-w-28 truncate text-xs text-destructive"
						>
							{exportError ?? imageExportError ?? publicationError}
						</span>
					)}
					{!exportError &&
						!imageExportError &&
						!publicationError &&
						publicationNotice && (
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
				<div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
					{compareMode && difference && (
						<CompareSummary
							aLabel={compareLabels.a}
							bLabel={compareLabels.b}
							filters={commonFilters}
							metrics={difference.metrics}
							tab={compareView}
							onTabChange={changeCompareView}
							onSwap={swapCompareScopes}
							onExit={exitCompare}
						/>
					)}
					<div className="relative flex flex-1 min-w-0 overflow-hidden">
						{compareUi === "setup" && (
							<CompareSetupPanel
								allSourceFiles={allSourceFiles}
								left={setupLeft}
								right={setupRight}
								onLeftChange={setSetupLeft}
								onRightChange={setSetupRight}
								onSwap={swapSetupScopes}
								onCancel={exitCompare}
								onStart={startCompare}
							/>
						)}
						{compareMode &&
						compareView === "difference" &&
						difference &&
						membershipHidden ? (
							<div className="relative min-w-0 flex-1 overflow-hidden">
								<GraphViewer
									nodes={difference.view.nodes}
									edges={difference.view.edges}
									citationEdges={difference.view.citationEdges}
									onNodeSelect={setSelectedNode}
									onEdgeSelect={setSelectedEdge}
									positionSnapshotKey={layoutSnapshotKeyDiff}
									onPositionSnapshotProvider={handlePositionSnapshotProvider}
									onImageCaptureReady={handleImageCaptureReadyLeft}
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
								/>
							</div>
						) : (
							<>
								<div
									className={`relative min-w-0 overflow-hidden flex-1 ${
										compareMode ? "border-r border-border" : ""
									}`}
								>
									{compareMode && (
										<div className="absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-[0.65rem] text-muted-foreground backdrop-blur-sm">
											<span className="font-medium text-foreground">
												A（左）
											</span>
											{" · "}
											{compareLabels.a}
											{" · "}
											{view.stats.applicant_count} 家 ·{" "}
											{view.stats.patent_count} 篇
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
										viewport={compareMode ? compareViewport : undefined}
										onViewportChange={
											compareMode ? setCompareViewport : undefined
										}
										yearRange={yearRange}
										edgeWeight={edgeWeight}
										unit={unit}
										visibleLayers={viewerLayers}
										hiddenCommunities={viewerHiddenCommunities}
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
											<span className="font-medium text-foreground">
												B（右）
											</span>
											{" · "}
											{compareLabels.b}
											{" · "}
											{viewRight.stats.applicant_count} 家 ·{" "}
											{viewRight.stats.patent_count} 篇
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
								)}
							</>
						)}
					</div>
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
						maxSupport={
							viewRight
								? Math.max(view.maxSupport, viewRight.maxSupport)
								: view.maxSupport
						}
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
						onResetFilters={handleResetFilters}
						showCitations={showCitations}
						onCitationsChange={setShowCitations}
					/>
				)}
			</div>
		</div>
	);
}
