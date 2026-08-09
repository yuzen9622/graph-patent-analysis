import { describe, expect, it } from "vitest";
import {
  buildExportHtml,
  escapeHtml,
  parseExportOptions,
  safeSerializeForInlineScript,
} from "../lib/export-html";
import {
  ExportBodyTooLargeError,
  ExportPositionsError,
  MAX_FROZEN_POSITION_ENTRIES,
  parseExportPositions,
  readExportJsonBody,
} from "../lib/export-positions";
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

describe("frozen export position validation", () => {
  const expectedIds = ["alpha", "beta"];

  it("accepts a complete exact position set", () => {
    expect(
      parseExportPositions(
        {
          positions: {
            alpha: { x: 12.5, y: -4 },
            beta: { x: 0, y: 99.25 },
          },
        },
        expectedIds,
      ),
    ).toEqual({
      alpha: { x: 12.5, y: -4 },
      beta: { x: 0, y: 99.25 },
    });
  });

  it("rejects malformed bodies", () => {
    expect(() => parseExportPositions(null, expectedIds)).toThrow(ExportPositionsError);
    expect(() => parseExportPositions({ positions: [] }, expectedIds)).toThrow(ExportPositionsError);
    expect(() => parseExportPositions({ positions: {}, extra: true }, expectedIds)).toThrow(ExportPositionsError);
  });

  it("rejects partial or extra node ID sets", () => {
    expect(() => parseExportPositions({ positions: { alpha: { x: 1, y: 2 } } }, expectedIds)).toThrow(ExportPositionsError);
    expect(() => parseExportPositions({ positions: {
      alpha: { x: 1, y: 2 },
      beta: { x: 3, y: 4 },
      extra: { x: 5, y: 6 },
    } }, expectedIds)).toThrow(ExportPositionsError);
  });

  it("rejects non-finite or non-strict coordinates", () => {
    expect(() => parseExportPositions({ positions: {
      alpha: { x: Infinity, y: 2 },
      beta: { x: 3, y: 4 },
    } }, expectedIds)).toThrow(ExportPositionsError);
    expect(() => parseExportPositions({ positions: {
      alpha: { x: 1, y: 2, z: 3 },
      beta: { x: 3, y: 4 },
    } }, expectedIds)).toThrow(ExportPositionsError);
  });

  it("caps position entries at 50,000", () => {
    const positions = Object.fromEntries(
      Array.from({ length: MAX_FROZEN_POSITION_ENTRIES + 1 }, (_, index) => [
        `node-${index}`,
        { x: index, y: -index },
      ]),
    );
    expect(() => parseExportPositions({ positions }, [])).toThrow(ExportPositionsError);
  });
});

describe("export request body reader", () => {
  it("parses valid JSON from a real Request", async () => {
    const body = { positions: { alpha: { x: 1, y: -2 } } };
    const request = new Request("http://localhost/api/export/job-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    await expect(readExportJsonBody(request)).resolves.toEqual(body);
  });

  it("surfaces malformed JSON as a SyntaxError", async () => {
    const request = new Request("http://localhost/api/export/job-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"positions":',
    });

    await expect(readExportJsonBody(request)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects an oversized valid Content-Length before consuming the body", async () => {
    const request = new Request("http://localhost/api/export/job-id", {
      method: "POST",
      headers: { "Content-Length": "9" },
      body: "{}",
    });

    await expect(readExportJsonBody(request, 8)).rejects.toBeInstanceOf(ExportBodyTooLargeError);
    await expect(request.text()).resolves.toBe("{}");
  });

  it("rejects an oversized streamed body with the supplied byte limit", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"value":'));
        controller.enqueue(encoder.encode("true}"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://localhost/api/export/job-id", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readExportJsonBody(request, 10)).rejects.toBeInstanceOf(ExportBodyTooLargeError);
    expect(cancelled).toBe(true);
  });
});

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

  it("embeds exact frozen positions for the active mode and keeps fallback layout behavior", () => {
    const frozenPositions = { "concept:<X>": { x: 123.5, y: -456.75 } };
    const html = buildExportHtml(
      "job-id",
      graph,
      {
        mode: "concept",
        showSemantic: false,
        paper: true,
        minSupport: 1,
        yearRange: [2020, 2022],
      },
      "window.vis = {};",
      frozenPositions,
    );
    const data = html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    expect(data).toBeTruthy();
    expect(JSON.parse(data!)).toMatchObject({
      frozenLayouts: { concept: frozenPositions },
    });

    const runtimeScript = html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
    expect(runtimeScript).toBeTruthy();
    expect(runtimeScript).toContain("var useFrozenLayout = Boolean(frozenLayout);");
    expect(runtimeScript).toContain("physics: { enabled: false }");
    expect(runtimeScript).toContain("if (!useFrozenLayout) {");
    expect(runtimeScript).toContain("stabilization: { iterations: 180 }");
    expect(runtimeScript).toContain("network.fit({ animation: false });");
    expect(() => new Function(runtimeScript!)).not.toThrow();

    const legacyHtml = buildExportHtml(
      "job-id",
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
    const legacyData = legacyHtml.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    expect(JSON.parse(legacyData!).frozenLayouts).toEqual({});
    expect(legacyHtml).toContain("temporalLayouts");
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
