/**
 * N 面板比較（比較工作區）的純邏輯：來源檔範圍正規化、以 id 為準的集合比較、
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

/**
 * 節點／邊的歸屬。兩面板沿用 A／B 語意；三面板以上改用
 * unique（只在一個面板出現）／partial（部分面板共有）／shared（全部面板共有）。
 */
export type DiffMembership = "a" | "b" | "unique" | "partial" | "shared";

export const DIFF_MEMBERSHIPS: readonly DiffMembership[] = ["a", "b", "shared"];

const MULTI_MEMBERSHIPS: readonly DiffMembership[] = [
	"unique",
	"partial",
	"shared",
];

/** 該面板數下實際會出現的歸屬集合。 */
export function diffMemberships(panelCount: number): readonly DiffMembership[] {
	return panelCount <= 2 ? DIFF_MEMBERSHIPS : MULTI_MEMBERSHIPS;
}

/** 差異圖配色（規格指定值）。 */
export const DIFF_COLORS: Record<DiffMembership, string> = {
	a: "#2563eb",
	b: "#059669",
	unique: "#f59e0b",
	partial: "#8b5cf6",
	shared: "#64748b",
};

/** 冗餘編碼：顏色以外再用形狀區分，色覺障礙者也分得出來。 */
export const DIFF_NODE_SHAPES: Record<DiffMembership, string> = {
	a: "triangle",
	b: "square",
	unique: "triangle",
	partial: "square",
	shared: "dot",
};

/** 冗餘編碼：邊用虛線樣式區分。 */
export const DIFF_EDGE_DASHES: Record<
	DiffMembership,
	[number, number] | false
> = {
	a: [8, 4],
	b: [2, 4],
	unique: [8, 4],
	partial: [2, 4],
	shared: false,
};

export const DIFF_LABELS: Record<DiffMembership, string> = {
	a: "僅 A",
	b: "僅 B",
	unique: "僅 1 組",
	partial: "部分組共有",
	shared: "A、B 共有",
};

export const DIFF_SHAPE_LABELS: Record<DiffMembership, string> = {
	a: "三角形節點／長虛線",
	b: "方形節點／短虛線",
	unique: "三角形節點／長虛線",
	partial: "方形節點／短虛線",
	shared: "圓形節點／實線",
};

/**
 * 歸屬顯示文字。`shared` 在三面板以上要帶出面板數，因此不能只查 DIFF_LABELS；
 * 兩面板一律回傳與既有 A/B 版本逐字相同的字串。
 */
export function diffMembershipLabel(
	membership: DiffMembership,
	panelCount: number,
): string {
	if (panelCount <= 2) return DIFF_LABELS[membership];
	if (membership === "shared") return `全部 ${panelCount} 組共有`;
	return DIFF_LABELS[membership];
}

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

/** 任兩個面板的有效範圍都不相同才算「可比較」。 */
export function panelScopesDistinct(
	scopes: readonly (readonly string[] | undefined)[],
	allSourceFiles: readonly string[],
): boolean {
	const seen = new Set<string>();
	for (const scope of scopes) {
		const key = effectiveScope(scope, allSourceFiles).join("\u0000");
		if (seen.has(key)) return false;
		seen.add(key);
	}
	return true;
}

/**
 * 進入比較設定時的預設面板範圍：盡量不要一開始就「全部 vs 全部」。
 * 已經互異就沿用；否則讓前 N 個來源檔依序各佔一個面板。
 */
export function suggestPanelScopes(
	allSourceFiles: readonly string[],
	current: readonly (readonly string[] | undefined)[],
): string[][] {
	const panelCount = Math.max(2, current.length);
	const fallback = Array.from({ length: panelCount }, (_, index) => [
		...(current[index] ?? []),
	]);
	const all = Array.from(new Set(allSourceFiles)).sort(compareFileName);
	if (all.length < panelCount) return fallback;
	if (panelScopesDistinct(fallback, all)) return fallback;
	return Array.from({ length: panelCount }, (_, index) => [all[index]]);
}

/**
 * 新增面板時的預設範圍：第一個沒被任何面板用到的來源檔。
 * 沒有可用的新檔就回傳空陣列（空＝全部來源）。
 */
export function suggestNewPanelScope(
	panels: readonly (readonly string[] | undefined)[],
	allSourceFiles: readonly string[],
): string[] {
	const all = Array.from(new Set(allSourceFiles)).sort(compareFileName);
	const used = new Set<string>();
	for (const panel of panels) {
		for (const file of effectiveScope(panel, all)) used.add(file);
	}
	const free = all.find((file) => !used.has(file));
	return free ? [free] : [];
}

export interface CompareCount {
	/** counts[k] = 恰好出現在 k+1 個面板的 id 數；長度等於面板數。 */
	counts: number[];
	union: number;
	/** 全面板共有 / 聯集；聯集為空時定義為 0（沒有共同基礎可談相似度）。 */
	jaccard: number;
	/** 僅兩面板時提供：counts[0] 拆成哪一側獨有。 */
	aOnly?: number;
	bOnly?: number;
}

export interface CompareMetrics {
	nodes: CompareCount;
	edges: CompareCount;
}

