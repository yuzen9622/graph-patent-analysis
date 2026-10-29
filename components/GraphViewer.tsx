"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { Network } from "vis-network";
import { captureNetworkImage } from "@/lib/network-image";
import {
	buildLayoutInput,
	seedPositions,
	stableUnit,
} from "@/lib/graph-layout/input";
import { startGraphLayout } from "@/lib/graph-layout/client";
import { fallbackGrid, layoutBounds } from "@/lib/graph-layout/geometry";
import type { LayoutSource, CompletedLayout } from "@/lib/graph-layout/types";
import type {
	GraphNode,
	GraphEdge,
	CitationEdge,
	NodeType,
	GraphAnalysis,
	GodNode,
	SurprisingConnection,
} from "@/types/graph";
import { Button } from "@/components/ui/button";
import {
	graphViewportsEqual,
	isValidGraphViewport,
	shouldRestoreViewport,
	type GraphViewport,
} from "@/lib/graph-viewport";
import type { EdgeWeightMetric, Unit } from "@/lib/graph-view";
import { nodeTooltipLines } from "@/lib/node-tooltip";
import type {
	FrozenPositions,
	PositionSnapshotProvider,
} from "@/lib/export-positions";
import {
	computeDegrees,
	mmToPixels,
	primaryLabelCap,
	PRINT_DIM_EDGE_OPACITY,
	PRINT_DPI,
	PRINT_EDGE_SCALE,
	PRINT_NODE_SCALE,
	selectPrimaryLabels,
	subgraphNodeIds,
	type PublicationDpi,
	type PublicationLabelMode,
	type PublicationWidthMm,
} from "@/lib/publication-export";
import {
	fingerprintTopology,
	inheritPositions,
	revealSchedule,
} from "@/lib/graph-render";

/** PRD-Q8 出版整體圖（M1）／局部子圖（M2）共用的匯出選項。 */
export interface PublicationFigureOptions {
	/** 缺省 'overview'（M1）；'subgraph'（M2）需另帶 centerNodeId。 */
	mode?: "overview" | "subgraph";
	widthMm: PublicationWidthMm;
	dpi?: PublicationDpi;
	/** M2 子圖一律視為 'all'（規格：子圖是唯一允許全標籤的場合），此欄位在該模式下被忽略。 */
	labelMode: PublicationLabelMode;
	/** M2 子圖中心節點 id；mode='subgraph' 時必填，否則忽略。 */
	centerNodeId?: string;
	/** M2 子圖 hop 半徑，缺省 2。 */
	hops?: 1 | 2;
	/** 圖片下方的說明文字（每個元素一行），例如樣本數/單位/座標免責聲明。 */
	caption?: string[];
}
export interface PublicationFigureResult {
	dataUrl: string;
	/** 依 labelMode 打算標的節點數（'none' 恆為 0）。 */
	requestedLabels: number;
	/** 實際成功放上去的標籤數——碰撞避讓會讓兩者不相等，呼叫端應把差額回報給使用者。 */
	placedLabels: number;
}
export type PublicationCapture = (
	options: PublicationFigureOptions,
) => PublicationFigureResult | null;

/** 高解析度圖片匯出：回傳目前畫面的 PNG data URL（白底），或 null（尚未就緒）。 */
export type ImageCapture = () => string | null;

// ── Performance thresholds ────────────────────────────────────────────────────
// LARGE: shadows off, hideEdgesOnDrag on
// HUGE:  straight edges, hover off, hideEdgesOnZoom on, clustering
const LARGE_GRAPH = 120;
const HUGE_GRAPH = 350;

// ── DataSet update types ──────────────────────────────────────────────────────

type NodeUpdate = {
	id: string;
	[key: string]: unknown;
};
type EdgeColorProp = { inherit: "from"; opacity?: number };
type EdgeUpdate = { id: string; [key: string]: unknown };
type NodeDataSet = { update: (items: NodeUpdate[]) => void };
type EdgeDataSet = {
	update: (items: EdgeUpdate[]) => void;
	getIds: () => string[];
	remove: (ids: string[]) => void;
};

// ── vis-network helpers ───────────────────────────────────────────────────────

function buildTitle(n: GraphNode, unit: Unit, godInfo?: GodNode): string {
	const base = nodeTooltipLines(n, unit).join("\n");
	return godInfo ? `${base}\n🔥 樞紐節點（degree: ${godInfo.degree}）` : base;
}

function toVisNode(
	n: GraphNode,
	unit: Unit,
	pos?: { x: number; y: number },
	godInfo?: GodNode,
) {
	const isApplicant = n.type === "applicant";
	const isPatent = n.type === "patent";

	// Handle color being a string or an object
	let bgColor = "#BAB0AC";
	let borderColor = "#BAB0AC";
	let highlightBg = "#6B9CC3";
	let highlightBorder = "#6B9CC3";

	if (typeof n.color === "string") {
		bgColor = n.color;
		const baseColor = n.color.length === 9 ? n.color.slice(0, 7) : n.color;
		borderColor = baseColor;
		highlightBg = n.color;
		highlightBorder = baseColor;
	} else if (n.color && typeof n.color === "object") {
		const colorObj = n.color as {
			background?: string;
			border?: string;
			highlight?: { background?: string; border?: string };
		};
		bgColor = colorObj.background ?? bgColor;
		borderColor = colorObj.border ?? borderColor;
		if (colorObj.highlight) {
			highlightBg = colorObj.highlight.background ?? highlightBg;
			highlightBorder = colorObj.highlight.border ?? highlightBorder;
		} else {
			highlightBg = bgColor;
			highlightBorder = borderColor;
		}
	}

	const nodeFont = (n as { font?: unknown }).font as
		| { size?: number; color?: string }
		| undefined;
	const fontSize =
		nodeFont?.size !== undefined
			? nodeFont.size
			: isApplicant
				? 14
				: isPatent
					? 0
					: 11;
	const fontColor = nodeFont?.color !== undefined ? nodeFont.color : "#000000";

	const shape = n.shape ?? (isApplicant ? "star" : "dot");

	return {
		id: n.id,
		label: isApplicant ? n.label : isPatent ? "" : n.label,
		title: buildTitle(n, unit, godInfo),
		shape: shape,
		size: n.size,
		borderWidth: godInfo ? 4 : undefined,
		color: {
			background: bgColor,
			border: godInfo ? "#FFD700" : borderColor,
			highlight: {
				background: highlightBg,
				border: godInfo ? "#FFD700" : highlightBorder,
			},
			hover: {
				background: highlightBg,
				border: godInfo ? "#FFD700" : highlightBorder,
			},
		},
		font: {
			color: fontColor,
			size: fontSize,
			face: "Atkinson Hyperlegible, sans-serif",
		},
		...(pos ?? {}),
	};
}

