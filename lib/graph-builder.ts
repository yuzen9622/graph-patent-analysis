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
import { normalizeApplicantName } from "@/lib/excel-parser";
import {
  applicantSize,
  conceptSize,
  PATENT_NODE_SIZE,
  stableEdgeId,
  type ConceptNetworkResult,
} from "@/lib/concept-network";
import {
  computeConceptStats,
  computeTimeWindow,
  parseFilingYear,
  SEQUENTIAL_BLUE,
} from "@/lib/concept-time";
import {
  computeUnitMetrics,
  detectUnitCommunities,
  pairApplicantSupport,
} from "@/lib/concept-metrics";

// PRD v2 / P4 (Q2): 「家」單位社群的色盤與「篇」單位分開，同 community_id
// 在兩單位下不共享色（色盤 key = unit + id）。
const APPLICANT_COMMUNITY_COLORS: string[] = [
  "#7B2CBF",
  "#FF8C42",
  "#2EC4B6",
  "#E63946",
  "#4361EE",
  "#F4A261",
  "#7209B7",
  "#06D6A0",
  "#EF476F",
  "#118AB2",
];

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

  // PRD v2 / P4: per-concept 「家計」（概念被幾家機構碰到），用於 NodeInfo 篇/家並陳。
  const conceptApplicants = new Map<string, Set<string>>();
  // PRD v2 / P4 second slice: applicant → concepts（跨專利聯集），「家」單位邊計數基礎。
  const applicantConcepts = new Map<string, Set<string>>();

  // ── PRD v2 / P3: per-concept time stats + the gradient window, both pure ──
  // population = multiset of per-patent years (filtered to valid years); the
  // four fields are attached to concept nodes here but colouring stays at the
  // view layer (color_mode lives in GraphViewOptions, not in the graph).
  const yearsByPatent = new Map<string, number>();
  for (const patent of patents) {
    const year = parseFilingYear(patent.filing_date);
    if (year === undefined) continue
    yearsByPatent.set(patent.id, year)
  }
  const conceptTime = computeConceptStats(conceptNetwork, yearsByPatent)
  const timeWindow = computeTimeWindow(conceptTime)

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
      // PRD v2 P0 §3.4: the merge key travels on the node so that reloading a
      // saved graph can still tell which labels denote the same organisation.
      // It never replaces `label` / the node id — the displayed name must stay
      // byte-identical to v1.2 (§7-5).
      applicant_key: normalizeApplicantName(name),
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
      // PRD v2 / P3: concept time metadata (undefined when the concept has no
      // valid filing year).
      first_year: conceptTime.get(label)?.first_year,
      last_year: conceptTime.get(label)?.last_year,
      median_year: conceptTime.get(label)?.median_year,
      year_counts: conceptTime.get(label)?.year_counts,
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
    // Prefer the deduped applicants[] union when present; it survives
    // cross-row merges intact (§4.6). It isn't guaranteed to be clean by
    // every caller (e.g. `{ dedupe: false }` snapshot parsing), so dedupe
    // it here rather than assuming the source already did.
    const applicantNames =
      patent.applicants && patent.applicants.length > 0
        ? Array.from(new Set(patent.applicants.map((s) => s.trim()).filter(Boolean)))
        : splitApplicants(patent.applicant);

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
      // PRD v2 P0 §6.1: carried on the node, not only on the transient
      // PatentRow, so IPC / provenance filters survive a reload.  Absent values
      // stay `undefined` — they must never surface as 0 or an empty label.
      ipc5: patent.ipc5,
      ipc_primary: patent.ipc_primary,
      ipc_depth: patent.ipc_depth,
      source_files: patent.source_files,
      cited_by_count: patent.cited_by_count,
      case_status: patent.case_status,
      color: patentColor,
      size: PATENT_NODE_SIZE,
    };
    patentNodes.push(patentNode);

    // Applicant → Patent edges + increment patent_count
    for (const name of applicantNames) {
      const applicantNode = getOrCreateApplicant(name);
      applicantNode.patent_count = (applicantNode.patent_count ?? 0) + 1;

      // PRD v2 / P4: applicant ← concept membership (for 篇/家 count).
      for (const keyword of conceptsByPatent.get(patent.id) ?? []) {
        const s = conceptApplicants.get(keyword) ?? new Set<string>();
        s.add(name);
        conceptApplicants.set(keyword, s);
        const ac = applicantConcepts.get(name) ?? new Set<string>();
        ac.add(keyword);
        applicantConcepts.set(name, ac);
      }

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
  // PRD v2 / P4 second slice: enrich co-occurrence edges with the applicant-unit
  // and NPMI/association metrics BEFORE they enter the graph (全量、門檻前, Q4/Q5).
  const conceptPatents = new Map<string, number>();
  for (const [label, aggregate] of conceptNetwork.concepts) {
    conceptPatents.set(label, aggregate.frequency);
  }
  const applicantCounts = new Map<string, number>();
  for (const [label, applicants] of conceptApplicants) {
    applicantCounts.set(label, applicants.size);
  }
  const pairApplicants = pairApplicantSupport(applicantConcepts);
  const unitMetrics = computeUnitMetrics({
    cooccurrence: conceptNetwork.cooccurrenceEdges,
    conceptPatents,
    conceptApplicants: applicantCounts,
    pairApplicants,
    totalPatents: patents.length,
    totalInstitutions: applicantNodeMap.size,
  });
  for (const edge of conceptNetwork.cooccurrenceEdges) {
    const metrics = unitMetrics.get(edge.id);
    if (metrics) Object.assign(edge, metrics);
  }
  for (const edge of conceptNetwork.cooccurrenceEdges) addEdge(edge);
  for (const edge of conceptNetwork.semanticEdges) addEdge(edge);

  // PRD v2 / P4 (Q2): 「家」單位 Louvain 分區（獨立於「篇」單位，各自持久化）。
  const applicantAssignments = detectUnitCommunities(
    Array.from(conceptNetwork.concepts.keys()),
    pairApplicants,
  );
  const applicantCommunityNames = new Map<number, string>();
  const applicantCommunityCounts = new Map<number, number>();
  for (const [label, cid] of applicantAssignments) {
    const node = conceptNodeMap.get(label);
    if (node) node.community_id_applicants = cid;
    applicantCommunityCounts.set(cid, (applicantCommunityCounts.get(cid) ?? 0) + 1);
  }
  // 社群名 = 社群內 applicant 度最高的概念。
  const applicantDegree = new Map<string, number>();
  for (const [key, applicants] of pairApplicants) {
    const [a, b] = key.split("\u0000");
    const w = applicants.size;
    applicantDegree.set(a, (applicantDegree.get(a) ?? 0) + w);
    applicantDegree.set(b, (applicantDegree.get(b) ?? 0) + w);
  }
  for (const cid of Array.from(applicantCommunityCounts.keys())) {
    let best = "";
    let bestDegree = -1;
    for (const [label, ccid] of applicantAssignments) {
      if (ccid !== cid) continue;
      const deg = applicantDegree.get(label) ?? 0;
      if (deg > bestDegree) {
        bestDegree = deg;
        best = label;
      }
    }
    applicantCommunityNames.set(cid, best || `社群 ${cid}`);
  }
  const communitiesApplicants: Community[] = Array.from(applicantCommunityCounts.keys())
    .sort((a, b) => a - b)
    .map((cid) => ({
      id: cid,
      name: applicantCommunityNames.get(cid) ?? `社群 ${cid}`,
      color: APPLICANT_COMMUNITY_COLORS[cid % APPLICANT_COMMUNITY_COLORS.length],
      node_count: applicantCommunityCounts.get(cid) ?? 0,
      unit: "applicant" as const,
    }));

  // Ensure concepts without a patent edge (defensive legacy/input handling) exist.
  for (const label of conceptNetwork.concepts.keys()) {
    getOrCreateConcept(label);
  }

  // PRD v2 / P4: stamp each concept node with its applicant-unit count (家).
  for (const [label, applicants] of conceptApplicants) {
    const node = conceptNodeMap.get(label);
    if (node) node.applicant_count = applicants.size;
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
    // PRD v2 / P3: the gradient window (data fact) and palette name. No
    // color_mode here — that is a view-layer option (see lib/graph-view.ts).
    time_window: timeWindow,
    time_color_scale: 'sequential_blue',
    cooccurrence_data: 'native',
    semantic_provenance: 'complete',
    ...methodologyMeta,
  };

  return {
    schema_version: 3,
    nodes: allNodes,
    edges,
    communities: communitiesList,
    communities_applicants: communitiesApplicants,
    stats,
    analysis,
    ai_report: "", // Filled in by the LLM report step (F-07)
    generated_at,
    methodology,
  };
}
