import { describe, expect, it } from "vitest";
import { normalizeGraphData } from "../lib/graph-compat";
import { buildConceptNetwork } from "../lib/concept-network";
import { detectCommunities } from "../lib/community";
import { buildGraph } from "../lib/graph-builder";
import { normalizeApplicantName } from "../lib/excel-parser";
import type { ExtractionResult, GraphData, PatentRow } from "../types/graph";

/**
 * Regression guard for PRD v2 P0 §6.3 #5.
 *
 * `normalizeGraphData()` used to dispatch on `schema_version === 2 ? v2 : legacy`,
 * which sent every v3 graph into `normalizeLegacy()` — a function that rebuilds
 * the concept network from the structural edges alone.  That path discards every
 * stored cooccurrence edge, recomputes `frequency`, reassigns `community_id` and
 * `color`, and resets `methodology` to the v1.2 defaults.  Because `saveGraph()`
 * DELETEs the stored rows before writing the normalised graph back, the damage is
 * not recoverable from the database.
 *
 * Every assertion below is chosen so that it FAILS if the v3 payload takes the
 * legacy path: each expected value is one the legacy reconstruction would
 * overwrite with something different.
 */

/** A v3 graph whose stored values all differ from what legacy would recompute. */
function v3Graph(): Record<string, unknown> {
  return {
    schema_version: 3,
    nodes: [
      { id: "applicant:X", type: "applicant", label: "X", color: "#111111", size: 20, patent_count: 2, applicant_key: "X" },
      {
        id: "patent:P1",
        type: "patent",
        label: "P1",
        color: "#222222",
        size: 14,
        year: 2020,
        ipc5: ["G06Q10/10"],
        ipc_primary: "G06Q10/10",
        ipc_depth: 5,
        source_files: ["a.xlsx"],
        cited_by_count: 3,
        case_status: "核准",
      },
      { id: "patent:P2", type: "patent", label: "P2", color: "#222222", size: 14, year: 2021 },
      // frequency 42 / community_id 9 / colour #ABCDEF are all values the legacy
      // rebuild would replace (it would compute frequency 2 from the two
      // structural edges below, and a louvain-assigned community and colour).
      { id: "concept:A", type: "concept", label: "A", color: "#ABCDEF", size: 30, frequency: 42, community_id: 9, source_patents: ["P1", "P2"] },
      { id: "concept:B", type: "concept", label: "B", color: "#FEDCBA", size: 25, frequency: 17, community_id: 9, source_patents: ["P1"] },
    ],
    edges: [
      { id: "s1", from: "applicant:X", to: "patent:P1", relation: "申請了", kind: "structural" },
      { id: "s2", from: "applicant:X", to: "patent:P2", relation: "申請了", kind: "structural" },
      { id: "s3", from: "patent:P1", to: "concept:A", relation: "包含", kind: "structural" },
      { id: "s4", from: "patent:P1", to: "concept:B", relation: "包含", kind: "structural" },
      { id: "s5", from: "patent:P2", to: "concept:A", relation: "包含", kind: "structural" },
      // Stored cooccurrence edge. Legacy would drop this exact edge (id and
      // support_count included) and substitute a freshly computed one.
      {
        id: "co-stored",
        from: "concept:A",
        to: "concept:B",
        relation: "共同出現",
        kind: "cooccurrence",
        support_count: 7,
        jaccard: 0.25,
        source_patents: ["P1"],
      },
      {
        id: "sem-stored",
        from: "concept:A",
        to: "concept:B",
        relation: "支援",
        kind: "semantic",
        weight: 4,
        confidence: "EXTRACTED",
        source_patents: ["P1"],
        evidence: [{ patent_id: "P1", weight: 4, reason: "原始理由", confidence: "EXTRACTED" }],
      },
    ],
    communities: [{ id: 9, name: "自訂社群", color: "#ABCDEF", node_count: 2 }],
    stats: { applicant_count: 1, patent_count: 2, concept_count: 2, community_count: 1, year_range: [2020, 2021] },
    ai_report: "v3 report",
    generated_at: "2026-08-05T00:00:00.000Z",
    methodology: {
      concept_frequency_metric: "unique_patent_count",
      cooccurrence_metric: "unique_patent_support",
      concept_size_formula: "clamp(10 + 6 * sqrt(frequency), 10, 52)",
      applicant_size_formula: "clamp(18 + 5 * sqrt(patent_count), 18, 52)",
      patent_size: 14,
      community_algorithm: "louvain",
      community_edge_weight: "support_count",
      community_resolution: 1,
      community_random_walk: false,
      layout_distance_interpretation: "visual_only",
      prompt_version: "p0-v3-test",
      model_provider: "test-provider",
      model_id: "test-model",
      cooccurrence_data: "native",
      semantic_provenance: "complete",
    },
  };
}

