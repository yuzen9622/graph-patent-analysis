import { describe, expect, it } from "vitest";
import {
	buildDifferenceView,
	compareViews,
	DIFF_COLORS,
	DIFF_EDGE_DASHES,
	DIFF_NODE_SHAPES,
	effectiveScope,
	membershipHiddenIds,
	scopesEqual,
	suggestCompareScopes,
} from "../lib/graph-compare";
import type { GraphViewData } from "../lib/graph-view";
import type { GraphEdge, GraphNode } from "../types/graph";

const ALL = ["a.xlsx", "b.xlsx", "c.xlsx"];

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
	return {
		id,
		type: "concept",
		label: id,
		color: "#111111",
		size: 12,
		...extra,
	};
}

function edge(
	id: string,
	from: string,
	to: string,
	extra: Partial<GraphEdge> = {},
): GraphEdge {
	return {
		id,
		from,
		to,
		relation: "cooccurrence",
		kind: "cooccurrence",
		...extra,
	};
}

function view(nodes: GraphNode[], edges: GraphEdge[]): GraphViewData {
	return {
		nodes,
		edges,
		communities: [
			{ id: 0, name: "群", color: "#000000", node_count: nodes.length },
		],
		stats: {
			applicant_count: 0,
			patent_count: 0,
			concept_count: nodes.length,
			community_count: 1,
			year_range: [2010, 2020],
		},
		maxSupport: 3,
		citationEdges: [],
	};
}

describe("effectiveScope / scopesEqual", () => {
	it("空選擇與全選等價（都代表全部來源檔）", () => {
		expect(effectiveScope([], ALL)).toEqual(["a.xlsx", "b.xlsx", "c.xlsx"]);
		expect(effectiveScope(undefined, ALL)).toEqual([
			"a.xlsx",
			"b.xlsx",
			"c.xlsx",
		]);
		expect(effectiveScope([...ALL], ALL)).toEqual([
			"a.xlsx",
			"b.xlsx",
			"c.xlsx",
		]);
		expect(scopesEqual([], ALL, ALL)).toBe(true);
		expect(scopesEqual(undefined, [...ALL].reverse(), ALL)).toBe(true);
	});

	it("順序不同、重複項目的相同選擇視為相等", () => {
		expect(effectiveScope(["b.xlsx", "a.xlsx", "a.xlsx"], ALL)).toEqual([
			"a.xlsx",
			"b.xlsx",
		]);
		expect(scopesEqual(["b.xlsx", "a.xlsx"], ["a.xlsx", "b.xlsx"], ALL)).toBe(
			true,
		);
	});

	it("不同選擇不相等；不存在的檔名被忽略", () => {
		expect(scopesEqual(["a.xlsx"], ["b.xlsx"], ALL)).toBe(false);
		expect(effectiveScope(["a.xlsx", "ghost.xlsx"], ALL)).toEqual(["a.xlsx"]);
		// 只剩不存在的檔名 → 等同未篩選 → 與全部相等
		expect(scopesEqual(["ghost.xlsx"], [], ALL)).toBe(true);
	});

	it("沒有來源檔時兩側都是空集合", () => {
		expect(effectiveScope(["x"], [])).toEqual([]);
		expect(scopesEqual(["x"], [], [])).toBe(true);
	});
});

describe("suggestCompareScopes", () => {
	it("兩側目前相同時，改用前兩個來源檔各佔一邊", () => {
		expect(suggestCompareScopes(ALL, [], [])).toEqual({
			left: ["a.xlsx"],
			right: ["b.xlsx"],
		});
	});

	it("兩側已經不同就沿用", () => {
		expect(suggestCompareScopes(ALL, ["c.xlsx"], ["a.xlsx"])).toEqual({
			left: ["c.xlsx"],
			right: ["a.xlsx"],
		});
	});

	it("只有一個來源檔時不硬湊", () => {
		expect(suggestCompareScopes(["a.xlsx"], [], [])).toEqual({
			left: [],
			right: [],
		});
	});
});

describe("compareViews", () => {
	const a = view(
		[node("n1"), node("n2"), node("n3")],
		[edge("e1", "n1", "n2"), edge("e2", "n2", "n3")],
	);
	const b = view(
		[node("n2"), node("n3"), node("n4")],
		[edge("e2", "n2", "n3")],
	);

	it("以 id 計算 A-only / B-only / 共有與 Jaccard", () => {
		const metrics = compareViews(a, b);
		expect(metrics.nodes).toEqual({
			aOnly: 1,
			bOnly: 1,
			shared: 2,
			union: 4,
			jaccard: 0.5,
		});
		expect(metrics.edges).toEqual({
			aOnly: 1,
			bOnly: 0,
			shared: 1,
			union: 2,
			jaccard: 0.5,
		});
	});

	it("label 相同但 id 不同不算共有", () => {
		const left = view([node("n1", { label: "同名" })], []);
		const right = view([node("n9", { label: "同名" })], []);
		expect(compareViews(left, right).nodes.shared).toBe(0);
	});

	it("兩側皆空時 Jaccard 為 0", () => {
		expect(compareViews(view([], []), view([], [])).nodes).toEqual({
			aOnly: 0,
			bOnly: 0,
			shared: 0,
			union: 0,
			jaccard: 0,
		});
	});

	it("完全相同時 Jaccard 為 1", () => {
		expect(compareViews(a, a).nodes.jaccard).toBe(1);
	});
});

