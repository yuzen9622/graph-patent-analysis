// lib/graph-builder.ts
// Implements F-05: Three-tier graph construction (Applicant → Patent → Concept)
// PRD v1.1 Section 3.2 F-05

import type {
  PatentRow,
  ExtractionResult,
  GraphData,
  GraphNode,
  GraphEdge,
  Community,
} from "@/types/graph";

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
  return raw
    .split(/；|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildGraph(
  patents: PatentRow[],
  extractions: ExtractionResult[],
  communities: Map<string, number>, // concept label → community_id
  communityColors: Map<number, string>, // community_id → hex color
  communityNames: Map<number, string>, // community_id → display name
): GraphData {
  // ── Index extractions by patent_id for O(1) lookup ──────────────────────────
  const extractionMap = new Map<string, ExtractionResult>();
  for (const ex of extractions) {
    extractionMap.set(ex.patent_id, ex);
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
      size: 40,
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
    const communityId = communities.get(label) ?? 0;
    const communityColor = communityColors.get(communityId) ?? "#BAB0AC";
    const node: GraphNode = {
      id: `concept:${label}`,
      type: "concept",
      label,
      frequency: 0,
      community_id: communityId,
      color: communityColor,
      // Size computed after frequency is finalized; placeholder here
      size: 8,
    };
    conceptNodeMap.set(label, node);
    return node;
  }

  // ── Patent nodes and edge collection ─────────────────────────────────────────
  const patentNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>(); // for deduplication

  function addEdge(edge: GraphEdge): void {
    const key = `${edge.from}|${edge.to}|${edge.relation}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }

  // Track patents per concept for frequency counting
  // concept label → Set of patent_ids that mention it
  const conceptPatentSets = new Map<string, Set<string>>();

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
      size: 18,
    };
    patentNodes.push(patentNode);

    // Applicant → Patent edges + increment patent_count
    for (const name of applicantNames) {
      const applicantNode = getOrCreateApplicant(name);
      applicantNode.patent_count = (applicantNode.patent_count ?? 0) + 1;

      addEdge({
        id: `e:${applicantNode.id}→${patentNode.id}`,
        from: applicantNode.id,
        to: patentNode.id,
        relation: "申請了",
      });
    }

    // Patent → Concept edges (from LLM keywords)
    const extraction = extractionMap.get(patent.id);
    if (extraction) {
      for (const keyword of extraction.keywords) {
        if (!keyword.trim()) continue;
        const conceptNode = getOrCreateConcept(keyword);

        // Track per-concept patent membership for frequency
        if (!conceptPatentSets.has(keyword)) {
          conceptPatentSets.set(keyword, new Set());
        }
        conceptPatentSets.get(keyword)!.add(patent.id);

        addEdge({
          id: `e:${patentNode.id}→${conceptNode.id}`,
          from: patentNode.id,
          to: conceptNode.id,
          relation: "包含",
          source_patent: patent.id,
        });
      }

      // Concept → Concept edges from LLM relations
      for (const rel of extraction.relations) {
        if (!rel.source.trim() || !rel.target.trim()) continue;
        const srcNode = getOrCreateConcept(rel.source);
        const tgtNode = getOrCreateConcept(rel.target);

        addEdge({
          id: `e:${srcNode.id}→${tgtNode.id}:${rel.relation}`,
          from: srcNode.id,
          to: tgtNode.id,
          relation: rel.relation,
          weight: rel.weight,
          source_patent: patent.id,
        });
      }
    }
  }

  // ── Finalize concept node sizes and frequencies ───────────────────────────────
  for (const [label, node] of conceptNodeMap) {
    const freq = conceptPatentSets.get(label)?.size ?? 0;
    node.frequency = freq;
    node.size = Math.min(60, Math.max(8, 8 + freq * 3));
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

  return {
    nodes: allNodes,
    edges,
    communities: communitiesList,
    stats,
    ai_report: "", // Filled in by the LLM report step (F-07)
    generated_at,
  };
}
