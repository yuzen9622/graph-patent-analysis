import { describe, expect, it } from "vitest";
import {
  applicantSize,
  buildConceptNetwork,
  conceptSize,
  PATENT_NODE_SIZE,
} from "../lib/concept-network";
import { buildSynonymMap } from "../lib/synonyms";
import type { ExtractionResult } from "../types/graph";

function extraction(
  patent_id: string,
  keywords: string[],
  relations: ExtractionResult["relations"] = [],
): ExtractionResult {
  return { patent_id, translated_abstract: "", keywords, relations };
}

describe("buildConceptNetwork", () => {
  it("以不同專利篇數計算概念頻率、support 與 Jaccard", () => {
    const result = buildConceptNetwork([
      extraction("P1", ["A", "A", " B "]),
      extraction("P2", ["A", "B"]),
      extraction("P3", ["A", "C"]),
    ]);

    expect(result.concepts.get("A")).toMatchObject({
      frequency: 3,
      source_patents: ["P1", "P2", "P3"],
    });
    expect(result.concepts.get("B")?.frequency).toBe(2);
    expect(result.concepts.get("C")?.frequency).toBe(1);

    const ab = result.cooccurrenceEdges.find(
      (edge) => edge.from === "concept:A" && edge.to === "concept:B",
    );
    const ac = result.cooccurrenceEdges.find(
      (edge) => edge.from === "concept:A" && edge.to === "concept:C",
    );
    expect(ab).toMatchObject({ support_count: 2, source_patents: ["P1", "P2"] });
    expect(ab?.jaccard).toBeCloseTo(2 / 3);
    expect(ac?.support_count).toBe(1);
    expect(ac?.jaccard).toBeCloseTo(1 / 3);
  });

  it("產生穩定邊 ID，並只聚合端點存在於同篇關鍵詞的 LLM 關係", () => {
    const inputs = [
      extraction("P1", ["A", "B"], [
        { source: "A", target: "B", relation: "支援", weight: 3, reason: "r1" },
        { source: "A", target: "不存在", relation: "誤連", weight: 5 },
      ]),
      extraction("P2", ["B", "A"], [
        { source: "A", target: "B", relation: "支援", weight: 5, reason: "r2" },
      ]),
    ];
    const first = buildConceptNetwork(inputs);
    const second = buildConceptNetwork([...inputs].reverse());

    expect(first.cooccurrenceEdges.map((edge) => edge.id)).toEqual(
      second.cooccurrenceEdges.map((edge) => edge.id),
    );
    expect(first.semanticEdges).toHaveLength(1);
    expect(first.semanticEdges[0]).toMatchObject({
      support_count: 2,
      source_patents: ["P1", "P2"],
      weight: 4,
    });
    expect(first.semanticEdges[0].evidence).toHaveLength(2);
  });

  describe("PRD v2 / P1 同義詞輸入層合併", () => {
    const AI = buildSynonymMap([
      { id: "g1", canonical: "人工智慧", aliases: ["AI", "智慧型"], note: undefined },
    ]).map;

    it("合併為單一概念，frequency 取篇數聯集", () => {
      const result = buildConceptNetwork(
        [
          extraction("P1", ["人工智慧", "區塊鏈"]),
          extraction("P2", ["AI", "區塊鏈"]),
          extraction("P3", ["智慧型", "風控"]),
        ],
        AI,
      );

      // 三個拼法對到同一 canonical → 一個節點，frequency=3
      expect(result.concepts.get("人工智慧")).toMatchObject({
        frequency: 3,
        source_patents: ["P1", "P2", "P3"],
      });
      expect(result.concepts.has("AI")).toBe(false);
      expect(result.concepts.has("智慧型")).toBe(false);
    });

    it("共現邊聯集：同義對的支持數合併，不得丟棄後到（decision #6 的原 bug）", () => {
      // 若在聚合後才合併：(AI, 區塊鏈) 與 (人工智慧, 區塊鏈) 會 hash 成同一個
      // edge id，addEdge() 丟掉第二條 → support 只有 1。
      // 輸入層合併先 normalize 再聚合 → 同一 key → support = 2（並集）。
      const result = buildConceptNetwork(
        [
          extraction("P1", ["AI", "區塊鏈"]),
          extraction("P2", ["人工智慧", "區塊鏈"]),
          extraction("P3", ["AI", "風控"]),
        ],
        AI,
      );
      const edge = result.cooccurrenceEdges.find(
        (e) => e.from === "concept:人工智慧" && e.to === "concept:區塊鏈",
      );
      expect(edge).toBeDefined();
      expect(edge?.support_count).toBe(2);
      expect(edge?.source_patents).toEqual(["P1", "P2"]);

      // 不該再出現以 AI 為端點的獨立邊
      expect(
        result.cooccurrenceEdges.some(
          (e) => e.from === "concept:AI" || e.to === "concept:AI",
        ),
      ).toBe(false);
    });

    it("語意關係端點也合併，evidence 併成一個群組", () => {
      const result = buildConceptNetwork(
        [
          extraction("P1", ["AI", "風險控管"], [
            { source: "AI", target: "風險控管", relation: "支援", weight: 3, reason: "r1" },
          ]),
          extraction("P2", ["人工智慧", "風險控管"], [
            { source: "人工智慧", target: "風險控管", relation: "支援", weight: 5, reason: "r2" },
          ]),
        ],
        AI,
      );
      expect(result.semanticEdges).toHaveLength(1);
      expect(result.semanticEdges[0]).toMatchObject({
        from: "concept:人工智慧",
        to: "concept:風險控管",
        support_count: 2,
        source_patents: ["P1", "P2"],
      });
      expect(result.semanticEdges[0].evidence).toHaveLength(2);
    });

    it("合併後 source === target 的關係被跳過", () => {
      const result = buildConceptNetwork(
        [
          extraction("P1", ["AI", "區塊鏈"], [
            { source: "AI", target: "人工智能", relation: "等同", weight: 5 },
          ]),
        ],
        AI,
      );
      expect(result.semanticEdges).toHaveLength(0);
    });

    it("沒有 map 時行為與 v1.2 相同（回歸）", () => {
      const inputs = [extraction("P1", ["AI", "區塊鏈"]), extraction("P2", ["AI", "風控"])];
      const withMap = buildConceptNetwork(inputs, AI);
      const withoutMap = buildConceptNetwork(inputs);
      expect(withMap.concepts.has("人工智慧")).toBe(true);
      expect(withoutMap.concepts.has("AI")).toBe(true);
      expect(withoutMap.concepts.has("人工智慧")).toBe(false);
    });
  });
});

describe("node size encodings", () => {
  it("使用平方根縮放與固定上下限", () => {
    expect(conceptSize(0)).toBe(10);
    expect(conceptSize(4)).toBe(30);
    expect(conceptSize(10_000)).toBe(72);
    expect(applicantSize(0)).toBe(18);
    expect(applicantSize(4)).toBe(28);
    expect(applicantSize(10_000)).toBe(52);
    expect(PATENT_NODE_SIZE).toBe(18);
  });
});