function toVisEdge(
	e: GraphEdge,
	surprising?: SurprisingConnection,
	edgeWeight: EdgeWeightMetric = "jaccard",
	unit: Unit = "patent",
) {
	const isCooccurrence = e.kind === "cooccurrence";
	const isSemantic = e.kind === "semantic";
	const isInstitution = e.kind === "institution";
	const supportLine = isCooccurrence
		? `共同出現：${e.support_count ?? 0} 篇 / ${e.support_applicants ?? 0} 家
` +
			`Jaccard：篇 ${(e.jaccard ?? 0).toFixed(3)} ｜ 家 ${fmt(e.jaccard_applicants)}
` +
			`NPMI：篇 ${fmt(e.npmi)} ｜ 家 ${fmt(e.npmi_applicants)}`
		: "";
	const semanticLine = isSemantic
		? `LLM 語意關係：${e.relation}\n目前保存來源：${e.source_patents?.length ?? 0} 篇`
		: "";
	const institutionLine = isInstitution
		? `共享概念：${e.support_count ?? 0} 個\n${(e.shared_concepts ?? []).slice(0, 6).join("、")}${(e.shared_concepts?.length ?? 0) > 6 ? ` …共 ${e.shared_concepts!.length} 個` : ""}`
		: "";
	const surprisingLine = surprising ? "\n跨社群罕見橋接" : "";
	const citationLine = e.citation_direction_conflict
		? "\n⚠ 引用方向與中位年排序衝突"
		: e.citation_supported
			? "\n引用支持"
			: "";
	const title =
		`${supportLine}${semanticLine}${institutionLine}${surprisingLine}${citationLine}` ||
		e.relation;

	return {
		id: e.id,
		from: e.from,
		to: e.to,
		label: isSemantic
			? e.relation
			: e.citation_direction_conflict
				? "⚠"
				: e.citation_supported
					? "引用"
					: "",
		title,
		dashes:
			e.dashes !== undefined
				? e.dashes
				: isSemantic
					? ([6, 4] as [number, number])
					: undefined,
		width: isCooccurrence
			? cooccurrenceWidth(e, edgeWeight, unit)
			: isInstitution
				? Math.min(8, 1 + Math.sqrt(e.support_count ?? 1) * 1.4)
				: isSemantic
					? 1.5
					: 1,
		color: e.color
			? { color: e.color, opacity: e.opacity ?? 1 }
			: surprising
				? { color: "#FF6B35", opacity: e.opacity ?? 1 }
				: isSemantic
					? { color: "#8B5CF6", opacity: e.opacity ?? 1 }
					: isInstitution
						? { color: "#0f766e", opacity: e.opacity ?? 1 }
						: isCooccurrence
							? { color: "#64748B", opacity: e.opacity ?? 1 }
							: { color: "#94A3B8", opacity: e.opacity ?? 1 },
		arrows: {
			to: {
				enabled: isSemantic || e.temporal_directed || e.kind === "structural",
				scaleFactor: 0.4,
			},
		},
		font: { size: 9, color: "rgb(115, 115, 115)", strokeWidth: 0 },
		// Semantic relations are an evidence overlay and must not alter layout.
		physics: !(isSemantic || isInstitution),
		// smooth is controlled globally via options — not set per-edge
		// so that perf-adaptive global setting takes effect
	};
}

function fmt(value: number | undefined): string {
	return value === undefined ? "—" : value.toFixed(3);
}

/** 線寬用有界指標（意圖決策 2）：jaccard（預設）或 NPMI（p_ij=1 → 不顯示）。 */
function cooccurrenceWidth(
	e: GraphEdge,
	metric: EdgeWeightMetric,
	unit: Unit = "patent",
): number {
	if (metric === "npmi") {
		const v = Math.max(
			0,
			unit === "applicant" ? (e.npmi_applicants ?? 0) : (e.npmi ?? 0),
		);
		return Math.min(8, 1 + v * 7);
	}
	const j =
		unit === "applicant" ? (e.jaccard_applicants ?? 0) : (e.jaccard ?? 0);
	return Math.min(8, 1 + j * 7);
}

function toVisCitationEdge(edge: CitationEdge) {
	return {
		id: `citation:${edge.id}`,
		from: edge.from,
		to: edge.to,
		title: `引用證據：順向 ${edge.forward_count} ／反向 ${edge.reverse_count}${edge.direction_conflict ? "\n與中位年排序方向衝突" : ""}`,
		dashes: [4, 5] as [number, number],
		width: 1.5,
		color: {
			color: edge.direction_conflict ? "#dc2626" : "#2563eb",
			opacity: 1,
		},
		arrows: { to: { enabled: true, scaleFactor: 0.35 } },
		physics: false,
	};
}

function fontColorWithOpacity(color: string, opacity: number): string {
	const clampedOpacity = Math.max(0, Math.min(1, opacity));
	if (clampedOpacity === 1) return color;
	const rawHex = color.trim().replace(/^#/, "");
	if (/^[0-9a-f]{3,4}$/i.test(rawHex)) {
		const expanded = rawHex
			.split("")
			.map((part) => `${part}${part}`)
			.join("");
		const red = Number.parseInt(expanded.slice(0, 2), 16);
		const green = Number.parseInt(expanded.slice(2, 4), 16);
		const blue = Number.parseInt(expanded.slice(4, 6), 16);
		const alpha =
			(expanded.length === 8
				? Number.parseInt(expanded.slice(6, 8), 16) / 255
				: 1) * clampedOpacity;
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}
	if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(rawHex)) {
		const red = Number.parseInt(rawHex.slice(0, 2), 16);
		const green = Number.parseInt(rawHex.slice(2, 4), 16);
		const blue = Number.parseInt(rawHex.slice(4, 6), 16);
		const alpha =
			(rawHex.length === 8
				? Number.parseInt(rawHex.slice(6, 8), 16) / 255
				: 1) * clampedOpacity;
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}
	const rgb = color.match(
		/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
	);
	if (rgb) {
		const alpha = (rgb[4] ? Number(rgb[4]) : 1) * clampedOpacity;
		return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
	}
	// The app's current font colours are hex/RGB. Keep a safe transparent fallback
	// for any future CSS colour syntax and restore the original at completion.
	return `rgba(0, 0, 0, ${clampedOpacity})`;
}

function edgeColorWithOpacity(
	color: { color: string; opacity?: number },
	opacity: number,
) {
	return {
		...color,
		opacity: (color.opacity ?? 1) * Math.max(0, Math.min(1, opacity)),
	};
}

const CAPTION_FONT_PX = 30;
const CAPTION_LINE_HEIGHT_PX = 40;

function intersects(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
): boolean {
	return !(
		a.x + a.w < b.x ||
		b.x + b.w < a.x ||
		a.y + a.h < b.y ||
		b.y + b.h < a.y
	);
}

