// lib/graph-builder.ts
// Implements F-05: Three-tier graph construction (Applicant → Patent → Concept)
// PRD v1.1 Section 3.2 F-05

import type {
  PatentRow,
  GraphData,
  GraphNode,
  GraphEdge,
  Community,
  GraphAnalysis,
  GraphMethodology,
} from "@/types/graph";
import { computeGodNodes, computeSurprisingConnections } from "@/lib/graph-analysis";
import {
  applicantSize,
  conceptSize,
  PATENT_NODE_SIZE,
  stableEdgeId,
  type ConceptNetworkResult,
} from "@/lib/concept-network";

// Tableau-10 colors as defined in PRD Section 6.2
const TABLEAU_10: string[] = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
];

/**
 * Append "B3" to a hex color to get the 70% opacity variant.
 * Works for both "#RRGGBB" and "#RGB" shorthand forms.
 */
function withOpacity70(hex: string): string {
  return hex + "B3";
}

/**
 * Split an applicant string on full-width semicolon (；) or half-width semicolon (;).
 * Returns a trimmed, non-empty list of applicant names.
 */
function splitApplicants(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/；|;/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export function buildGraph(
  patents: PatentRow[],
  conceptNetwork: ConceptNetworkResult,
  communities: Map<string, number>, // concept label → community_id
  communityColors: Map<number, string>, // community_id → hex color
  communityNames: Map<number, string>, // community_id → display name
  methodologyMeta: Pick<GraphMethodology, 'prompt_version' | 'model_provider' | 'model_id'>,
): GraphData {
  const conceptsByPatent = new Map<string, string[]>();
  for (const concept of conceptNetwork.concepts.values()) {
    for (const patentId of concept.source_patents) {
      const labels = conceptsByPatent.get(patentId) ?? [];
      labels.push(concept.label);
      conceptsByPatent.set(patentId, labels);
    }
  }

  // ── Applicant nodes ──────────────────────────────────────────────────────────
  // Map<applicantName, { node, colorIndex }>
  const applicantNodeMap = new Map<string, GraphNode>();
  let applicantColorIdx = 0;

  function getOrCreateApplicant(name: string): GraphNode {
    if (applicantNodeMap.has(name)) {
      return applicantNodeMap.get(name)!;
    }
    const color = TABLEAU_10[applicantColorIdx % TABLEAU_10.length];
    applicantColorIdx++;
    const node: GraphNode = {
      id: `applicant:${name}`,
      type: "applicant",
      label: name,
      patent_count: 0,
      color,
      size: applicantSize(0),
    };
    applicantNodeMap.set(name, node);
    return node;
  }

  // ── Concept nodes ────────────────────────────────────────────────────────────
  // Map<conceptLabel, GraphNode>
  const conceptNodeMap = new Map<string, GraphNode>();

  function getOrCreateConcept(label: string): GraphNode {
    if (conceptNodeMap.has(label)) {
      return conceptNodeMap.get(label)!;
    }
    const aggregate = conceptNetwork.concepts.get(label);
    const communityId = communities.get(label) ?? 0;
    const communityColor = communityColors.get(communityId) ?? "#BAB0AC";
    const node: GraphNode = {
      id: `concept:${label}`,
      type: "concept",
      label,
      frequency: aggregate?.frequency ?? 0,
      community_id: communityId,
      source_patents: aggregate?.source_patents ?? [],
      color: communityColor,
      size: conceptSize(aggregate?.frequency ?? 0),
    };
    conceptNodeMap.set(label, node);
    return node;
  }

  // ── Patent nodes and edge collection ─────────────────────────────────────────
  const patentNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>(); // stable edge IDs provide deduplication

  function addEdge(edge: GraphEdge): void {
    if (!edgeSet.has(edge.id)) {
      edgeSet.add(edge.id);
      edges.push(edge);
    }
  }

  for (const patent of patents) {
    const applicantNames = splitApplicants(patent.applicant);

    // Determine patent color from first applicant
    const accentApplicant = applicantNames[0] ?? "未知申請人";
    const accentApplicantNode = getOrCreateApplicant(accentApplicant);
    const patentColor = withOpacity70(accentApplicantNode.color);

    // Parse year from filing_date (YYYY/MM/DD or YYYY-MM-DD)
    let year: number | undefined;
    if (patent.filing_date) {
      const match = patent.filing_date.match(/^(\d{4})/);
      if (match) year = parseInt(match[1], 10);
    }

    const patentNode: GraphNode = {
      id: `patent:${patent.id}`,
      type: "patent",
      label: patent.title,
      title: patent.title,
      applicant: patent.applicant,
      filing_date: patent.filing_date,
      year,
      abstract: patent.abstract,
      application_number: patent.application_number,
      color: patentColor,
      size: PATENT_NODE_SIZE,
    };
    patentNodes.push(patentNode);

    // Applicant → Patent edges + increment patent_count
    for (const name of applicantNames) {
      const applicantNode = getOrCreateApplicant(name);
      applicantNode.patent_count = (applicantNode.patent_count ?? 0) + 1;

      addEdge({
        id: stableEdgeId('structural', [applicantNode.id, patentNode.id, '申請了']),
        from: applicantNode.id,
        to: patentNode.id,
        relation: "申請了",
        kind: 'structural',
        source_patents: [patent.id],
      });
    }

    // Patent → Concept edges from the normalized concept memberships.
    for (const keyword of conceptsByPatent.get(patent.id) ?? []) {
      const conceptNode = getOrCreateConcept(keyword);
      addEdge({
        id: stableEdgeId('structural', [patentNode.id, conceptNode.id, '包含']),
        from: patentNode.id,
        to: conceptNode.id,
        relation: "包含",
        kind: 'structural',
        source_patent: patent.id,
        source_patents: [patent.id],
      });
    }
  }

  for (const applicant of applicantNodeMap.values()) {
    applicant.size = applicantSize(applicant.patent_count ?? 0);
  }

  // Add empirical co-occurrence and separately aggregated LLM semantic edges.
  for (const edge of conceptNetwork.cooccurrenceEdges) addEdge(edge);
  for (const edge of conceptNetwork.semanticEdges) addEdge(edge);

  // Ensure concepts without a patent edge (defensive legacy/input handling) exist.
  for (const label of conceptNetwork.concepts.keys()) {
    getOrCreateConcept(label);
  }

  // ── Build Community list ──────────────────────────────────────────────────────
  const communityNodeCounts = new Map<number, number>();
  for (const node of conceptNodeMap.values()) {
    const cid = node.community_id ?? 0;
    communityNodeCounts.set(cid, (communityNodeCounts.get(cid) ?? 0) + 1);
  }

  const communitiesList: Community[] = [];
  for (const [id, color] of communityColors) {
    communitiesList.push({
      id,
      name: communityNames.get(id) ?? `社群 ${id}`,
      color,
      node_count: communityNodeCounts.get(id) ?? 0,
    });
  }
  // Sort by id for stable ordering
  communitiesList.sort((a, b) => a.id - b.id);

  // ── Collect all nodes ─────────────────────────────────────────────────────────
  const allNodes: GraphNode[] = [
    ...Array.from(applicantNodeMap.values()),
    ...patentNodes,
    ...Array.from(conceptNodeMap.values()),
  ];

  // ── Compute stats ─────────────────────────────────────────────────────────────
  const years = patentNodes
    .map((n) => n.year)
    .filter((y): y is number => typeof y === "number");

  const yearRange: [number, number] =
    years.length > 0
      ? [Math.min(...years), Math.max(...years)]
      : [new Date().getFullYear(), new Date().getFullYear()];

  const stats = {
    applicant_count: applicantNodeMap.size,
    patent_count: patentNodes.length,
    concept_count: conceptNodeMap.size,
    community_count: communitiesList.length,
    year_range: yearRange,
  };

  // ── generated_at: current UTC ISO 8601 timestamp ──────────────────────────────
  const generated_at = new Date().toISOString();

  const conceptNodes = Array.from(conceptNodeMap.values());
  const cooccurrenceEdges = conceptNetwork.cooccurrenceEdges;

  // ── Analysis is intentionally limited to the empirical concept network. ──────
  const analysis: GraphAnalysis = {
    god_nodes: computeGodNodes(conceptNodes, cooccurrenceEdges),
    surprising_connections: computeSurprisingConnections(cooccurrenceEdges, conceptNodes),
  };

  const methodology: GraphMethodology = {
    concept_frequency_metric: 'unique_patent_count',
    cooccurrence_metric: 'unique_patent_support',
    concept_size_formula: 'clamp(10 + 6 * sqrt(frequency), 10, 52)',
    applicant_size_formula: 'clamp(18 + 5 * sqrt(patent_count), 18, 52)',
    patent_size: PATENT_NODE_SIZE,
    community_algorithm: 'louvain',
    community_edge_weight: 'support_count',
    community_resolution: 1,
    community_random_walk: false,
    layout_distance_interpretation: 'visual_only',
    cooccurrence_data: 'native',
    semantic_provenance: 'complete',
    ...methodologyMeta,
  };

  return {
    schema_version: 2,
    nodes: allNodes,
    edges,
    communities: communitiesList,
    stats,
    analysis,
    ai_report: "", // Filled in by the LLM report step (F-07)
    generated_at,
    methodology,
  };
}
