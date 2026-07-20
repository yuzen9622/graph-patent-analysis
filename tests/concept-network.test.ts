import { describe, expect, it } from "vitest";
import {
  applicantSize,
  buildConceptNetwork,
  conceptSize,
  PATENT_NODE_SIZE,
} from "../lib/concept-network";
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
});

describe("node size encodings", () => {
  it("使用平方根縮放與固定上下限", () => {
    expect(conceptSize(0)).toBe(10);
    expect(conceptSize(4)).toBe(22);
    expect(conceptSize(10_000)).toBe(52);
    expect(applicantSize(0)).toBe(18);
    expect(applicantSize(4)).toBe(28);
    expect(applicantSize(10_000)).toBe(52);
    expect(PATENT_NODE_SIZE).toBe(18);
  });
});
