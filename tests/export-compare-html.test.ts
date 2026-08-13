import { describe, expect, it } from "vitest";
import { buildCompareExportHtml } from "../lib/export-compare-html";
import {
  compareAnnotationLines,
  compareExportFilename,
  compareLegendItems,
  commonFilterSummary,
  scopeLabel,
} from "../lib/compare-export";
import { buildDifferenceView, DIFF_COLORS } from "../lib/graph-compare";
import type { GraphViewData } from "../lib/graph-view";
import type { GraphEdge, GraphNode } from "../types/graph";

const ALL = ["a.xlsx", "b.xlsx"];

const MALICIOUS = "</script><img src=x onerror=alert(1)>";

function node(id: string, label?: string): GraphNode {
  return {
    id,
    type: "concept",
    label: label ?? id,
    color: "#111111",
    size: 12,
    frequency: 1,
  };
}

function edge(id: string, from: string, to: string): GraphEdge {
  return {
    id,
    from,
    to,
    relation: "cooccurrence",
    kind: "cooccurrence",
    support_count: 2,
    jaccard: 0.5,
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
    maxSupport: 2,
    citationEdges: [],
  };
}

const viewA = view(
  [node("n1"), node("n2", MALICIOUS)],
  [edge("e1", "n1", "n2")],
);
const viewB = view(
  [node("n2", MALICIOUS), node("n3")],
  [edge("e2", "n2", "n3")],
);
const difference = buildDifferenceView([viewA, viewB]);

const positions = {
  n1: { x: 12.5, y: -4 },
  n2: { x: 0, y: 99.25 },
  n3: { x: -30, y: 7 },
};

function html(
  overrides: Partial<Parameters<typeof buildCompareExportHtml>[0]> = {},
): string {
  return buildCompareExportHtml(
    {
      jobId: "job-1234abcd",
      difference,
      positions,
      labels: [scopeLabel(["a.xlsx"], ALL), scopeLabel(["b.xlsx"], ALL)],
      metrics: difference.metrics,
      tab: "difference",
      mode: "concept",
      unit: "patent",
      colorMode: "community",
      edgeWeight: "jaccard",
      minSupport: 2,
      yearRange: [2010, 2020],
      showCitations: false,
      ...overrides,
    },
    "window.vis = {};",
  );
}

