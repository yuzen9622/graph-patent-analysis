import { describe, expect, it } from "vitest";
import {
	buildDifferenceView,
	compareViews,
	countSharedConcepts,
	diffMemberships,
	DIFF_COLORS,
	DIFF_EDGE_DASHES,
	DIFF_NODE_SHAPES,
	effectiveScope,
	membershipHiddenIds,
	panelScopesDistinct,
	scopesEqual,
	suggestNewPanelScope,
	suggestPanelScopes,
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

describe("suggestPanelScopes", () => {
	it("兩側目前相同時，改用前兩個來源檔各佔一邊", () => {
		expect(suggestPanelScopes(ALL, [[], []])).toEqual([["a.xlsx"], ["b.xlsx"]]);
	});

	it("兩側已經不同就沿用", () => {
		expect(suggestPanelScopes(ALL, [["c.xlsx"], ["a.xlsx"]])).toEqual([
			["c.xlsx"],
			["a.xlsx"],
		]);
	});

	it("只有一個來源檔時不硬湊", () => {
		expect(suggestPanelScopes(["a.xlsx"], [[], []])).toEqual([[], []]);
	});

	it("三面板全相同時依序各佔一個來源檔", () => {
		expect(suggestPanelScopes(ALL, [[], [], []])).toEqual([
			["a.xlsx"],
			["b.xlsx"],
			["c.xlsx"],
		]);
	});
});

describe("panelScopesDistinct / suggestNewPanelScope", () => {
	it("兩面板時等價於 !scopesEqual", () => {
		expect(panelScopesDistinct([["a.xlsx"], ["b.xlsx"]], ALL)).toBe(true);
		expect(panelScopesDistinct([[], [...ALL]], ALL)).toBe(false);
		expect(panelScopesDistinct([["ghost.xlsx"], []], ALL)).toBe(false);
	});

	it("任兩面板相同就不算互異", () => {
		expect(panelScopesDistinct([["a.xlsx"], ["b.xlsx"], ["c.xlsx"]], ALL)).toBe(
			true,
		);
		expect(panelScopesDistinct([["a.xlsx"], ["b.xlsx"], ["a.xlsx"]], ALL)).toBe(
			false,
		);
	});

	it("新面板拿第一個沒被用到的來源檔", () => {
		expect(suggestNewPanelScope([["a.xlsx"], ["b.xlsx"]], ALL)).toEqual([
			"c.xlsx",
		]);
	});

	it("來源檔用光或沒有來源檔時回傳空陣列", () => {
		expect(
			suggestNewPanelScope([["a.xlsx"], ["b.xlsx"], ["c.xlsx"]], ALL),
		).toEqual([]);
		// 空選擇＝全部來源，所以沒有檔可用
		expect(suggestNewPanelScope([[], ["b.xlsx"]], ALL)).toEqual([]);
		expect(suggestNewPanelScope([[], []], [])).toEqual([]);
	});
});

describe("diffMemberships", () => {
	it("兩面板用 a/b/shared，三面板以上用 unique/partial/shared", () => {
		expect(diffMemberships(2)).toEqual(["a", "b", "shared"]);
		expect(diffMemberships(3)).toEqual(["unique", "partial", "shared"]);
		expect(diffMemberships(6)).toEqual(["unique", "partial", "shared"]);
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
		const metrics = compareViews([a, b]);
		expect(metrics.nodes).toEqual({
			counts: [2, 2],
			aOnly: 1,
			bOnly: 1,
			union: 4,
			jaccard: 0.5,
		});
		// counts[N-1] 就是舊的 shared
		expect(metrics.nodes.counts[1]).toBe(2);
		expect(metrics.edges).toEqual({
			counts: [1, 1],
			aOnly: 1,
			bOnly: 0,
			union: 2,
			jaccard: 0.5,
		});
		expect(metrics.edges.counts[1]).toBe(1);
	});

	it("label 相同但 id 不同不算共有", () => {
		const left = view([node("n1", { label: "同名" })], []);
		const right = view([node("n9", { label: "同名" })], []);
		expect(compareViews([left, right]).nodes.counts[1]).toBe(0);
	});

	it("兩側皆空時 Jaccard 為 0", () => {
		expect(compareViews([view([], []), view([], [])]).nodes).toEqual({
			counts: [0, 0],
			aOnly: 0,
			bOnly: 0,
			union: 0,
			jaccard: 0,
		});
	});

	it("完全相同時 Jaccard 為 1", () => {
		expect(compareViews([a, a]).nodes.jaccard).toBe(1);
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
		const diff = buildDifferenceView([a, b]);
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
		expect(diff.nodePanels).toEqual({
			n1: [1],
			n2: [1, 2],
			n3: [1, 2],
			n4: [2],
		});
		expect(diff.edgePanels).toEqual({ e1: [1], e2: [1, 2], e3: [2] });
	});

	it("依歸屬套用顏色、形狀與虛線（冗餘編碼）", () => {
		const diff = buildDifferenceView([a, b]);
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
		const diff = buildDifferenceView([a, b]);
		expect(JSON.stringify({ a, b })).toBe(snapshot);
		expect(nodeA1.color).toBe("#111111");
		expect(nodeA1.shape).toBeUndefined();
		expect(edgeA.color).toBeUndefined();
		expect(diff.view.nodes.find((n) => n.id === "n1")).not.toBe(nodeA1);
		expect(diff.view.edges.find((e) => e.id === "e1")).not.toBe(edgeA);
		expect(diff.view.nodes).not.toBe(a.nodes);
	});

	it("統計與 maxSupport 取兩側聯集", () => {
		const diff = buildDifferenceView([a, b]);
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
		expect(buildDifferenceView([left, right]).view.communities).toHaveLength(2);
	});
});

describe("buildDifferenceView（三面板）", () => {
	const a = view([node("n1"), node("n2")], [edge("e1", "n1", "n2")]);
	const b = view([node("n2"), node("n3")], [edge("e2", "n2", "n3")]);
	const c = view([node("n3"), node("n4")], [edge("e3", "n3", "n4")]);
	const diff = buildDifferenceView([a, b, c]);

	it("依出現面板數分為 unique / partial / shared", () => {
		expect(diff.nodeMembership).toEqual({
			n1: "unique",
			n2: "partial",
			n3: "partial",
			n4: "unique",
		});
		expect(diff.edgeMembership).toEqual({
			e1: "unique",
			e2: "unique",
			e3: "unique",
		});
	});

	it("nodePanels 記下見於哪幾個面板（1-based）", () => {
		expect(diff.nodePanels).toEqual({
			n1: [1],
			n2: [1, 2],
			n3: [2, 3],
			n4: [3],
		});
		expect(diff.edgePanels).toEqual({ e1: [1], e2: [2], e3: [3] });
	});

	it("counts 依重疊層數分桶，jaccard 是全面板共有比例", () => {
		expect(diff.metrics.nodes.counts).toEqual([2, 2, 0]);
		expect(diff.metrics.nodes.union).toBe(4);
		expect(diff.metrics.nodes.jaccard).toBe(0);
		// 三面板不填 A/B 獨有
		expect(diff.metrics.nodes.aOnly).toBeUndefined();
		expect(diff.metrics.nodes.bOnly).toBeUndefined();
		expect(diff.metrics.edges.counts).toEqual([3, 0, 0]);
	});

	it("全面板共有才算 shared", () => {
		const all = view([node("n9")], []);
		const three = buildDifferenceView([all, all, all]);
		expect(three.nodeMembership.n9).toBe("shared");
		expect(three.nodePanels.n9).toEqual([1, 2, 3]);
		expect(three.metrics.nodes.jaccard).toBe(1);
	});

	it("三面板也套用顏色、形狀與虛線", () => {
		const unique = diff.view.nodes.find((n) => n.id === "n1")!;
		expect(unique.color).toBe(DIFF_COLORS.unique);
		expect(unique.shape).toBe(DIFF_NODE_SHAPES.unique);
		const partial = diff.view.nodes.find((n) => n.id === "n2")!;
		expect(partial.color).toBe(DIFF_COLORS.partial);
		expect(partial.shape).toBe(DIFF_NODE_SHAPES.partial);
		expect(diff.view.edges.find((e) => e.id === "e1")!.dashes).toEqual(
			DIFF_EDGE_DASHES.unique,
		);
	});

	it("聯集、統計與 maxSupport 跨 N 個面板", () => {
		expect(diff.view.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
		expect(diff.view.stats.concept_count).toBe(4);
		expect(diff.view.stats.year_range).toEqual([2010, 2020]);
		expect(diff.view.maxSupport).toBe(3);
	});

	it("membershipHiddenIds 在三面板下用 unique/partial/shared", () => {
		const hidden = membershipHiddenIds(diff, new Set(["unique"] as const));
		expect([...hidden.nodes].sort()).toEqual(["n1", "n4"]);
		expect([...hidden.edges].sort()).toEqual(["e1", "e2", "e3"]);
		const partialHidden = membershipHiddenIds(
			diff,
			new Set(["partial"] as const),
		);
		expect([...partialHidden.nodes].sort()).toEqual(["n2", "n3"]);
	});
});

describe("membershipHiddenIds", () => {
	const a = view([node("n1"), node("n2")], [edge("e1", "n1", "n2")]);
	const b = view([node("n2"), node("n3")], [edge("e2", "n2", "n3")]);
	const diff = buildDifferenceView([a, b]);

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

describe("countSharedConcepts（脈絡圖兩檔共享概念，2026-08-09）", () => {
  function patent(id: string, files: string[]): GraphNode {
    return {
      id: `patent:${id}`,
      type: "patent",
      label: id,
      color: "#999",
      size: 18,
      source_files: files,
    };
  }
  function concept(id: string, sourcePatents: string[]): GraphNode {
    return node(id, { source_patents: sourcePatents });
  }

  const nodes: GraphNode[] = [
    patent("P1", ["a.xlsx"]),
    patent("P2", ["b.xlsx"]),
    patent("P3", ["a.xlsx", "b.xlsx"]), // 兩檔都有的專利
    patent("P4", []), // 無來源檔：不屬任何一側
    concept("X", ["P1"]), // 僅 A
    concept("Y", ["P2"]), // 僅 B
    concept("Z", ["P1", "P2", "P3"]), // 兩檔都有
    concept("W", ["P4"]), // 只連無來源專利：兩側皆不屬
    concept("V", []), // 無涵蓋專利
  ];

  it("兩檔各有獨有與共有概念，回傳兩面板語意的 CompareCount", () => {
    const c = countSharedConcepts(nodes, ["a.xlsx"], ["b.xlsx"]);
    expect(c).not.toBeNull();
    expect(c?.aOnly).toBe(1); // X
    expect(c?.bOnly).toBe(1); // Y
    expect(c?.counts[1]).toBe(1); // Z 共有
    expect(c?.union).toBe(3);
    expect(c?.jaccard).toBeCloseTo(1 / 3, 5);
  });

  it("任一側為空 → null（無法比較）", () => {
    expect(countSharedConcepts(nodes, [], ["b.xlsx"])).toBeNull();
    expect(countSharedConcepts(nodes, ["a.xlsx"], [])).toBeNull();
  });

  it("專利 id 前綴剝除：patent: 前綴不影響歸屬", () => {
    const single: GraphNode[] = [
      patent("Q1", ["a.xlsx"]),
      concept("K", ["Q1"]),
    ];
    const c = countSharedConcepts(single, ["a.xlsx"], ["b.xlsx"]);
    expect(c?.aOnly).toBe(1);
    expect(c?.union).toBe(1);
  });

  it("非概念節點不計入", () => {
    const withApplicant: GraphNode[] = [
      ...nodes,
      { id: "applicant:X", type: "applicant", label: "X", color: "#00f", size: 30 },
    ];
    const c = countSharedConcepts(withApplicant, ["a.xlsx"], ["b.xlsx"]);
    expect(c?.union).toBe(3);
  });
});
