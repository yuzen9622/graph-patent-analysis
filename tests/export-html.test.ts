import { describe, expect, it } from "vitest";
import {
  buildExportHtml,
  escapeHtml,
  parseExportOptions,
  safeSerializeForInlineScript,
} from "../lib/export-html";
import type { GraphData } from "../types/graph";

const graph: GraphData = {
  schema_version: 2,
  nodes: [
    { id: "concept:<X>", type: "concept", label: "</script><img src=x onerror=alert(1)>", color: "#000", size: 16, frequency: 1, community_id: 0 },
  ],
  edges: [],
  communities: [{ id: 0, name: "群", color: "#000", node_count: 1 }],
  stats: { applicant_count: 0, patent_count: 0, concept_count: 1, community_count: 1, year_range: [2020, 2022] },
  ai_report: "",
  generated_at: "2026-01-01T00:00:00.000Z",
  methodology: {
    concept_frequency_metric: "unique_patent_count",
    cooccurrence_metric: "unique_patent_support",
    concept_size_formula: "x",
    applicant_size_formula: "x",
    patent_size: 18,
    community_algorithm: "louvain",
    community_edge_weight: "support_count",
    community_resolution: "</footer><script>alert('resolution')</script>" as unknown as number,
    community_random_walk: false,
    layout_distance_interpretation: "visual_only",
    prompt_version: "test",
    model_provider: "test",
    model_id: "model<&\"'\u2028\u2029",
    cooccurrence_data: "native",
    semantic_provenance: "complete",
  },
};

describe("offline export security and parity", () => {
  it("安全序列化內嵌 JSON 並跳脫 HTML 屬性文字", () => {
    const serialized = safeSerializeForInlineScript({ value: "</script>\u2028\u2029" });
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script>");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(escapeHtml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
  });

  it("allowlist 查詢參數、夾限數值並修正反向年份", () => {
    const options = parseExportOptions(
      new URLSearchParams("mode=anything&llm=yes&paper=false&minSupport=999&yearStart=2022&yearEnd=2020"),
      graph,
    );
    expect(options).toEqual({
      mode: "concept",
      showSemantic: false,
      paper: false,
      minSupport: 1,
      yearRange: [2020, 2022],
      colorMode: "community",
      unit: "patent",
      edgeWeight: "jaccard",
      ipcLevel: 3,
      temporalReference: "active",
      showCitations: false,
    });
  });

  it("接受 IPC 參數（colorMode=ipc / ipcLevel / ipc= 多值）", () => {
    const options = parseExportOptions(
      new URLSearchParams("colorMode=ipc&ipcLevel=4&ipc=G06Q10&ipc=H04L9"),
      graph,
    );
    expect(options).toMatchObject({
      colorMode: "ipc",
      ipcLevel: 4,
      ipcFilter: ["G06Q10", "H04L9"],
    });
  });

  it("接受 institution 模式、家單位、NPMI 線寬與社群色（家）", () => {
    const options = parseExportOptions(
      new URLSearchParams(
        "mode=institution&unit=applicant&ew=npmi&colorMode=community_applicants&paper=1&minSupport=2",
      ),
      graph,
    );
    expect(options).toMatchObject({
      mode: "institution",
      unit: "applicant",
      edgeWeight: "npmi",
      colorMode: "community_applicants",
      paper: true,
      minSupport: 1,
    });
  });

  it("匯出頁使用共用檢視邏輯且動態提示只寫入 textContent", () => {
    const html = buildExportHtml(
      "job</title><script>alert(1)</script>",
      graph,
      {
        mode: "concept",
        showSemantic: false,
        paper: true,
        minSupport: 1,
        yearRange: [2020, 2022],
      },
      "window.vis = {};",
    );
    expect(html).not.toContain("job</title>");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("tooltip.textContent");
    expect(html).not.toContain("tooltip.innerHTML");
    expect(html).toContain("Vertical position indicates the ordinal ranking of median application year and does not imply causality or proportional temporal distance.");
    expect(html).toContain("quality_year_bounds");
    expect(html).toContain("τ=5 is a visualization heuristic");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("data:text/javascript;base64,");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("</footer><script>alert('resolution')</script>");
    expect(html).toContain("data-mode=\"concept\"");
    expect(html).toContain("data-mode=\"context\"");
    expect(html).toContain("temporalLayouts");
    expect(html).toContain("citation-toggle");
    expect(html).toContain("view.citationEdges");
    const runtimeScript = html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
    expect(runtimeScript).toBeTruthy();
    expect(() => new Function(runtimeScript!)).not.toThrow();
  });
});