describe("compare-export 文案", () => {
  it("scopeLabel：空選擇＝全部來源，部分選擇列出檔名", () => {
    expect(scopeLabel([], ALL)).toBe("全部來源（2 檔）");
    expect(scopeLabel(ALL, ALL)).toBe("全部來源（2 檔）");
    expect(scopeLabel(["b.xlsx"], ALL)).toBe("b.xlsx");
    expect(scopeLabel([], [])).toBe("（無來源檔）");
  });

  it("共用篩選摘要含模式、單位、年份、門檻與著色", () => {
    const lines = commonFilterSummary({
      mode: "institution",
      unit: "applicant",
      colorMode: "ipc",
      edgeWeight: "npmi",
      minSupport: 3,
      yearRange: [2007, 2025],
      ipcLevel: 4,
      ipcFilter: ["G06Q10"],
      showCitations: true,
    });
    expect(lines[0]).toContain("機構網路");
    expect(lines[0]).toContain("家（機構）");
    expect(lines[1]).toContain("2007–2025");
    expect(lines[1]).toContain("≥ 3");
    expect(lines[1]).toContain("NPMI");
    expect(lines[2]).toContain("IPC 分類");
    expect(lines[3]).toContain("L4");
    expect(lines[3]).toContain("G06Q10");
  });

  it("沒有 IPC 篩選就不多印一行", () => {
    expect(
      commonFilterSummary({
        mode: "concept",
        unit: "patent",
        colorMode: "community",
        edgeWeight: "jaccard",
        minSupport: 1,
        yearRange: [2010, 2020],
      }),
    ).toHaveLength(3);
  });

  it("註記含 A/B 標籤與節點、邊指標", () => {
    const lines = compareAnnotationLines({
      labels: ["a.xlsx", "b.xlsx"],
      metrics: difference.metrics,
      tab: "difference",
      mode: "concept",
      unit: "patent",
      colorMode: "community",
      edgeWeight: "jaccard",
      minSupport: 1,
      yearRange: [2010, 2020],
    });
    expect(lines[0]).toBe("A（左）：a.xlsx");
    expect(lines[1]).toBe("B（右）：b.xlsx");
    expect(lines.some((line) => line.startsWith("節點：僅 A 1"))).toBe(true);
    expect(lines.some((line) => line.includes("Jaccard 0.333"))).toBe(true);
    expect(lines[lines.length - 1]).toContain("三角形節點");
  });

  it("三面板註記改用「面板 N」與層級指標", () => {
    const three = buildDifferenceView([viewA, viewB, viewA]);
    const lines = compareAnnotationLines({
      labels: ["a.xlsx", "b.xlsx", "a.xlsx"],
      metrics: three.metrics,
      tab: "difference",
      mode: "concept",
      unit: "patent",
      colorMode: "community",
      edgeWeight: "jaccard",
      minSupport: 1,
      yearRange: [2010, 2020],
    });
    expect(lines[0]).toBe("面板 1：a.xlsx");
    expect(lines[2]).toBe("面板 3：a.xlsx");
    expect(lines.some((line) => line.startsWith("節點：僅 1 組"))).toBe(true);
    expect(lines[lines.length - 1]).toContain("全部 3 組共有");
  });

  it("圖例為三組、附形狀說明", () => {
    const legend = compareLegendItems(2);
    expect(legend.map((item) => item.membership)).toEqual(["a", "b", "shared"]);
    expect(legend.map((item) => item.color)).toEqual([
      DIFF_COLORS.a,
      DIFF_COLORS.b,
      DIFF_COLORS.shared,
    ]);
    expect(legend[2].encoding).toContain("實線");
  });

  it("三面板圖例為 unique／partial／shared，shared 帶面板數", () => {
    const legend = compareLegendItems(3);
    expect(legend.map((item) => item.membership)).toEqual([
      "unique",
      "partial",
      "shared",
    ]);
    expect(legend[2].label).toBe("全部 3 組共有");
    expect(legend.map((item) => item.color)).toEqual([
      DIFF_COLORS.unique,
      DIFF_COLORS.partial,
      DIFF_COLORS.shared,
    ]);
  });

  it("檔名帶檢視別與日期，並過濾非法字元", () => {
    const now = new Date(2026, 1, 3);
    expect(
      compareExportFilename("job/../1234", "png", "side-by-side", now),
    ).toBe("patent-graph-compare-side-job1234-20260203.png");
    expect(compareExportFilename("abcdefgh12", "html", "difference", now)).toBe(
      "patent-graph-compare-diff-abcdefgh-20260203.html",
    );
  });
});