describe("normalizeGraphData 對 v3 的分派（§6.3 #5 資料毀損防線）", () => {
  it("v3 不得落進 normalizeLegacy()：版本原樣傳遞", () => {
    const graph = normalizeGraphData(v3Graph());
    expect(graph).not.toBeNull();
    expect(graph?.schema_version).toBe(3);
  });

  it("v3 已儲存的 cooccurrence 邊不得被丟棄或重算", () => {
    const graph = normalizeGraphData(v3Graph());
    const co = graph?.edges.filter((edge) => edge.kind === "cooccurrence") ?? [];

    // Legacy would emit a rebuilt edge with a stableEdgeId, support_count 1 and
    // jaccard 1/2 — never the stored id/values below.
    expect(co).toHaveLength(1);
    expect(co[0].id).toBe("co-stored");
    expect(co[0].support_count).toBe(7);
    expect(co[0].jaccard).toBe(0.25);
  });

  it("v3 的 frequency／community_id／color 不得被覆寫", () => {
    const graph = normalizeGraphData(v3Graph());
    const a = graph?.nodes.find((node) => node.id === "concept:A");
    const b = graph?.nodes.find((node) => node.id === "concept:B");

    expect(a?.frequency).toBe(42);
    expect(a?.community_id).toBe(9);
    expect(a?.color).toBe("#ABCDEF");
    expect(a?.size).toBe(30);
    expect(b?.frequency).toBe(17);
    expect(b?.color).toBe("#FEDCBA");

    // Legacy also rewrites applicant patent_count / size and patent size.
    const applicant = graph?.nodes.find((node) => node.id === "applicant:X");
    expect(applicant?.patent_count).toBe(2);
    expect(applicant?.size).toBe(20);
  });

  it("v3 的 methodology 不得被重設為 v1.2 預設值", () => {
    const graph = normalizeGraphData(v3Graph());

    // methodologyDefaults() would yield 'legacy-unknown' / 'unknown' /
    // 'reconstructed', so these four assertions are the sharpest legacy tripwire.
    expect(graph?.methodology.prompt_version).toBe("p0-v3-test");
    expect(graph?.methodology.model_provider).toBe("test-provider");
    expect(graph?.methodology.model_id).toBe("test-model");
    expect(graph?.methodology.cooccurrence_data).toBe("native");
    expect(graph?.methodology.semantic_provenance).toBe("complete");
  });

  it("v3 的社群清單與 semantic 邊證據原樣保留", () => {
    const graph = normalizeGraphData(v3Graph());

    expect(graph?.communities).toEqual([
      { id: 9, name: "自訂社群", color: "#ABCDEF", node_count: 2 },
    ]);

    // Legacy strips support_count and regenerates evidence from edge.weight/reason.
    const semantic = graph?.edges.find((edge) => edge.kind === "semantic");
    expect(semantic?.evidence?.[0]).toMatchObject({ patent_id: "P1", reason: "原始理由" });

    // Legacy recomputes analysis from the rebuilt network; the v2 path keeps the
    // stored analysis, which this fixture omits.
    expect(graph?.analysis).toBeUndefined();
  });

  it("v3 專利節點的 P0 新欄位（ipc5／source_files 等）原樣通過", () => {
    const graph = normalizeGraphData(v3Graph());
    const p1 = graph?.nodes.find((node) => node.id === "patent:P1");

    expect(p1?.ipc5).toEqual(["G06Q10/10"]);
    expect(p1?.ipc_primary).toBe("G06Q10/10");
    expect(p1?.ipc_depth).toBe(5);
    expect(p1?.source_files).toEqual(["a.xlsx"]);
    expect(p1?.cited_by_count).toBe(3);
    expect(p1?.case_status).toBe("核准");

    // Missing values must stay undefined — never 0 or an empty string (§6.1).
    const p2 = graph?.nodes.find((node) => node.id === "patent:P2");
    expect(p2?.ipc5).toBeUndefined();
    expect(p2?.cited_by_count).toBeUndefined();
    expect(p2?.case_status).toBeUndefined();

    expect(graph?.nodes.find((node) => node.id === "applicant:X")?.applicant_key).toBe("X");
  });

  it("沒有任何節點或邊的數值變成 NaN", () => {
    const graph = normalizeGraphData(v3Graph());
    for (const node of graph?.nodes ?? []) {
      expect(Number.isNaN(node.size)).toBe(false);
      if (node.frequency !== undefined) expect(Number.isNaN(node.frequency)).toBe(false);
      if (node.patent_count !== undefined) expect(Number.isNaN(node.patent_count)).toBe(false);
    }
    expect(graph?.stats.year_range.some(Number.isNaN)).toBe(false);
  });
});