function countMembership(idSets: readonly Set<string>[]): CompareCount {
	const panelCount = Math.max(1, idSets.length);
	const frequency = new Map<string, number>();
	for (const set of idSets) {
		for (const id of set) frequency.set(id, (frequency.get(id) ?? 0) + 1);
	}
	const counts = new Array<number>(panelCount).fill(0);
	for (const seen of frequency.values()) counts[seen - 1] += 1;
	const union = frequency.size;
	const shared = counts[panelCount - 1];
	const out: CompareCount = {
		counts,
		union,
		jaccard: union === 0 ? 0 : shared / union,
	};
	if (idSets.length === 2) {
		let aOnly = 0;
		let bOnly = 0;
		for (const [id, seen] of frequency) {
			if (seen !== 1) continue;
			if (idSets[0].has(id)) aOnly += 1;
			else bOnly += 1;
		}
		out.aOnly = aOnly;
		out.bOnly = bOnly;
	}
	return out;
}

/** 以 node id／edge id 比較 N 個檢視，回傳節點與邊的各重疊層數量與 Jaccard。 */
export function compareViews(views: readonly GraphViewData[]): CompareMetrics {
	return {
		nodes: countMembership(
			views.map((view) => new Set(view.nodes.map((node) => node.id))),
		),
		edges: countMembership(
			views.map((view) => new Set(view.edges.map((edge) => edge.id))),
		),
	};
}

export interface DifferenceView {
	/** 聯集檢視：節點／邊都是複本，帶上差異配色、形狀與虛線。 */
	view: GraphViewData;
	nodeMembership: Record<string, DiffMembership>;
	edgeMembership: Record<string, DiffMembership>;
	/** 該 id 出現在哪幾個面板（1-based，遞增）。 */
	nodePanels: Record<string, number[]>;
	edgePanels: Record<string, number[]>;
	metrics: CompareMetrics;
}

function membershipOf(panels: readonly number[], panelCount: number) {
	if (panelCount <= 2) {
		if (panels.length >= 2) return "shared" as const;
		return panels[0] === 1 ? ("a" as const) : ("b" as const);
	}
	if (panels.length >= panelCount) return "shared" as const;
	return panels.length <= 1 ? ("unique" as const) : ("partial" as const);
}

function unionById<T extends { id: string }>(
	groups: readonly (readonly T[])[],
) {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const group of groups) {
		for (const item of group) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			out.push(item);
		}
	}
	return out;
}

function panelsById(idSets: readonly Set<string>[]): (id: string) => number[] {
	return (id) => {
		const panels: number[] = [];
		for (const [index, set] of idSets.entries()) {
			if (set.has(id)) panels.push(index + 1);
		}
		return panels;
	};
}

/**
 * 組出差異（聯集）檢視。輸入的檢視與其中的節點／邊物件都不會被修改，
 * 輸出一律是新的物件，方便直接餵給 vis-network 而不污染原檢視。
 */
export function buildDifferenceView(
	views: readonly GraphViewData[],
): DifferenceView {
	const panelCount = views.length;
	const nodeIdSets = views.map(
		(view) => new Set(view.nodes.map((node) => node.id)),
	);
	const edgeIdSets = views.map(
		(view) => new Set(view.edges.map((edge) => edge.id)),
	);
	const nodePanelsOf = panelsById(nodeIdSets);
	const edgePanelsOf = panelsById(edgeIdSets);

	const nodeMembership: Record<string, DiffMembership> = {};
	const edgeMembership: Record<string, DiffMembership> = {};
	const nodePanels: Record<string, number[]> = {};
	const edgePanels: Record<string, number[]> = {};

	const nodes: GraphNode[] = unionById(views.map((view) => view.nodes)).map(
		(node) => {
			const panels = nodePanelsOf(node.id);
			const membership = membershipOf(panels, panelCount);
			nodeMembership[node.id] = membership;
			nodePanels[node.id] = panels;
			return {
				...node,
				color: DIFF_COLORS[membership],
				shape: DIFF_NODE_SHAPES[membership],
			};
		},
	);

	const edges: GraphEdge[] = unionById(views.map((view) => view.edges)).map(
		(edge) => {
			const panels = edgePanelsOf(edge.id);
			const membership = membershipOf(panels, panelCount);
			edgeMembership[edge.id] = membership;
			edgePanels[edge.id] = panels;
			return {
				...edge,
				color: DIFF_COLORS[membership],
				dashes: DIFF_EDGE_DASHES[membership],
			};
		},
	);

	const citationEdges: CitationEdge[] = unionById(
		views.map((view) => view.citationEdges),
	).map((edge) => ({ ...edge }));
	const communities: Community[] = [];
	const seenCommunities = new Set<string>();
	for (const view of views) {
		for (const community of view.communities) {
			const key = `${community.unit ?? "patent"}:${community.id}`;
			if (seenCommunities.has(key)) continue;
			seenCommunities.add(key);
			communities.push({ ...community });
		}
	}

	const stats: GraphViewData["stats"] = {
		applicant_count: nodes.filter((node) => node.type === "applicant").length,
		patent_count: nodes.filter((node) => node.type === "patent").length,
		concept_count: nodes.filter((node) => node.type === "concept").length,
		community_count: communities.length,
		year_range: [
			Math.min(...views.map((view) => view.stats.year_range[0])),
			Math.max(...views.map((view) => view.stats.year_range[1])),
		],
	};

	const capabilityWarning = views.find(
		(view) => view.capabilityWarning,
	)?.capabilityWarning;

	const view: GraphViewData = {
		nodes,
		edges,
		communities,
		stats,
		maxSupport: Math.max(...views.map((item) => item.maxSupport)),
		citationEdges,
		...(capabilityWarning ? { capabilityWarning } : {}),
	};

	return {
		view,
		nodeMembership,
		edgeMembership,
		nodePanels,
		edgePanels,
		metrics: {
			nodes: countMembership(nodeIdSets),
			edges: countMembership(edgeIdSets),
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