/**
 * PRD-Q8 出版整體圖（M1）／局部子圖（M2）：讀目前穩定的佈局座標；M1 依 §4 主要
 * 概念判定挑標籤，M2 一律全標（規格：子圖是唯一允許全標籤的場合）；§5 貪婪碰撞
 * 避讓保證任兩個標籤不重疊；§6 print-scale 放大節點/線寬，並疊上既有的
 * support-strength 邊透明度（`lib/temporal.ts` 的 τ=5 heuristic，非另立新指標）；
 * 輸出白底 PNG（mm 圖幅 × dpi）。不重跑 layout，不落地標籤分級到資料庫。
 * 未做：像素級視覺驗收（封鎖判斷在呼叫端 lib/publication-export.ts 的
 * isFullLabelBlocked 先示警，實際是否產生交給使用者 opt-in）。
 */
function renderPublicationFigure(
	network: Network,
	allNodes: GraphNode[],
	allEdges: GraphEdge[],
	options: PublicationFigureOptions,
): PublicationFigureResult | null {
	const positions = network.getPositions();

	// M2：把檢視收斂成中心節點 hops 步以內的子圖；其餘照 M1 overview 處理。
	const isSubgraph = options.mode === "subgraph" && !!options.centerNodeId;
	const subgraphIds = isSubgraph
		? subgraphNodeIds(options.centerNodeId!, allEdges, options.hops ?? 2)
		: null;
	const nodes = subgraphIds
		? allNodes.filter((n) => subgraphIds.has(n.id))
		: allNodes;
	const edges = subgraphIds
		? allEdges.filter((e) => subgraphIds.has(e.from) && subgraphIds.has(e.to))
		: allEdges;
	// §2 M2：子圖一律全標籤，忽略面板選的 labelMode。
	const labelMode: PublicationLabelMode = isSubgraph
		? "all"
		: options.labelMode;

	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const visibleIds = nodes.map((n) => n.id).filter((id) => positions[id]);
	if (visibleIds.length === 0) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const id of visibleIds) {
		const p = positions[id];
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	const maxRadius = Math.max(
		1,
		...visibleIds.map(
			(id) => ((nodeById.get(id)?.size ?? 10) / 2) * PRINT_NODE_SCALE,
		),
	);
	const pad = maxRadius + 60;
	minX -= pad;
	maxX += pad;
	minY -= pad;
	maxY += pad;
	const worldW = Math.max(1, maxX - minX);
	const worldH = Math.max(1, maxY - minY);

	const targetWpx = mmToPixels(options.widthMm, options.dpi ?? PRINT_DPI);
	const scale = targetWpx / worldW;
	const graphHpx = Math.round(worldH * scale);
	const footerHpx = options.caption?.length
		? 24 + options.caption.length * CAPTION_LINE_HEIGHT_PX
		: 0;

	const canvas = document.createElement("canvas");
	canvas.width = targetWpx;
	canvas.height = graphHpx + footerHpx;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const toCanvas = (x: number, y: number) => ({
		x: (x - minX) * scale,
		y: (y - minY) * scale,
	});

	const degreeMap = computeDegrees(nodes, edges);
	const maxLabels = primaryLabelCap(options.widthMm);
	const primaryIds =
		labelMode === "all"
			? new Set(visibleIds)
			: labelMode === "none"
				? new Set<string>()
				: selectPrimaryLabels(nodes, edges, maxLabels);

	// ── 邊：primary 模式才做透明度分層，其餘模式全部邊維持既有透明度 ──
	// 疊在既有的 support-strength 透明度（edge.opacity，τ=5 heuristic）之上，
	// 不是另立一套跟活體檢視脫鉤的印刷專用指標。
	for (const edge of edges) {
		const a = positions[edge.from];
		const b = positions[edge.to];
		if (!a || !b) continue;
		const pa = toCanvas(a.x, a.y);
		const pb = toCanvas(b.x, b.y);
		const isPrimaryEdge =
			labelMode !== "primary" ||
			(primaryIds.has(edge.from) && primaryIds.has(edge.to));
		const baseWidth =
			edge.kind === "cooccurrence"
				? Math.min(8, 1 + (edge.jaccard ?? 0) * 7)
				: edge.kind === "semantic"
					? 1.5
					: 1;
		const existingOpacity = edge.opacity ?? 1;
		ctx.globalAlpha = isPrimaryEdge
			? 1
			: Math.min(PRINT_DIM_EDGE_OPACITY, existingOpacity);
		ctx.strokeStyle = edge.kind === "semantic" ? "#8B5CF6" : "#64748B";
		ctx.lineWidth = Math.max(0.5, baseWidth * PRINT_EDGE_SCALE * scale);
		ctx.setLineDash(edge.kind === "semantic" ? [6 * scale, 4 * scale] : []);
		ctx.beginPath();
		ctx.moveTo(pa.x, pa.y);
		ctx.lineTo(pb.x, pb.y);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	ctx.globalAlpha = 1;

	// ── 節點 ──
	for (const id of visibleIds) {
		const n = nodeById.get(id);
		if (!n) continue;
		const p = toCanvas(positions[id].x, positions[id].y);
		const radius = Math.max(
			1.5,
			((n.size ?? 10) / 2) * PRINT_NODE_SCALE * scale,
		);
		ctx.beginPath();
		ctx.fillStyle = typeof n.color === "string" ? n.color : "#BAB0AC";
		ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
		ctx.fill();
	}

	// ── 標籤：貪婪碰撞避讓（§5）——依優先序放，量到重疊就跳過（讓給更優先的） ──
	// requestedLabels/placedLabels 讓呼叫端能誠實回報「全部概念」等被自動省略的數量。
	let requestedLabels = 0;
	let placedLabels = 0;
	if (labelMode !== "none") {
		const fontPx = Math.max(9, Math.round(11 * PRINT_NODE_SCALE * scale));
		ctx.font = `${fontPx}px "Atkinson Hyperlegible", sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillStyle = "#0f172a";
		const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
		const labelIds =
			labelMode === "all"
				? [...visibleIds].sort(
						(a, b) =>
							(degreeMap.get(b)?.degree ?? 0) - (degreeMap.get(a)?.degree ?? 0),
					)
				: [...primaryIds];
		requestedLabels = labelIds.length;
		for (const id of labelIds) {
			const n = nodeById.get(id);
			const p = positions[id];
			if (!n || !p) continue;
			const canvasPos = toCanvas(p.x, p.y);
			const radius = Math.max(
				1.5,
				((n.size ?? 10) / 2) * PRINT_NODE_SCALE * scale,
			);
			const textWidth = ctx.measureText(n.label).width;
			const box = {
				x: canvasPos.x - textWidth / 2,
				y: canvasPos.y + radius + 2,
				w: textWidth,
				h: fontPx,
			};
			if (placed.some((existing) => intersects(existing, box))) continue;
			placed.push(box);
			placedLabels += 1;
			ctx.fillText(n.label, canvasPos.x, box.y);
		}
	}

	// ── 說明文字（不隨 scale 縮放，固定 300dpi 字級） ──
	if (options.caption?.length) {
		ctx.font = `${CAPTION_FONT_PX}px "Atkinson Hyperlegible", sans-serif`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillStyle = "#0f172a";
		let y = graphHpx + 12;
		for (const line of options.caption) {
			ctx.fillText(line, 16, y);
			y += CAPTION_LINE_HEIGHT_PX;
		}
	}

	return {
		dataUrl: canvas.toDataURL("image/png"),
		requestedLabels,
		placedLabels,
	};
}

function buildOptions(nodeCount: number) {
	const isLarge = nodeCount >= LARGE_GRAPH;
	const isHuge = nodeCount >= HUGE_GRAPH;

	return {
		nodes: {
			// borderWidth: 0 cuts per-node border stroke in large graphs
			borderWidth: isLarge ? 0 : 1,
			// shadow is very expensive — disable for large graphs
			shadow: isLarge
				? false
				: { enabled: true, size: 5, x: 2, y: 2, color: "rgba(0,0,0,0.6)" },
		},
		edges: {
			color: { inherit: "from" as const, opacity: 1 },
			selectionWidth: 2,
			// "continuous" smooth: canvas-only, no hidden physics nodes (fast).
			// For huge graphs use straight lines — eliminates all curve math.
			smooth: isHuge
				? false
				: { enabled: true, type: "continuous" as const, roundness: 0.2 },
		},
		physics: { enabled: false },
		interaction: {
			hover: !isHuge,
			tooltipDelay: 250,
			navigationButtons: false,
			keyboard: { enabled: true, bindToWindow: false },
			zoomView: true,
			dragView: true,
			// hiding edges during drag/zoom is the single biggest UX win for
			// large graphs — canvas redraws drop from O(E) to O(N) per frame
			hideEdgesOnDrag: isLarge,
			hideEdgesOnZoom: isHuge,
		},
		layout: { improvedLayout: false },
	};
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
	layoutScopeKey?: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
	citationEdges?: CitationEdge[];
	analysis?: GraphAnalysis;
	onNodeSelect?: (node: GraphNode | null) => void;
	yearRange?: [number, number];
	edgeWeight?: EdgeWeightMetric;
	unit?: Unit;
	visibleLayers?: Set<NodeType>;
	hiddenCommunities?: Set<number>;
	focusNodeId?: string;
	onEdgeSelect?: (edge: GraphEdge | null) => void;
	/** 點擊畫布空白處時通知父層取消目前選取。 */
	onSelectionClear?: () => void;
	positionSnapshotKey: string;
	onPositionSnapshotProvider?: (
		provider: PositionSnapshotProvider | null,
	) => void;
	/** PRD-Q8 M1 出版整體圖（見 renderPublicationFigure）：佈局穩定後提供，重建/卸載時回 null。 */
	onCaptureReady?: (capture: PublicationCapture | null) => void;
	/** 高解析度圖片匯出（見 captureNetworkImage）：佈局穩定後提供，重建/卸載時回 null。 */
	onImageCaptureReady?: (capture: ImageCapture | null) => void;
	/** 差異檢視的成員篩選：這些 id 只隱藏、不重算佈局。 */
	hiddenNodeIds?: Set<string>;
	hiddenEdgeIds?: Set<string>;
	/** 比較模式左右同步：外部下達的視窗位置／縮放（與目前值等價時不套用）。 */
	viewport?: GraphViewport | null;
	/** 使用者平移／縮放後回報目前視窗；等價的更新不會重複轉發。 */
	onViewportChange?: (viewport: GraphViewport) => void;
}

export default function GraphViewer({
	layoutScopeKey = "",
	nodes,
	edges,
	citationEdges = [],
	analysis,
	onNodeSelect,
	yearRange,
	edgeWeight = "jaccard",
	unit = "patent",
	visibleLayers,
	hiddenCommunities,
	focusNodeId,
	onEdgeSelect,
	onSelectionClear,
	positionSnapshotKey,
	onPositionSnapshotProvider,
	onCaptureReady,
	onImageCaptureReady,
	hiddenNodeIds,
	hiddenEdgeIds,
	viewport,
	onViewportChange,
}: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const networkRef = useRef<Network | null>(null);
	const nodeDataSetRef = useRef<NodeDataSet | null>(null);
	const edgeDataSetRef = useRef<EdgeDataSet | null>(null);
	const savedScopeRef = useRef<string | null>(null);
	const viewportRef = useRef<GraphViewport | null>(null);
	// 最後一次「已同步」的視窗：外送前與收到指令時都拿它比對，等價就不動作，
	// 這樣 A→B 的移動不會再被 B 反彈回 A。
	const syncedViewportRef = useRef<GraphViewport | null>(null);
	// 篩選（含差異成員）是底層可見性；雙擊的暫時聚焦結束時必須回到這份狀態，
	// 不能把使用者已隱藏的成員重新顯示。
	const baseHiddenNodeIdsRef = useRef<ReadonlySet<string>>(new Set());
	const onViewportChangeRef = useRef(onViewportChange);
	const propsRef = useRef({
		nodes,
		edges,
		citationEdges,
		analysis,
		onNodeSelect,
		yearRange,
		edgeWeight,
		unit,
		visibleLayers,
		hiddenCommunities,
		focusNodeId,
		onEdgeSelect,
		onSelectionClear,
		positionSnapshotKey,
		onPositionSnapshotProvider,
		onCaptureReady,
		onImageCaptureReady,
		hiddenNodeIds,
		hiddenEdgeIds,
		viewport,
		onViewportChange,
	});
	// eslint-disable-next-line react-hooks/refs -- event handlers must always read the latest props.
	propsRef.current = {
		nodes,
		edges,
		citationEdges,
		analysis,
		onNodeSelect,
		yearRange,
		edgeWeight,
		unit,
		visibleLayers,
		hiddenCommunities,
		focusNodeId,
		onEdgeSelect,
		onSelectionClear,
		positionSnapshotKey,
		onPositionSnapshotProvider,
		onCaptureReady,
		onImageCaptureReady,
		hiddenNodeIds,
		hiddenEdgeIds,
		viewport,
		onViewportChange,
	};
	const layoutInput = useMemo(
		() => buildLayoutInput(nodes, edges, layoutScopeKey),
		[nodes, edges, layoutScopeKey],
	);
	const layoutKey = `${layoutInput.fingerprint}:${fingerprintTopology(nodes, edges)}`;
	const lastBuiltLayoutKeyRef = useRef<string | null>(null);
	const nodePositionsCacheRef = useRef(
		new Map<string, { x: number; y: number }>(),
	);
	const revealAnimationFrameRef = useRef<number | null>(null);
	const finishRevealRef = useRef<() => void>(() => {});
	const highlightRef = useRef<{ activeId: string | null }>({ activeId: null });
	const applyHighlightRef = useRef<(nodeId: string) => void>(() => {});
	const clearHighlightRef = useRef<() => void>(() => {});
	const [layoutState, setLayoutState] = useState<{
		key: string;
		status: "computing" | "ready" | "failed";
		revealed: boolean;
		reason?: CompletedLayout["reason"];
		source?: LayoutSource;
	}>({ key: "", status: "computing", revealed: false });
	if (layoutState.key !== layoutKey) {
		setLayoutState({ key: layoutKey, status: "computing", revealed: false });
	}
	const activeLayout =
		layoutState.key === layoutKey
			? layoutState
			: {
					status: "computing" as const,
					revealed: false,
					reason: undefined,
					source: undefined,
				};
	const {
		status: layoutStatus,
		revealed: layoutRevealed,
		reason: layoutReason,
		source: layoutSource,
	} = activeLayout;
	const [layoutGeneration, setLayoutGeneration] = useState(0);

	useEffect(() => {
		onViewportChangeRef.current = onViewportChange;
	}, [onViewportChange]);

	const handleFit = useCallback(() => {
		networkRef.current?.fit({
			animation: { duration: 400, easingFunction: "easeInOutQuad" },
		});
	}, []);

	// ── Build / rebuild when geometry or rendered membership changes ─────────
	useEffect(() => {
		finishRevealRef.current();
		const current = propsRef.current;
		lastBuiltLayoutKeyRef.current = layoutKey;
		highlightRef.current.activeId = null;
		if (process.env.NODE_ENV !== "production") {
			console.debug(
				"[graph] rebuild",
				layoutKey,
				current.nodes.length,
				current.edges.length,
			);
		}
		// A parent must not export a completed layout while this instance rebuilds.
		current.onPositionSnapshotProvider?.(null);
		current.onCaptureReady?.(null);
		current.onImageCaptureReady?.(null);
		if (!containerRef.current) return;
		let cancelled = false;
		let builtNetwork: Network | null = null;
		let clearDataSets = () => {};
		const seeds = seedPositions(current.nodes, current.edges);
		if (nodePositionsCacheRef.current.size > 0) {
			const inherited = inheritPositions(
				current.nodes.map((n) => n.id),
				current.edges,
				nodePositionsCacheRef.current,
				(id, axis) => (stableUnit(`${id}:${axis}`) - 0.5) * 60,
			);
			for (const [id, position] of inherited.positions) seeds.set(id, position);
		}
		const input = buildLayoutInput(
			current.nodes,
			current.edges,
			layoutScopeKey,
			undefined,
			seeds,
		);
		const task = startGraphLayout(input);
		const init = async () => {
			const [outcome, { Network }, { DataSet }] = await Promise.all([
				task.result,
				import("vis-network"),
				import("vis-data"),
			]);
			if (cancelled || !containerRef.current || outcome.status === "cancelled")
				return;
			const failed = outcome.status === "failed";
			const positions =
				outcome.status === "ready"
					? outcome.layout.positions
					: fallbackGrid(input);
			if (failed)
				setLayoutState({ key: layoutKey, status: "failed", revealed: false });
			if (outcome.status === "ready") {
				for (let i = 0; i < input.nodeIds.length; i++)
					nodePositionsCacheRef.current.set(input.nodeIds[i], {
						x: positions[i * 2],
						y: positions[i * 2 + 1],
					});
			}
			const buildProps = propsRef.current;
			const initPos = new Map(
				input.nodeIds.map((id, i) => [
					id,
					{ x: positions[i * 2], y: positions[i * 2 + 1] },
				]),
			);
			const godNodeMap = new Map(
				(buildProps.analysis?.god_nodes ?? []).map((g) => [g.id, g]),
			);
			const surprisingEdgeMap = new Map(
				(buildProps.analysis?.surprising_connections ?? []).map((c) => [
					c.edge_id,
					c,
				]),
			);
			const nodeDataSet = new DataSet(
				buildProps.nodes.map((node) => {
					const visual = toVisNode(
						node,
						buildProps.unit,
						initPos.get(node.id),
						godNodeMap.get(node.id),
					);
					return {
						...visual,
						opacity: 0,
						font: {
							...visual.font,
							color: fontColorWithOpacity(visual.font.color, 0),
						},
					};
				}),
			);
			const edgeVisuals = [
				...buildProps.edges.map((edge) =>
					toVisEdge(
						edge,
						surprisingEdgeMap.get(edge.id),
						buildProps.edgeWeight,
						buildProps.unit,
					),
				),
				...buildProps.citationEdges.map(toVisCitationEdge),
			];
			const edgeDataSet = new DataSet(
				edgeVisuals.map((edge) => ({
					...edge,
					color: edgeColorWithOpacity(edge.color, 0),
				})),
			);
			clearDataSets = () => {
				nodeDataSet.clear();
				edgeDataSet.clear();
			};
			nodeDataSetRef.current = nodeDataSet as unknown as NodeDataSet;
			edgeDataSetRef.current = edgeDataSet as unknown as EdgeDataSet;

			const network = new Network(
				containerRef.current,
				{ nodes: nodeDataSet, edges: edgeDataSet },
				buildOptions(buildProps.nodes.length),
			);
			builtNetwork = network;
			networkRef.current = network;
			setLayoutGeneration((g) => g + 1);
			const container = containerRef.current;
			if (
				shouldRestoreViewport({
					savedScope: savedScopeRef.current,
					scope: layoutScopeKey,
					viewport: viewportRef.current,
					bounds: layoutBounds(positions, input.radii),
					width: container.clientWidth,
					height: container.clientHeight,
				})
			) {
				network.moveTo({ ...viewportRef.current!, animation: false });
			} else {
				network.fit({ animation: false });
			}

			const registerCaptureProviders = () => {
				const latest = propsRef.current;
				latest.onPositionSnapshotProvider?.({
					key: latest.positionSnapshotKey,
					getPositions: () => {
						if (cancelled || networkRef.current !== network) return null;
						const positions: FrozenPositions = Object.fromEntries(
							Object.entries(
								network.getPositions(latest.nodes.map((node) => node.id)),
							).map(([id, position]) => [
								id,
								{ x: position.x, y: position.y },
							]),
						);
						return positions;
					},
				});
				latest.onCaptureReady?.((options) =>
					networkRef.current === network
						? renderPublicationFigure(
								network,
								latest.nodes,
								latest.edges,
								options,
							)
						: null,
				);
				latest.onImageCaptureReady?.(() =>
					!cancelled && networkRef.current === network
						? captureNetworkImage(network)
						: null,
				);
			};

			const startReveal = (short: boolean) => {
				const initial = propsRef.current;
				const degreeById = new Map<string, number>(
					initial.nodes.map((node) => [node.id, 0]),
				);
				initial.edges.forEach((edge) => {
					degreeById.set(edge.from, (degreeById.get(edge.from) ?? 0) + 1);
					degreeById.set(edge.to, (degreeById.get(edge.to) ?? 0) + 1);
				});
				const plan = revealSchedule(
					initial.nodes.map((node) => node.id),
					(id) => degreeById.get(id) ?? 0,
					short || initial.nodes.length >= HUGE_GRAPH
						? { waves: 4, fadeMs: 160 }
						: undefined,
				);
				const completeNodeIds = new Set<string>();
				const edgeStartMs = plan.totalMs * 0.6;
				const edgeFadeMs = Math.max(1, plan.totalMs - edgeStartMs);
				let edgeStep = 0;
				let completed = false;

				const finishReveal = () => {
					if (completed) return;
					completed = true;
					if (revealAnimationFrameRef.current !== null) {
						cancelAnimationFrame(revealAnimationFrameRef.current);
						revealAnimationFrameRef.current = null;
					}
					if (finishRevealRef.current === finishReveal) {
						finishRevealRef.current = () => {};
					}
					if (cancelled || networkRef.current !== network) return;
					const currentProps = propsRef.current;
					const latest =
						`${buildLayoutInput(currentProps.nodes, currentProps.edges, layoutScopeKey).fingerprint}:${fingerprintTopology(currentProps.nodes, currentProps.edges)}` ===
						layoutKey
							? currentProps
							: buildProps;
					const godNodes = new Map(
						(latest.analysis?.god_nodes ?? []).map((godNode) => [
							godNode.id,
							godNode,
						]),
					);
					nodeDataSet.update(
						latest.nodes.map((node) => {
							const visual = toVisNode(
								node,
								latest.unit,
								undefined,
								godNodes.get(node.id),
							);
							return { id: node.id, opacity: 1, font: visual.font };
						}),
					);
					const surprisingEdges = new Map(
						(latest.analysis?.surprising_connections ?? []).map(
							(connection) => [connection.edge_id, connection],
						),
					);
					edgeDataSet.update([
						...latest.edges.map((edge) => ({
							id: edge.id,
							color: toVisEdge(
								edge,
								surprisingEdges.get(edge.id),
								latest.edgeWeight,
								latest.unit,
							).color,
						})),
						...latest.citationEdges.map((edge) => ({
							id: `citation:${edge.id}`,
							color: toVisCitationEdge(edge).color,
						})),
					]);
					setLayoutState({
						key: layoutKey,
						status: failed ? "failed" : "ready",
						revealed: true,
						reason:
							outcome.status === "ready" ? outcome.layout.reason : undefined,
						source: outcome.status === "ready" ? outcome.source : undefined,
					});
					registerCaptureProviders();
				};
				finishRevealRef.current = finishReveal;

				const reduceMotion =
					typeof window !== "undefined" &&
					(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
						false);
				if (reduceMotion || initial.nodes.length === 0) {
					finishReveal();
					return;
				}

				const startedAt = performance.now();
				const frame = (now: number) => {
					if (completed || networkRef.current !== network) return;
					const latest = propsRef.current;
					const elapsed = Math.max(0, now - startedAt);
					const latestNodes = new Map(
						latest.nodes.map((node) => [node.id, node]),
					);
					const godNodes = new Map(
						(latest.analysis?.god_nodes ?? []).map((godNode) => [
							godNode.id,
							godNode,
						]),
					);
					const nodeUpdates: NodeUpdate[] = [];
					for (const [id, startMs] of plan.startMs) {
						const node = latestNodes.get(id);
						if (!node || completeNodeIds.has(id)) continue;
						const opacity = Math.max(
							0,
							Math.min(1, (elapsed - startMs) / (short ? 160 : 240)),
						);
						if (opacity === 0) continue;
						const visual = toVisNode(
							node,
							latest.unit,
							undefined,
							godNodes.get(node.id),
						);
						nodeUpdates.push({
							id,
							opacity,
							font: {
								...visual.font,
								color: fontColorWithOpacity(visual.font.color, opacity),
							},
						});
						if (opacity === 1) completeNodeIds.add(id);
					}
					if (nodeUpdates.length > 0) nodeDataSet.update(nodeUpdates);

					if (elapsed >= edgeStartMs) {
						const nextStep = Math.min(
							10,
							Math.ceil(((elapsed - edgeStartMs) / edgeFadeMs) * 10),
						);
						if (nextStep > edgeStep) {
							edgeStep = nextStep;
							const surprisingEdges = new Map(
								(latest.analysis?.surprising_connections ?? []).map(
									(connection) => [connection.edge_id, connection],
								),
							);
							const edgeOpacity = edgeStep / 10;
							edgeDataSet.update([
								...latest.edges.map((edge) => ({
									id: edge.id,
									color: edgeColorWithOpacity(
										toVisEdge(
											edge,
											surprisingEdges.get(edge.id),
											latest.edgeWeight,
											latest.unit,
										).color,
										edgeOpacity,
									),
								})),
								...latest.citationEdges.map((edge) => ({
									id: `citation:${edge.id}`,
									color: edgeColorWithOpacity(
										toVisCitationEdge(edge).color,
										edgeOpacity,
									),
								})),
							]);
						}
					}

					if (elapsed >= plan.totalMs) {
						finishReveal();
						return;
					}
					revealAnimationFrameRef.current = requestAnimationFrame(frame);
				};
				revealAnimationFrameRef.current = requestAnimationFrame(frame);
			};

			startReveal(outcome.status === "ready" && outcome.source !== "computed");

			// ── 比較模式視窗同步：使用者拖曳⁃縮放後向上回報 ───────────────
			const emitViewport = () => {
				if (cancelled || networkRef.current !== network) return;
				const currentViewport: GraphViewport = {
					position: network.getViewPosition(),
					scale: network.getScale(),
				};
				if (!isValidGraphViewport(currentViewport)) return;
				if (graphViewportsEqual(currentViewport, syncedViewportRef.current))
					return;
				syncedViewportRef.current = currentViewport;
				onViewportChangeRef.current?.(currentViewport);
			};
			network.on("dragEnd", () => {
				if (!failed) {
					const currentPositions = network.getPositions();
					for (const [id, position] of Object.entries(currentPositions)) {
						nodePositionsCacheRef.current.set(id, {
							x: position.x,
							y: position.y,
						});
					}
				}
				emitViewport();
			});
			network.on("zoom", emitViewport);
			// fit() 與 focus() 都用動畫改變視窗而不保證觸發 dragEnd/zoom；
			// 動畫完成時再讀一次，A/B 才能維持同步。
			network.on("animationFinished", emitViewport);

			// ── Highlight: Neighbourhood Highlight (1st & 2nd degree) ───────────
			const DIM_EDGE: EdgeColorProp = { inherit: "from", opacity: 0.05 };
			const DIM_NODE_COLOR = "rgba(200,200,200,0.3)";

			const applyHighlight = (clickedId: string) => {
				if (networkRef.current !== network) return;
				const latest = propsRef.current;
				const degree1 = new Set<string>([clickedId]);
				const degree2 = new Set<string>();
				const activeEdges = new Set<string>();

				// Find 1st degree connections
				latest.edges.forEach((edge) => {
					if (edge.from === clickedId) {
						degree1.add(edge.to);
						activeEdges.add(edge.id);
					} else if (edge.to === clickedId) {
						degree1.add(edge.from);
						activeEdges.add(edge.id);
					}
				});

				// Find 2nd degree connections
				latest.edges.forEach((edge) => {
					if (degree1.has(edge.from) && !degree1.has(edge.to)) {
						degree2.add(edge.to);
						activeEdges.add(edge.id);
					} else if (degree1.has(edge.to) && !degree1.has(edge.from)) {
						degree2.add(edge.from);
						activeEdges.add(edge.id);
					}
				});

				nodeDataSet.update(
					latest.nodes.map((node) => {
						const original = toVisNode(node, latest.unit);
						if (degree1.has(node.id)) {
							return {
								id: node.id,
								color: original.color,
								label: original.label,
								opacity: 1,
							};
						}
						if (degree2.has(node.id)) {
							return {
								id: node.id,
								color: original.color,
								label: original.label,
								opacity: 0.5,
							};
						}
						return {
							id: node.id,
							color: { background: DIM_NODE_COLOR, border: DIM_NODE_COLOR },
							label: "",
							opacity: 0.2,
						};
					}),
				);

				edgeDataSet.update(
					latest.edges.map((edge) => ({
						id: edge.id,
						color: activeEdges.has(edge.id)
							? toVisEdge(edge, undefined, latest.edgeWeight, latest.unit).color
							: DIM_EDGE,
					})),
				);
				highlightRef.current.activeId = clickedId;
			};

			const clearHighlight = () => {
				if (!highlightRef.current.activeId || networkRef.current !== network)
					return;
				const latest = propsRef.current;
				nodeDataSet.update(
					latest.nodes.map((node) => {
						const original = toVisNode(node, latest.unit);
						return {
							id: node.id,
							color: original.color,
							label: original.label,
							opacity: 1,
						};
					}),
				);
				edgeDataSet.update(
					latest.edges.map((edge) => ({
						id: edge.id,
						color: toVisEdge(edge, undefined, latest.edgeWeight, latest.unit)
							.color,
					})),
				);
				highlightRef.current.activeId = null;
			};
			applyHighlightRef.current = applyHighlight;
			clearHighlightRef.current = clearHighlight;

			network.on("click", (params) => {
				finishRevealRef.current();
				const latest = propsRef.current;
				if (params.nodes.length > 0) {
					const nodeId = params.nodes[0] as string;
					latest.onNodeSelect?.(
						latest.nodes.find((node) => node.id === nodeId) ?? null,
					);
					latest.onEdgeSelect?.(null);
					applyHighlight(nodeId);
				} else if (params.edges.length > 0) {
					const edgeId = params.edges[0] as string;
					latest.onNodeSelect?.(null);
					latest.onEdgeSelect?.(
						latest.edges.find((edge) => edge.id === edgeId) ?? null,
					);
					clearHighlight();
				} else {
					latest.onNodeSelect?.(null);
					latest.onEdgeSelect?.(null);
					latest.onSelectionClear?.();
					clearHighlight();
				}
			});

			// Double-click: focus mode (hide non-adjacent).
			// Clear opacity-highlight first to avoid stacked visual states.
			network.on("doubleClick", (params) => {
				finishRevealRef.current();
				clearHighlight();
				const latest = propsRef.current;
				const baseHidden = baseHiddenNodeIdsRef.current;
				if (params.nodes.length === 0) {
					// 退出暫時聚焦時還原篩選結果，而非無條件顯示所有節點。
					nodeDataSet.update(
						latest.nodes.map((node) => ({
							id: node.id,
							hidden: baseHidden.has(node.id),
						})),
					);
					return;
				}
				const clickedId = params.nodes[0] as string;
				const adjacent = new Set<string>([clickedId]);
				latest.edges.forEach((edge) => {
					if (edge.from === clickedId) adjacent.add(edge.to);
					if (edge.to === clickedId) adjacent.add(edge.from);
				});
				nodeDataSet.update(
					latest.nodes.map((node) => ({
						id: node.id,
						hidden: baseHidden.has(node.id) || !adjacent.has(node.id),
					})),
				);
			});
		};

		void init().catch((error) => {
			if (cancelled) return;
			task.cancel();
			finishRevealRef.current();
			builtNetwork?.destroy();
			builtNetwork = null;
			clearDataSets();
			networkRef.current = null;
			nodeDataSetRef.current = null;
			edgeDataSetRef.current = null;
			propsRef.current.onPositionSnapshotProvider?.(null);
			propsRef.current.onCaptureReady?.(null);
			propsRef.current.onImageCaptureReady?.(null);
			setLayoutState({ key: layoutKey, status: "failed", revealed: false });
			console.error("[graph] renderer initialization failed", error);
		});

		return () => {
			cancelled = true;
			task.cancel();
			propsRef.current.onPositionSnapshotProvider?.(null);
			propsRef.current.onCaptureReady?.(null);
			propsRef.current.onImageCaptureReady?.(null);
			finishRevealRef.current();
			if (networkRef.current === builtNetwork && builtNetwork) {
				const viewport = {
					position: builtNetwork.getViewPosition(),
					scale: builtNetwork.getScale(),
				};
				viewportRef.current = isValidGraphViewport(viewport) ? viewport : null;
				savedScopeRef.current = layoutScopeKey;
				builtNetwork.destroy();
				networkRef.current = null;
			}
			clearDataSets();
			nodeDataSetRef.current = null;
			edgeDataSetRef.current = null;
			applyHighlightRef.current = () => {};
			clearHighlightRef.current = () => {};
		};
		// Geometry identity controls rebuilds; appearance and callbacks stay live through propsRef.
	}, [layoutKey, layoutScopeKey]);

	// ── Apply visual-only changes without rebuilding or moving the graph ──────
	useEffect(() => {
		if (lastBuiltLayoutKeyRef.current === layoutKey) {
			lastBuiltLayoutKeyRef.current = null;
			return;
		}
		const nodeDataSet = nodeDataSetRef.current;
		const edgeDataSet = edgeDataSetRef.current;
		if (!networkRef.current || !nodeDataSet || !edgeDataSet) return;

		const godNodeMap = new Map(
			(analysis?.god_nodes ?? []).map((godNode) => [godNode.id, godNode]),
		);
		nodeDataSet.update(
			nodes.map((node) => {
				const visual = toVisNode(
					node,
					unit,
					undefined,
					godNodeMap.get(node.id),
				);
				return {
					id: visual.id,
					label: visual.label,
					title: visual.title,
					shape: visual.shape,
					size: visual.size,
					borderWidth: visual.borderWidth,
					color: visual.color,
					font: visual.font,
				};
			}),
		);

		const surprisingEdgeMap = new Map(
			(analysis?.surprising_connections ?? []).map((connection) => [
				connection.edge_id,
				connection,
			]),
		);
		edgeDataSet.update(
			edges.map((edge) => {
				const visual: EdgeUpdate = {
					...toVisEdge(edge, surprisingEdgeMap.get(edge.id), edgeWeight, unit),
				};
				delete visual.from;
				delete visual.to;
				return visual;
			}),
		);

		const citationVisuals = citationEdges.map(toVisCitationEdge);
		const currentCitationIds = edgeDataSet
			.getIds()
			.filter((id) => id.startsWith("citation:"));
		const wantedCitationIds = new Set(citationVisuals.map((edge) => edge.id));
		if (citationVisuals.length > 0) edgeDataSet.update(citationVisuals);
		const removedCitationIds = currentCitationIds.filter(
			(id) => !wantedCitationIds.has(id),
		);
		if (removedCitationIds.length > 0) edgeDataSet.remove(removedCitationIds);

		if (highlightRef.current.activeId) {
			applyHighlightRef.current(highlightRef.current.activeId);
		}
	}, [nodes, edges, citationEdges, edgeWeight, unit, analysis, layoutKey]);

	// A changed export key must receive the existing stable network, not trigger
	// another layout run.
	useEffect(() => {
		const network = networkRef.current;
		if (!network || !layoutRevealed) return;
		const current = propsRef.current;
		current.onPositionSnapshotProvider?.({
			key: positionSnapshotKey,
			getPositions: () => {
				if (networkRef.current !== network) return null;
				const positions: FrozenPositions = Object.fromEntries(
					Object.entries(
						network.getPositions(current.nodes.map((node) => node.id)),
					).map(([id, position]) => [
						id,
						{ x: position.x, y: position.y },
					]),
				);
				return positions;
			},
		});
		current.onCaptureReady?.((options) =>
			networkRef.current === network
				? renderPublicationFigure(
						network,
						current.nodes,
						current.edges,
						options,
					)
				: null,
		);
		current.onImageCaptureReady?.(() =>
			networkRef.current === network ? captureNetworkImage(network) : null,
		);
	}, [positionSnapshotKey, layoutRevealed, layoutGeneration]);

	// ── 比較模式：套用外部下達的視窗。已經在同一個位置就不動，避免兩側互推。
	useEffect(() => {
		const network = networkRef.current;
		if (!network || !isValidGraphViewport(viewport)) return;
		const current: GraphViewport = {
			position: network.getViewPosition(),
			scale: network.getScale(),
		};
		if (graphViewportsEqual(viewport, current)) return;
		syncedViewportRef.current = viewport;
		network.moveTo({
			position: viewport.position,
			scale: viewport.scale,
			animation: false,
		});
	}, [viewport, layoutGeneration]);

	// ── Apply filter: yearRange + visibleLayers + hiddenCommunities ──
	useEffect(() => {
		if (!nodeDataSetRef.current) return;

		const [y0, y1] = yearRange ?? [0, 9999];

		const hiddenIds = new Set<string>();
		const nodeUpdates = nodes.map((n) => {
			let hidden = false;

			if (visibleLayers && !visibleLayers.has(n.type)) hidden = true;

			if (!hidden && n.type === "patent" && n.year) {
				if (n.year < y0 || n.year > y1) hidden = true;
			}

			if (!hidden && n.type === "concept" && n.community_id !== undefined) {
				if (hiddenCommunities?.has(n.community_id)) hidden = true;
			}

			if (!hidden && hiddenNodeIds?.has(n.id)) hidden = true;

			if (hidden) hiddenIds.add(n.id);
			return { id: n.id, hidden };
		});

		baseHiddenNodeIdsRef.current = hiddenIds;
		nodeDataSetRef.current.update(nodeUpdates);

		// Sync edge visibility: hide any edge whose from OR to node is hidden.
		if (edgeDataSetRef.current) {
			const edgeUpdates = [
				...edges.map((e) => ({
					id: e.id,
					hidden:
						hiddenIds.has(e.from) ||
						hiddenIds.has(e.to) ||
						Boolean(hiddenEdgeIds?.has(e.id)),
				})),
				...citationEdges.map((edge) => ({
					id: `citation:${edge.id}`,
					hidden: hiddenIds.has(edge.from) || hiddenIds.has(edge.to),
				})),
			];
			edgeDataSetRef.current.update(edgeUpdates);
		}
	}, [
		nodes,
		edges,
		citationEdges,
		yearRange,
		visibleLayers,
		hiddenCommunities,
		hiddenNodeIds,
		hiddenEdgeIds,
		layoutGeneration,
	]);

	// ── Focus a node (from SearchBox) ──
	useEffect(() => {
		if (!focusNodeId || !networkRef.current) return;
		// 比較模式下兩側面板的節點子集不同，聚焦的節點可能不在這一側——沒有就跳過。
		if (!nodes.some((n) => n.id === focusNodeId)) return;
		networkRef.current.focus(focusNodeId, {
			scale: 1.5,
			animation: { duration: 400, easingFunction: "easeInOutQuad" },
		});
		networkRef.current.selectNodes([focusNodeId]);
	}, [focusNodeId, nodes]);

	return (
		<div className="relative w-full h-full bg-accent">
			{/* Fit-to-view button */}
			<Button
				variant="outline"
				size="sm"
				onClick={handleFit}
				title="全部顯示"
				className="absolute top-3 right-3 z-10 h-auto rounded bg-background/90 py-1.5 text-xs text-muted-foreground hover:border-accent hover:bg-transparent hover:text-foreground cursor-pointer backdrop-blur-sm"
			>
				全部顯示
			</Button>

			{layoutStatus === "computing" && (
				<div
					role="status"
					className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-md border border-border bg-background/90 px-4 py-2 text-xs text-muted-foreground"
				>
					佈局計算中…
				</div>
			)}
			{layoutStatus === "failed" && (
				<div
					role="alert"
					className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-md border border-border bg-background/90 px-4 py-2 text-xs text-muted-foreground"
				>
					背景排版失敗，目前顯示初步位置；重新開啟此視圖會再次計算。
				</div>
			)}

			<div
				ref={containerRef}
				className="w-full h-full"
				data-layout-status={layoutStatus}
				data-layout-reason={layoutReason}
				data-layout-source={layoutSource}
				data-layout-revealed={layoutRevealed}
			/>
		</div>
	);
}