describe("normalizeGraphData 的 v2 回歸與 pre-v2 legacy 路徑", () => {
  /** The same fixture relabelled as v2; behaviour must be unchanged from v1.2. */
  function v2Graph(): Record<string, unknown> {
    return { ...v3Graph(), schema_version: 2 };
  }

  it("v2 進 → v2 出，且與 v3 走同一條保留路徑", () => {
    const asV2 = normalizeGraphData(v2Graph());
    const asV3 = normalizeGraphData(v3Graph());

    expect(asV2?.schema_version).toBe(2);
    expect(asV2?.methodology).toEqual(asV3?.methodology);
    expect(asV2?.edges).toEqual(asV3?.edges);
    expect(asV2?.nodes).toEqual(asV3?.nodes);
    expect(asV2?.communities).toEqual(asV3?.communities);
  });

  it("真正的 pre-v2（無 schema_version）仍走 legacy 重建路徑並升為 2", () => {
    const raw = v3Graph();
    delete raw.schema_version;
    const graph = normalizeGraphData(raw);

    expect(graph?.schema_version).toBe(2);
    // Proof the legacy rebuild really ran on this input.
    expect(graph?.methodology.cooccurrence_data).toBe("reconstructed");
    expect(graph?.methodology.prompt_version).toBe("legacy-unknown");
    expect(graph?.edges.some((edge) => edge.id === "co-stored")).toBe(false);
    expect(graph?.nodes.find((node) => node.id === "concept:A")?.frequency).toBe(2);
    expect(graph?.analysis).toBeDefined();
  });

  it("未知的 schema_version（例如 4）保守走 legacy，不被當成 v3", () => {
    const graph = normalizeGraphData({ ...v3Graph(), schema_version: 4 });
    expect(graph?.schema_version).toBe(2);
    expect(graph?.methodology.cooccurrence_data).toBe("reconstructed");
  });
});

/**
 * `buildGraph()` now writes `schema_version: 3` on every freshly generated
 * graph. This guards the write side (the literal in lib/graph-builder.ts)
 * together with the read side already covered above: a real `buildGraph()`
 * output must round-trip through `normalizeGraphData()` on the v3 pass-through
 * path, not fall through to the legacy rebuild.
 */
describe("buildGraph() 產生的圖：schema_version 升版與 normalizeGraphData 分派", () => {
  const patents: PatentRow[] = [
    { id: "P1", title: "專利一", abstract: "", applicant: "X" },
  ];

  function extraction(patent_id: string, keywords: string[]): ExtractionResult {
    return { patent_id, translated_abstract: "", keywords, relations: [] };
  }

  function freshGraph(): GraphData {
    const network = buildConceptNetwork([extraction("P1", ["A", "B"])]);
    const communities = detectCommunities(network);
    return buildGraph(
      patents,
      network,
      communities.assignments,
      communities.colors,
      communities.names,
      { prompt_version: "test", model_provider: "test", model_id: "test" },
    );
  }

  it("buildGraph() 回傳的 schema_version 是 3", () => {
    const graph = freshGraph();
    expect(graph.schema_version).toBe(3);
  });

  it("經 normalizeGraphData() 後仍是 3，且沒有被誤判成需要 legacy 重建", () => {
    const graph = freshGraph();
    const normalized = normalizeGraphData(graph);

    expect(normalized).not.toBeNull();
    expect(normalized?.schema_version).toBe(3);
    // These two fields are what the legacy rebuild path overwrites with
    // 'reconstructed' / 'legacy-unknown' defaults — if dispatch were wrong
    // they would no longer match what buildGraph() actually produced.
    expect(normalized?.methodology.cooccurrence_data).toBe(graph.methodology.cooccurrence_data);
    expect(normalized?.methodology.semantic_provenance).toBe(graph.methodology.semantic_provenance);
    expect(normalized?.methodology).toEqual(graph.methodology);
  });
});

