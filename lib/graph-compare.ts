/**
 * A/B 比較（比較工作區）的純邏輯：來源檔範圍正規化、以 id 為準的集合比較、
 * 差異（聯集）檢視組裝與成員可見性。
 *
 * 這裡不碰 React、不碰 DOM，全部可單元測試；`lib/graph-view.ts` 產生的
 * node/edge id 在不同來源檔範圍間是穩定的，因此比較一律以 id 為準，不用 label。
 */
import type { GraphViewData } from "./graph-view";
import type {
	CitationEdge,
	Community,
	GraphEdge,
	GraphNode,
} from "../types/graph";

/** 節點／邊在 A、B 兩個檢視間的歸屬。 */
export type DiffMembership = "a" | "b" | "shared";

export const DIFF_MEMBERSHIPS: readonly DiffMembership[] = ["a", "b", "shared"];

/** 差異圖配色（規格指定值）。 */
export const DIFF_COLORS: Record<DiffMembership, string> = {
	a: "#2563eb",
	b: "#059669",
	shared: "#64748b",
};

/** 冗餘編碼：顏色以外再用形狀區分，色覺障礙者也分得出來。 */
export const DIFF_NODE_SHAPES: Record<DiffMembership, string> = {
	a: "triangle",
	b: "square",
	shared: "dot",
};

/** 冗餘編碼：邊用虛線樣式區分。 */
export const DIFF_EDGE_DASHES: Record<
	DiffMembership,
	[number, number] | false
> = {
	a: [8, 4],
	b: [2, 4],
	shared: false,
};

export const DIFF_LABELS: Record<DiffMembership, string> = {
	a: "僅 A",
	b: "僅 B",
	shared: "A、B 共有",
};

export const DIFF_SHAPE_LABELS: Record<DiffMembership, string> = {
	a: "三角形節點／長虛線",
	b: "方形節點／短虛線",
	shared: "圓形節點／實線",
};

function compareFileName(a: string, b: string): number {
	return a.localeCompare(b, "zh-Hant");
}

/**
 * 有效範圍：空陣列＝全部來源檔，因此「空」與「全選」等價。
 * 同時去除重複、忽略不存在的檔名，並排序，讓順序不同的相同選擇視為相等。
 */
export function effectiveScope(
	sourceFiles: readonly string[] | undefined,
	allSourceFiles: readonly string[],
): string[] {
	const all = Array.from(new Set(allSourceFiles)).sort(compareFileName);
	const known = new Set(all);
	const picked = Array.from(new Set(sourceFiles ?? [])).filter((file) =>
		known.has(file),
	);
	if (picked.length === 0 || picked.length === all.length) return all;
	return picked.sort(compareFileName);
}

/** 兩側「有效範圍」是否相同——相同就沒有東西可比。 */
export function scopesEqual(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
	allSourceFiles: readonly string[],
): boolean {
	const a = effectiveScope(left, allSourceFiles);
	const b = effectiveScope(right, allSourceFiles);
	return a.length === b.length && a.every((file, index) => file === b[index]);
}

/**
 * 進入比較設定時的預設 A／B 範圍：盡量不要一開始就「全部 vs 全部」。
 * 已有兩個不同的有效範圍就沿用；否則用前兩個來源檔各佔一邊。
 */
export function suggestCompareScopes(
	allSourceFiles: readonly string[],
	currentLeft: readonly string[] | undefined,
	currentRight: readonly string[] | undefined,
): { left: string[]; right: string[] } {
	const all = Array.from(new Set(allSourceFiles)).sort(compareFileName);
	if (all.length < 2)
		return { left: [...(currentLeft ?? [])], right: [...(currentRight ?? [])] };
	if (!scopesEqual(currentLeft, currentRight, all)) {
		return { left: [...(currentLeft ?? [])], right: [...(currentRight ?? [])] };
	}
	return { left: [all[0]], right: [all[1]] };
}

export interface CompareCount {
	aOnly: number;
	bOnly: number;
	shared: number;
	union: number;
	/** |A∩B| / |A∪B|；聯集為空時定義為 0（沒有共同基礎可談相似度）。 */
	jaccard: number;
}

export interface CompareMetrics {
	nodes: CompareCount;
	edges: CompareCount;
}

function countMembership(
	a: Iterable<string>,
	b: Iterable<string>,
): CompareCount {
	const setA = new Set(a);
	const setB = new Set(b);
	let shared = 0;
	for (const id of setA) if (setB.has(id)) shared += 1;
	const aOnly = setA.size - shared;
	const bOnly = setB.size - shared;
	const union = aOnly + bOnly + shared;
	return {
		aOnly,
		bOnly,
		shared,
		union,
		jaccard: union === 0 ? 0 : shared / union,
	};
}

/** 以 node id／edge id 比較兩個檢視，回傳節點與邊的 A-only／B-only／共有與 Jaccard。 */
export function compareViews(
	a: GraphViewData,
	b: GraphViewData,
): CompareMetrics {
	return {
		nodes: countMembership(
			a.nodes.map((node) => node.id),
			b.nodes.map((node) => node.id),
		),
		edges: countMembership(
			a.edges.map((edge) => edge.id),
			b.edges.map((edge) => edge.id),
		),
	};
}