describe("buildDifferenceView", () => {
	const nodeA1 = node("n1");
	const nodeShared = node("n2");
	const edgeA = edge("e1", "n1", "n2");
	const edgeShared = edge("e2", "n2", "n3");
	const a = view([nodeA1, nodeShared, node("n3")], [edgeA, edgeShared]);
	const b = view(
		[nodeShared, node("n3"), node("n4")],
		[edgeShared, edge("e3", "n3", "n4")],
	);

	it("聯集含兩側所有節點與邊，並標上歸屬", () => {
		const diff = buildDifferenceView(a, b);
		expect(diff.view.nodes.map((n) => n.id).sort()).toEqual([
			"n1",
			"n2",
			"n3",
			"n4",
		]);
		expect(diff.nodeMembership).toEqual({
			n1: "a",
			n2: "shared",
			n3: "shared",
			n4: "b",
		});
		expect(diff.edgeMembership).toEqual({ e1: "a", e2: "shared", e3: "b" });
	});

	it("依歸屬套用顏色、形狀與虛線（冗餘編碼）", () => {
		const diff = buildDifferenceView(a, b);
		const only = diff.view.nodes.find((n) => n.id === "n1")!;
		expect(only.color).toBe(DIFF_COLORS.a);
		expect(only.shape).toBe(DIFF_NODE_SHAPES.a);
		const sharedNode = diff.view.nodes.find((n) => n.id === "n2")!;
		expect(sharedNode.color).toBe(DIFF_COLORS.shared);
		expect(sharedNode.shape).toBe(DIFF_NODE_SHAPES.shared);
		const bEdge = diff.view.edges.find((e) => e.id === "e3")!;
		expect(bEdge.color).toBe(DIFF_COLORS.b);
		expect(bEdge.dashes).toEqual(DIFF_EDGE_DASHES.b);
		expect(diff.view.edges.find((e) => e.id === "e2")!.dashes).toBe(false);
	});

	it("不會修改輸入的檢視或其節點／邊物件", () => {
		const snapshot = JSON.stringify({ a, b });
		const diff = buildDifferenceView(a, b);
		expect(JSON.stringify({ a, b })).toBe(snapshot);
		expect(nodeA1.color).toBe("#111111");
		expect(nodeA1.shape).toBeUndefined();
		expect(edgeA.color).toBeUndefined();
		expect(diff.view.nodes.find((n) => n.id === "n1")).not.toBe(nodeA1);
		expect(diff.view.edges.find((e) => e.id === "e1")).not.toBe(edgeA);
		expect(diff.view.nodes).not.toBe(a.nodes);
	});

	it("統計與 maxSupport 取兩側聯集", () => {
		const diff = buildDifferenceView(a, b);
		expect(diff.view.stats.concept_count).toBe(4);
		expect(diff.view.stats.year_range).toEqual([2010, 2020]);
		expect(diff.view.maxSupport).toBe(3);
		expect(diff.metrics.nodes.union).toBe(4);
	});

	it("社群依 id 與單位去重", () => {
		const left = view([node("n1")], []);
		const right = view([node("n2")], []);
		right.communities = [
			{ id: 0, name: "群", color: "#000000", node_count: 1 },
			{
				id: 0,
				name: "家群",
				color: "#000000",
				node_count: 1,
				unit: "applicant",
			},
		];
		expect(buildDifferenceView(left, right).view.communities).toHaveLength(2);
	});
});

describe("membershipHiddenIds", () => {
	const a = view([node("n1"), node("n2")], [edge("e1", "n1", "n2")]);
	const b = view([node("n2"), node("n3")], [edge("e2", "n2", "n3")]);
	const diff = buildDifferenceView(a, b);

	it("沒有隱藏時回傳空集合", () => {
		const hidden = membershipHiddenIds(diff, new Set());
		expect(hidden.nodes.size).toBe(0);
		expect(hidden.edges.size).toBe(0);
	});

	it("隱藏某一組時，該組節點與其連帶的邊都被藏起來", () => {
		const hidden = membershipHiddenIds(diff, new Set(["a"] as const));
		expect([...hidden.nodes]).toEqual(["n1"]);
		// e1 既是 A-only、端點也被藏，兩個理由都成立
		expect([...hidden.edges]).toEqual(["e1"]);
	});

	it("隱藏共有組會連帶藏掉跨組的邊", () => {
		const hidden = membershipHiddenIds(diff, new Set(["shared"] as const));
		expect([...hidden.nodes]).toEqual(["n2"]);
		expect([...hidden.edges].sort()).toEqual(["e1", "e2"]);
	});

	it("全部隱藏時所有 id 都在集合裡", () => {
		const hidden = membershipHiddenIds(
			diff,
			new Set(["a", "b", "shared"] as const),
		);
		expect(hidden.nodes.size).toBe(3);
		expect(hidden.edges.size).toBe(2);
	});
});
