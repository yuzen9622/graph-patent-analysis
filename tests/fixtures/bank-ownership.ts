import type { GraphData, GraphNode } from "../../types/graph";

export const applicants = [
  "臺灣銀行股份有限公司",
  "第一商業銀行股份有限公司",
  "中國信託商業銀行股份有限公司",
  "玉山商業銀行股份有限公司",
];
const patentOwners = [[0], [1], [2], [3], [0, 2]];
const years = [2020, 2021, 2021, 2022, 2022];
const concepts = ["共同技術", "共同服務", "國營技術", "民營技術"];
const baseNode = { color: "#475569", size: 18 };

export const ownershipGraph: GraphData = {
  schema_version: 3,
  nodes: [
    ...applicants.map((label): GraphNode => ({
      ...baseNode, id: `applicant:${label}`, type: "applicant", label,
    })),
    ...years.map((year, i): GraphNode => ({
      ...baseNode, id: `patent:P${i + 1}`, type: "patent", label: `P${i + 1}`,
      year, source_files: [i % 2 === 0 ? "A.xlsx" : "B.xlsx"],
      ipc5: [i === 0 ? "G06Q20/00" : "G06F16/00"],
    })),
    ...concepts.map((label, i): GraphNode => ({
      ...baseNode, id: `concept:${label}`, type: "concept", label,
      frequency: i < 2 ? 5 : 2,
      source_patents: i < 2 ? ["P1", "P2", "P3", "P4", "P5"] : i === 2 ? ["P1", "P2"] : ["P3", "P4"],
    })),
  ],
  edges: [
    ...patentOwners.flatMap((owners, i) => owners.map(owner => ({
      id: `app:${i}:${owner}`, from: `applicant:${applicants[owner]}`, to: `patent:P${i + 1}`,
      kind: "structural" as const, relation: "申請了",
    }))),
    ...years.flatMap((_, i) => concepts.filter((__, c) => c < 2 || (c === 2 && i < 2) || (c === 3 && i >= 2 && i < 4)).map(label => ({
      id: `concept:${i}:${label}`, from: `patent:P${i + 1}`, to: `concept:${label}`,
      kind: "structural" as const, relation: "包含",
    }))),
    { id: "co:shared", from: `concept:${concepts[0]}`, to: `concept:${concepts[1]}`, kind: "cooccurrence", relation: "共同出現", support_count: 5, support_applicants: 4 },
  ],
  communities: [],
  stats: { applicant_count: 4, patent_count: 5, concept_count: 4, community_count: 0, year_range: [2020, 2022] },
  ai_report: "",
  generated_at: "2026-10-30T00:00:00Z",
  methodology: {
    concept_frequency_metric: "unique_patent_count", cooccurrence_metric: "unique_patent_support",
    concept_size_formula: "test", applicant_size_formula: "test", patent_size: 18,
    community_algorithm: "louvain", community_edge_weight: "support_count", community_resolution: 1,
    community_random_walk: false, layout_distance_interpretation: "visual_only", prompt_version: "test",
    model_provider: "test", model_id: "test", cooccurrence_data: "native", semantic_provenance: "complete",
  },
};