export interface DifferenceView {
	/** 聯集檢視：節點／邊都是複本，帶上差異配色、形狀與虛線。 */
	view: GraphViewData;
	nodeMembership: Record<string, DiffMembership>;
	edgeMembership: Record<string, DiffMembership>;
	metrics: CompareMetrics;
}

function membershipOf(inA: boolean, inB: boolean): DiffMembership {
	if (inA && inB) return "shared";
	return inA ? "a" : "b";
}

function unionById<T extends { id: string }>(
	a: readonly T[],
	b: readonly T[],
): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of [...a, ...b]) {
		if (seen.has(item.id)) continue;
		seen.add(item.id);
		out.push(item);
	}
	return out;
}

/**
 * 組出差異（聯集）檢視。輸入的兩個檢視與其中的節點／邊物件都不會被修改，
 * 輸出一律是新的物件，方便直接餵給 vis-network 而不污染原檢視。
 */
export function buildDifferenceView(
	a: GraphViewData,
	b: GraphViewData,
): DifferenceView {
	const nodeIdsA = new Set(a.nodes.map((node) => node.id));
	const nodeIdsB = new Set(b.nodes.map((node) => node.id));
	const edgeIdsA = new Set(a.edges.map((edge) => edge.id));
	const edgeIdsB = new Set(b.edges.map((edge) => edge.id));

	const nodeMembership: Record<string, DiffMembership> = {};
	const edgeMembership: Record<string, DiffMembership> = {};

	const nodes: GraphNode[] = unionById(a.nodes, b.nodes).map((node) => {
		const membership = membershipOf(
			nodeIdsA.has(node.id),
			nodeIdsB.has(node.id),
		);
		nodeMembership[node.id] = membership;
		return {
			...node,
			color: DIFF_COLORS[membership],
			shape: DIFF_NODE_SHAPES[membership],
		};
	});

	const edges: GraphEdge[] = unionById(a.edges, b.edges).map((edge) => {
		const membership = membershipOf(
			edgeIdsA.has(edge.id),
			edgeIdsB.has(edge.id),
		);
		edgeMembership[edge.id] = membership;
		return {
			...edge,
			color: DIFF_COLORS[membership],
			dashes: DIFF_EDGE_DASHES[membership],
		};
	});

	const citationEdges: CitationEdge[] = unionById(
		a.citationEdges,
		b.citationEdges,
	).map((edge) => ({ ...edge }));
	const communities: Community[] = [];
	const seenCommunities = new Set<string>();
	for (const community of [...a.communities, ...b.communities]) {
		const key = `${community.unit ?? "patent"}:${community.id}`;
		if (seenCommunities.has(key)) continue;
		seenCommunities.add(key);
		communities.push({ ...community });
	}

	const stats: GraphViewData["stats"] = {
		applicant_count: nodes.filter((node) => node.type === "applicant").length,
		patent_count: nodes.filter((node) => node.type === "patent").length,
		concept_count: nodes.filter((node) => node.type === "concept").length,
		community_count: communities.length,
		year_range: [
			Math.min(a.stats.year_range[0], b.stats.year_range[0]),
			Math.max(a.stats.year_range[1], b.stats.year_range[1]),
		],
	};

	const view: GraphViewData = {
		nodes,
		edges,
		communities,
		stats,
		maxSupport: Math.max(a.maxSupport, b.maxSupport),
		citationEdges,
		...((a.capabilityWarning ?? b.capabilityWarning)
			? { capabilityWarning: a.capabilityWarning ?? b.capabilityWarning }
			: {}),
	};

	return {
		view,
		nodeMembership,
		edgeMembership,
		metrics: {
			nodes: countMembership(nodeIdsA, nodeIdsB),
			edges: countMembership(edgeIdsA, edgeIdsB),
		},
	};
}

export interface MembershipHiddenIds {
	nodes: Set<string>;
	edges: Set<string>;
}

/**
 * 依「要隱藏哪些歸屬」算出該藏起來的 node／edge id。
 * 只影響可見性，不動座標，所以切換時不會重跑佈局；
 * 端點被藏起來的邊一併隱藏，避免出現懸空的線。
 */
export function membershipHiddenIds(
	difference: DifferenceView,
	hidden: ReadonlySet<DiffMembership>,
): MembershipHiddenIds {
	const nodes = new Set<string>();
	const edges = new Set<string>();
	if (hidden.size === 0) return { nodes, edges };

	for (const [id, membership] of Object.entries(difference.nodeMembership)) {
		if (hidden.has(membership)) nodes.add(id);
	}
	for (const [id, membership] of Object.entries(difference.edgeMembership)) {
		if (hidden.has(membership)) edges.add(id);
	}
	for (const edge of difference.view.edges) {
		if (nodes.has(edge.from) || nodes.has(edge.to)) edges.add(edge.id);
	}
	return { nodes, edges };
}