describe("buildGraph 的 P0 節點欄位（§6.1）", () => {
  function extraction(patent_id: string, keywords: string[]): ExtractionResult {
    return { patent_id, translated_abstract: "", keywords, relations: [] };
  }

  function build(patents: PatentRow[]): GraphData {
    const network = buildConceptNetwork([extraction("P1", ["A", "B"]), extraction("P2", ["A"])]);
    const communities = detectCommunities(network);
    return buildGraph(patents, network, communities.assignments, communities.colors, communities.names, {
      prompt_version: "test",
      model_provider: "test",
      model_id: "test",
    });
  }

  const patents: PatentRow[] = [
    {
      id: "P1",
      title: "專利一",
      abstract: "摘要一",
      applicant: "甲股份有限公司",
      filing_date: "2020-01-02",
      ipc5: ["G06Q10/10", "G06Q50/10"],
      ipc5_raw: ["G06Q-010/10", "G06Q-050/10"],
      ipc_primary: "G06Q10/10",
      ipc_depth: 5,
      source_files: ["專利彙整.xlsx"],
      cited_by_count: 4,
      case_status: "核准",
    },
    // Second row deliberately carries none of the new fields.
    { id: "P2", title: "專利二", abstract: "摘要二", applicant: "乙公司" },
  ];

  it("專利節點帶上 ipc5／ipc_primary／ipc_depth／source_files／cited_by_count／case_status", () => {
    const graph = build(patents);
    const p1 = graph.nodes.find((node) => node.id === "patent:P1");

    expect(p1?.ipc5).toEqual(["G06Q10/10", "G06Q50/10"]);
    expect(p1?.ipc_primary).toBe("G06Q10/10");
    expect(p1?.ipc_depth).toBe(5);
    expect(p1?.source_files).toEqual(["專利彙整.xlsx"]);
    expect(p1?.cited_by_count).toBe(4);
    expect(p1?.case_status).toBe("核准");
  });

  it("缺欄的專利留 undefined，不得冒充 0 或空字串", () => {
    const graph = build(patents);
    const p2 = graph.nodes.find((node) => node.id === "patent:P2");

    expect(p2?.ipc5).toBeUndefined();
    expect(p2?.ipc_primary).toBeUndefined();
    expect(p2?.ipc_depth).toBeUndefined();
    expect(p2?.source_files).toBeUndefined();
    expect(p2?.cited_by_count).toBeUndefined();
    expect(p2?.case_status).toBeUndefined();
  });

  it("節點 id 前綴仍是 patent:${id}（四處程式依賴）", () => {
    const graph = build(patents);
    expect(graph.nodes.filter((node) => node.type === "patent").map((node) => node.id)).toEqual([
      "patent:P1",
      "patent:P2",
    ]);
  });

  it("申請人節點帶上 applicant_key，但 label 與 id 逐字元不變（§7-5）", () => {
    const graph = build(patents);
    const a = graph.nodes.find((node) => node.id === "applicant:甲股份有限公司");

    expect(a?.label).toBe("甲股份有限公司");
    expect(a?.applicant_key).toBe(normalizeApplicantName("甲股份有限公司"));
    // The key really normalises — it is not just a copy of the label.
    expect(a?.applicant_key).toBe("甲公司");
    // …and normalisation does NOT merge the nodes: both applicants survive.
    expect(graph.nodes.filter((node) => node.type === "applicant")).toHaveLength(2);
  });

  it("概念節點帶上 source_patents", () => {
    const graph = build(patents);
    const a = graph.nodes.find((node) => node.id === "concept:A");
    const b = graph.nodes.find((node) => node.id === "concept:B");

    expect(a?.source_patents).toEqual(["P1", "P2"]);
    expect(b?.source_patents).toEqual(["P1"]);
  });
});