describe("buildCompareExportHtml", () => {
  it("產生完整 HTML，含標題、A/B 摘要與指標", () => {
    const out = html();
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain("專利知識圖譜比較");
    expect(out).toContain("Job job-1234abcd");
    expect(out).toContain("A（左）：a.xlsx");
    expect(out).toContain("B（右）：b.xlsx");
    expect(out).toContain("節點：僅 A 1");
    expect(out).toContain("關係邊：僅 A 1");
    // 兩面板以 panelCount 為閘門，不套用「見於面板」tooltip（舊版行為保留）
    expect(out).toContain("var manyPanels = payload.panelCount > 2;");
    expect(out).toContain('"panelCount":2');
  });

  it("三面板 HTML：面板標籤、層級圖例與見於面板的 tooltip", () => {
    const three = buildDifferenceView([viewA, viewB, viewA]);
    const out = buildCompareExportHtml(
      {
        jobId: "job-1234abcd",
        difference: three,
        positions,
        labels: ["a.xlsx", "b.xlsx", "a.xlsx"],
        metrics: three.metrics,
        tab: "difference",
        mode: "concept",
        unit: "patent",
        colorMode: "community",
        edgeWeight: "jaccard",
        minSupport: 2,
        yearRange: [2010, 2020],
        showCitations: false,
      },
      "window.vis = {};",
    );
    expect(out).toContain("面板 3：a.xlsx");
    expect(out).toContain("全部 3 組共有");
    expect(out).toContain('data-membership="unique"');
    expect(out).toContain('data-membership="partial"');
    // 節點 n1 在面板 1、3 都出現 → partial；n2 三面板全有 → shared；n3 僅面板 2 → unique
    expect(out).toContain(
      '"nodeMembership":{"n1":"partial","n2":"shared","n3":"unique"}',
    );
    expect(out).toContain('"nodePanels":{"n1":[1,3],"n2":[1,2,3],"n3":[2]}');
    expect(out).toContain("見於：面板");
  });

  it("圖例三組皆可切換顯示，且帶冗餘編碼說明", () => {
    const out = html();
    expect(out).toContain('data-membership="a"');
    expect(out).toContain('data-membership="b"');
    expect(out).toContain('data-membership="shared"');
    expect(out).toContain("三角形節點／長虛線");
    expect(out).toContain(DIFF_COLORS.shared);
    expect(out).toContain("applyVisibility");
  });

  it("凍結座標原封不動寫進 payload，且節點被釘住", () => {
    const out = html();
    expect(out).toContain('"positions":{"n1":{"x":12.5,"y":-4}');
    expect(out).toContain("fixed: { x: true, y: true }");
    expect(out).toContain("physics: { enabled: false }");
  });

  it("保留圖譜關係語意：結構／時間邊有箭頭，線寬依選定指標推導", () => {
    const temporal = buildDifferenceView([
      view(
        [node("n1"), node("n2")],
        [{ ...edge("e1", "n1", "n2"), temporal_directed: true, npmi: 0.6 }],
      ),
      view([], []),
    ]);
    const out = buildCompareExportHtml(
      {
        jobId: "job-1234abcd",
        difference: temporal,
        positions: { n1: { x: 0, y: 0 }, n2: { x: 1, y: 1 } },
        labels: ["a.xlsx", "b.xlsx"],
        metrics: temporal.metrics,
        tab: "difference",
        mode: "context",
        unit: "patent",
        colorMode: "community",
        edgeWeight: "npmi",
        minSupport: 1,
        yearRange: [2010, 2020],
        showCitations: false,
      },
      "window.vis = {};",
    );
    expect(out).toContain('"temporal_directed":true');
    expect(out).toContain('"npmi":0.6');
    expect(out).toContain(
      "edge.kind === 'semantic' || edge.temporal_directed || edge.kind === 'structural'",
    );
    expect(out).toContain("if (payload.edgeWeight === 'npmi')");
    expect(out).toContain("Number(npmi || 0)");
  });

  it("membership 對照表完整寫入，離線端才切得動", () => {
    const out = html();
    expect(out).toContain('"nodeMembership":{"n1":"a","n2":"shared","n3":"b"}');
    expect(out).toContain('"edgeMembership":{"e1":"a","e2":"b"}');
  });

  it("沒有任何外部資源：vis-network 內嵌為 data URL", () => {
    const out = html();
    const externalScripts = out.match(/<script src="(?!data:)[^"]*"/g);
    expect(externalScripts).toBeNull();
    expect(out).toContain('<script src="data:text/javascript;base64,');
    expect(out).not.toContain("https://");
    expect(out).not.toContain("unpkg");
  });

  it("惡意標籤不會逃出 inline script 或 HTML 標記", () => {
    const out = html();
    // 標籤只存在於 JSON payload，且 `<` 已被轉義
    expect(out).not.toContain(MALICIOUS);
    expect(out).toContain("\\u003c/script>\\u003cimg src=x onerror=alert(1)>");
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("A/B 標籤中的 HTML 會被跳脫", () => {
    const out = html({ labels: ["<b>x</b>", '"y"'] });
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(out).not.toContain("<b>x</b>");
    expect(out).toContain("&quot;y&quot;");
  });

  it("jobId 中的 HTML 會被跳脫", () => {
    const out = html({ jobId: "<script>alert(1)</script>" });
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("引用層依 showCitations 決定是否寫入", () => {
    expect(html({ showCitations: false })).toContain('"citationEdges":[]');
  });
});
