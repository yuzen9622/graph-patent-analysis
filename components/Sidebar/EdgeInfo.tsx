"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  GraphEdge,
  GraphMethodology,
  GraphNode,
  RelationConfidence,
  RelationEvidence,
} from "@/types/graph";

interface Props {
  edge: GraphEdge;
  nodes: GraphNode[];
  methodology: GraphMethodology;
  onClose: () => void;
}

const CONFIDENCE_LABELS: Record<RelationConfidence, string> = {
  EXTRACTED: "原文抽取",
  INFERRED: "模型推論",
  AMBIGUOUS: "語意不明確",
};

export default function EdgeInfo({ edge, nodes, methodology, onClose }: Props) {
  const kind = edge.kind ?? inferLegacyKind(edge);
  const source = nodes.find((node) => node.id === edge.from);
  const target = nodes.find((node) => node.id === edge.to);
  const sourcePatents = uniqueSourcePatents(edge);

  return (
    <div className="relative">
      <div className="mb-3 flex items-start justify-between gap-2">
        <Badge
          className="rounded border-0 px-2 py-0.5 text-[0.65rem] font-bold"
          style={{ background: kindColor(kind), color: "white" }}
        >
          {kindLabel(kind)}
        </Badge>
        <button
          type="button"
          onClick={onClose}
          className="-mt-0.5 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
          aria-label="關閉關係資訊"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
        <NodeLabel label={source?.label ?? edge.from} />
        <span className="text-center text-[0.65rem] text-muted-foreground">→</span>
        <NodeLabel label={target?.label ?? edge.to} />
      </div>

      {kind === "cooccurrence" && (
        <CooccurrenceDetails edge={edge} sourcePatents={sourcePatents} nodes={nodes} />
      )}

      {kind === "semantic" && (
        <SemanticDetails
          edge={edge}
          sourcePatents={sourcePatents}
          nodes={nodes}
          provenance={methodology.semantic_provenance}
        />
      )}

      {kind === "structural" && (
        <dl className="space-y-2 text-xs">
          <Row label="關係" value={edge.relation} />
        </dl>
      )}
    </div>
  );
}

function CooccurrenceDetails({
  edge,
  sourcePatents,
  nodes,
}: {
  edge: GraphEdge;
  sourcePatents: string[];
  nodes: GraphNode[];
}) {
  return (
    <dl className="space-y-2 text-xs">
      <Row label="關係" value={edge.relation || "共同出現"} />
      <Row label="共同專利數" value={`${edge.support_count ?? sourcePatents.length} 篇`} />
      <Row
        label="Jaccard"
        value={typeof edge.jaccard === "number" ? formatJaccard(edge.jaccard) : "無資料"}
      />
      <PatentSources sourcePatents={sourcePatents} nodes={nodes} />
    </dl>
  );
}

function SemanticDetails({
  edge,
  sourcePatents,
  nodes,
  provenance,
}: {
  edge: GraphEdge;
  sourcePatents: string[];
  nodes: GraphNode[];
  provenance: GraphMethodology["semantic_provenance"];
}) {
  const evidence = normalizedEvidence(edge);

  return (
    <div className="space-y-3 text-xs">
      <dl className="space-y-2">
        <Row label="語意關係" value={edge.relation} />
        <Row label="目前保存來源" value={`${sourcePatents.length} 篇`} />
        <PatentSources sourcePatents={sourcePatents} nodes={nodes} />
      </dl>

      {provenance === "partial" && (
        <p
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[0.7rem] leading-relaxed text-amber-800 dark:text-amber-200"
        >
          舊資料只保存部分 LLM 關係來源；此處列出的來源與證據可能不完整，不代表完整支持篇數。
        </p>
      )}

      <div>
        <p className="mb-2 font-medium text-foreground">模型證據</p>
        {evidence.length > 0 ? (
          <ol className="space-y-2">
            {evidence.map((item, index) => (
              <EvidenceCard key={`${item.patent_id}-${index}`} evidence={item} nodes={nodes} />
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">目前資料未保存 confidence 或判斷理由。</p>
        )}
      </div>
    </div>
  );
}

function EvidenceCard({ evidence, nodes }: { evidence: RelationEvidence; nodes: GraphNode[] }) {
  return (
    <li className="rounded-md border border-border bg-muted/40 p-2">
      <p className="break-words font-medium text-foreground">
        {patentLabel(evidence.patent_id, nodes)}
      </p>
      <p className="mt-1 text-[0.65rem] text-muted-foreground">
        confidence：{evidence.confidence ? CONFIDENCE_LABELS[evidence.confidence] : "未保存"}
      </p>
      {evidence.reason && (
        <p className="mt-1 break-words leading-relaxed text-muted-foreground">
          理由：{evidence.reason}
        </p>
      )}
    </li>
  );
}

function PatentSources({ sourcePatents, nodes }: { sourcePatents: string[]; nodes: GraphNode[] }) {
  return (
    <div>
      <dt className="mb-1 font-medium text-foreground">來源專利</dt>
      <dd className="m-0">
        {sourcePatents.length > 0 ? (
          <ul className="space-y-1 text-muted-foreground">
            {sourcePatents.map((patentId) => (
              <li key={patentId} className="break-words">
                {patentLabel(patentId, nodes)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">無保存來源</span>
        )}
      </dd>
    </div>
  );
}

function NodeLabel({ label }: { label: string }) {
  return (
    <span className="min-w-0 break-words rounded-md border border-border bg-muted/40 px-2 py-1.5 text-center font-medium text-foreground">
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 font-medium text-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-muted-foreground">{value}</dd>
    </div>
  );
}

function uniqueSourcePatents(edge: GraphEdge): string[] {
  const values = [
    ...(edge.source_patents ?? []),
    ...(edge.source_patent ? [edge.source_patent] : []),
    ...(edge.evidence ?? []).map((item) => item.patent_id),
  ];
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizedEvidence(edge: GraphEdge): RelationEvidence[] {
  if (edge.evidence?.length) return edge.evidence;
  if (!edge.source_patent && !edge.reason && !edge.confidence) return [];
  return [
    {
      patent_id: edge.source_patent ?? "未保存來源",
      weight: edge.weight,
      reason: edge.reason,
      confidence: edge.confidence,
    },
  ];
}

function patentLabel(patentId: string, nodes: GraphNode[]) {
  const patent = nodes.find(
    (node) =>
      node.type === "patent" &&
      (node.id === patentId || node.id === `patent:${patentId}` || node.id.replace(/^patent:/, "") === patentId),
  );
  return patent?.title || patent?.label || patentId;
}

function formatJaccard(value: number) {
  return `${value.toFixed(3)}（${(value * 100).toFixed(1)}%）`;
}

function inferLegacyKind(edge: GraphEdge) {
  return edge.relation === "申請了" || edge.relation === "包含"
    ? "structural"
    : "semantic";
}

function kindLabel(kind: "structural" | "cooccurrence" | "semantic") {
  if (kind === "cooccurrence") return "共現關係";
  if (kind === "semantic") return "LLM 語意關係";
  return "結構關係";
}

function kindColor(kind: "structural" | "cooccurrence" | "semantic") {
  if (kind === "cooccurrence") return "#475569";
  if (kind === "semantic") return "#7c3aed";
  return "#64748b";
}
