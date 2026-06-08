"use client";

import { useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GraphNode, GraphEdge, Community } from "@/types/graph";

interface Props {
  node: GraphNode;
  edges: GraphEdge[];
  nodes: GraphNode[];
  communities: Community[];
  onClose: () => void;
  onNodeSelect: (node: GraphNode) => void;
  onNodeFocus: (nodeId: string) => void;
}

export default function NodeInfo({
  node,
  edges,
  nodes,
  communities,
  onClose,
  onNodeSelect,
  onNodeFocus,
}: Props) {
  const [abstractExpanded, setAbstractExpanded] = useState(false);

  const TYPE_TOKENS = {
    applicant: "var(--color-layer-applicant, #4E79A7)",
    patent: "var(--color-layer-patent, #F28E2B)",
    concept: "var(--color-layer-concept, #59A14F)",
  };
  const TYPE_LABELS = {
    applicant: "申請人",
    patent: "專利",
    concept: "技術概念",
  };

  const community =
    node.community_id !== undefined
      ? communities.find((c) => c.id === node.community_id)
      : undefined;

  // Find adjacent nodes
  const adjacentIds = new Set<string>();
  edges.forEach((e) => {
    if (e.from === node.id) adjacentIds.add(e.to);
    if (e.to === node.id) adjacentIds.add(e.from);
  });
  const adjacentNodes = nodes.filter((n) => adjacentIds.has(n.id)).slice(0, 12);

  return (
    <div className="relative">
      <div className="flex items-start justify-between mb-3">
        <Badge
          className="text-[0.65rem] font-bold px-2 py-0.5 rounded border-0"
          style={{ background: TYPE_TOKENS[node.type], color: "white" }}
        >
          {TYPE_LABELS[node.type]}
        </Badge>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer -mt-0.5"
          aria-label="關閉節點資訊"
        >
          <X size={14} />
        </button>
      </div>

      <h3 className="font-serif text-sm font-semibold text-foreground leading-snug mb-3 break-words">
        {node.label}
      </h3>

      <dl className="space-y-2 text-xs">
        {/* Applicant fields */}
        {node.type === "applicant" && (
          <Row label="專利件數" value={`${node.patent_count ?? 0} 件`} />
        )}

        {/* Patent fields */}
        {node.type === "patent" && (
          <>
            {node.applicant && <Row label="申請人" value={node.applicant} />}
            {node.filing_date && (
              <Row label="申請日" value={node.filing_date} />
            )}
            {node.application_number && (
              <Row label="申請號" value={node.application_number} />
            )}
            {node.abstract && (
              <div>
                <dt className="text-foreground font-medium mb-1">摘要</dt>
                <dd className="text-muted-foreground leading-relaxed m-0">
                  {abstractExpanded
                    ? node.abstract
                    : node.abstract.slice(0, 120) +
                      (node.abstract.length > 120 ? "…" : "")}
                  {node.abstract.length > 120 && (
                    <button
                      onClick={() => setAbstractExpanded((v) => !v)}
                      className="ml-1 text-primary hover:text-accent inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      {abstractExpanded ? (
                        <>
                          <ChevronUp size={11} />
                          收合
                        </>
                      ) : (
                        <>
                          <ChevronDown size={11} />
                          展開
                        </>
                      )}
                    </button>
                  )}
                </dd>
              </div>
            )}
          </>
        )}

        {/* Concept fields */}
        {node.type === "concept" && (
          <>
            <Row label="出現次數" value={`${node.frequency ?? 1} 次`} />
            {community && (
              <div className="flex items-center gap-1.5">
                <dt className="text-foreground font-medium">社群</dt>
                <dd className="flex items-center gap-1.5 m-0">
                  <span
                    aria-hidden
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: community.color }}
                  />
                  <span className="text-muted-foreground">
                    {community.name}
                  </span>
                </dd>
              </div>
            )}
          </>
        )}
      </dl>

      {/* Adjacent nodes */}
      {adjacentNodes.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-foreground font-medium mb-2">相鄰節點</p>
          <div className="flex flex-wrap gap-1.5">
            {adjacentNodes.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  onNodeSelect(n);
                  onNodeFocus(n.id);
                }}
                className="text-[0.65rem] px-1.5 py-0.5 rounded border cursor-pointer transition-colors hover:opacity-80"
                style={{
                  borderColor: n.color,
                  color: n.color,
                  background: `${n.color}18`,
                }}
              >
                {n.label.length > 12 ? n.label.slice(0, 12) + "…" : n.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-foreground font-medium shrink-0 w-16">{label}</dt>
      <dd className="text-muted-foreground m-0 break-words min-w-0">{value}</dd>
    </div>
  );
}
