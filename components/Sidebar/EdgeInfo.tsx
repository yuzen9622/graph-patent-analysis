"use client";

import { X, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import StatCard from "./StatCard";
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

/** 證據可信度的語意色（綠＝原文、琥珀＝推論、紅＝不明確）。 */
function ConfidenceBadge({ confidence }: { confidence: RelationConfidence }) {
	const styles: Record<RelationConfidence, string> = {
		EXTRACTED:
			"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
		INFERRED:
			"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
		AMBIGUOUS:
			"border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
	};
	return (
		<span
			className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none ${styles[confidence]}`}
		>
			{CONFIDENCE_LABELS[confidence]}
		</span>
	);
}

export default function EdgeInfo({ edge, nodes, methodology, onClose }: Props) {
	const kind = edge.kind ?? inferLegacyKind(edge);
	const source = nodes.find((node) => node.id === edge.from);
	const target = nodes.find((node) => node.id === edge.to);
	const sourcePatents = uniqueSourcePatents(edge);

	return (
		<div className="relative">
			<div className="mb-3 flex items-start justify-between gap-2">
				<Badge
					className="rounded border-0 px-2 py-0.5 text-[0.7rem] font-bold"
					style={{ background: kindColor(kind), color: "white" }}
				>
					{kindLabel(kind)}
				</Badge>
				<button
					type="button"
					onClick={onClose}
					className="-mt-0.5 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="關閉關係資訊"
				>
					<X size={14} />
				</button>
			</div>

			{/* 來源 → 目標 */}
			<div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 text-xs">
				<NodeLabel label={source?.label ?? edge.from} />
				<ArrowRight
					size={12}
					className="text-muted-foreground shrink-0"
					aria-hidden
				/>
				<NodeLabel label={target?.label ?? edge.to} />
			</div>

			{kind === "cooccurrence" && (
				<CooccurrenceDetails
					edge={edge}
					sourcePatents={sourcePatents}
					nodes={nodes}
				/>
			)}

			{kind === "institution" && (
				<div className="space-y-2 text-xs">
					<div className="grid grid-cols-2 gap-1.5 mb-3">
						<StatCard
							label="共享概念數"
							value={`${edge.support_count ?? edge.shared_concepts?.length ?? 0}`}
							sub="個"
						/>
					</div>
					<div>
						<dt className="mb-1 font-medium text-foreground">
							共同投入的技術概念
						</dt>
						<dd className="m-0">
							<ul className="space-y-1 text-muted-foreground">
								{(edge.shared_concepts ?? []).map((concept) => (
									<li key={concept} className="break-words">
										{concept}
									</li>
								))}
							</ul>
						</dd>
					</div>
				</div>
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
	const supportApplicants = edge.support_applicants;
	return (
		<>
			<div className="grid grid-cols-2 gap-1.5 mb-3">
				<StatCard
					label="支持度"
					value={`${edge.support_count ?? sourcePatents.length}`}
					sub="篇"
				/>
				{supportApplicants !== undefined && (
					<StatCard label="支持度" value={`${supportApplicants}`} sub="家" />
				)}
				{typeof edge.jaccard === "number" && (
					<StatCard
						label="Jaccard"
						value={edge.jaccard.toFixed(3)}
						sub={`篇 · ${(edge.jaccard * 100).toFixed(1)}%`}
					/>
				)}
				{edge.jaccard_applicants !== undefined && (
					<StatCard
						label="Jaccard"
						value={edge.jaccard_applicants.toFixed(3)}
						sub={`家 · ${(edge.jaccard_applicants * 100).toFixed(1)}%`}
					/>
				)}
				{edge.npmi !== undefined && (
					<StatCard
						label="NPMI"
						value={`${(edge.npmi * 100).toFixed(1)}%`}
						sub={edge.npmi === 1 ? "p=1 不定義" : undefined}
					/>
				)}
				{edge.npmi_applicants !== undefined && (
					<StatCard
						label="NPMI"
						value={`${(edge.npmi_applicants * 100).toFixed(1)}%`}
						sub="家"
					/>
				)}
				{edge.association_strength !== undefined && (
					<StatCard
						label="關聯強度"
						value={edge.association_strength.toFixed(2)}
						sub="排序用"
					/>
				)}
			</div>
			<dl className="space-y-2 text-xs">
				<Row label="關係" value={edge.relation || "共同出現"} />
			</dl>
			<div className="mt-3">
				<PatentSources sourcePatents={sourcePatents} nodes={nodes} />
			</div>
		</>
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
				{sourcePatents.length > 0 && (
					<Row label="目前保存來源" value={`${sourcePatents.length} 篇`} />
				)}
			</dl>

			{provenance === "partial" && (
				<p
					role="status"
					className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[0.7rem] leading-relaxed text-amber-800 dark:text-amber-200"
				>
					舊資料只保存部分 LLM
					關係來源；此處列出的來源與證據可能不完整，不代表完整支持篇數。
				</p>
			)}

			<div>
				<p className="mb-2 font-medium text-foreground">模型證據</p>
				{evidence.length > 0 ? (
					<ol className="space-y-2">
						{evidence.map((item, index) => (
							<EvidenceCard
								key={`${item.patent_id}-${index}`}
								evidence={item}
								nodes={nodes}
							/>
						))}
					</ol>
				) : (
					<p className="text-muted-foreground">
						目前資料未保存 confidence 或判斷理由。
					</p>
				)}
			</div>

			{sourcePatents.length > 0 && (
				<PatentSources sourcePatents={sourcePatents} nodes={nodes} />
			)}
		</div>
	);
}

function EvidenceCard({
	evidence,
	nodes,
}: {
	evidence: RelationEvidence;
	nodes: GraphNode[];
}) {
	return (
		<li className="rounded-md border border-border bg-background p-2.5">
			<div className="flex items-start justify-between gap-2">
				<p className="break-words font-medium text-foreground">
					{patentLabel(evidence.patent_id, nodes)}
				</p>
				{evidence.confidence && (
					<span className="shrink-0">
						<ConfidenceBadge confidence={evidence.confidence} />
					</span>
				)}
			</div>
			{!evidence.confidence && (
				<p className="mt-1 text-[0.7rem] text-muted-foreground">
					confidence：未保存
				</p>
			)}
			{evidence.reason && (
				<p className="mt-1.5 break-words leading-relaxed text-muted-foreground">
					{evidence.reason}
				</p>
			)}
		</li>
	);
}

function PatentSources({
	sourcePatents,
	nodes,
}: {
	sourcePatents: string[];
	nodes: GraphNode[];
}) {
	return (
		<div>
			<dt className="mb-1.5 font-medium text-foreground">
				來源專利
				<span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[0.65rem] text-primary tabular-nums">
					{sourcePatents.length}
				</span>
			</dt>
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
		<span className="min-w-0 break-words rounded-md border border-border bg-background px-2 py-1.5 text-center font-medium text-foreground">
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
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
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
			(node.id === patentId ||
				node.id === `patent:${patentId}` ||
				node.id.replace(/^patent:/, "") === patentId),
	);
	return patent?.title || patent?.label || patentId;
}

function inferLegacyKind(edge: GraphEdge) {
	return edge.relation === "申請了" || edge.relation === "包含"
		? "structural"
		: "semantic";
}

function kindLabel(
	kind: "structural" | "cooccurrence" | "semantic" | "institution",
) {
	if (kind === "cooccurrence") return "共現關係";
	if (kind === "semantic") return "LLM 語意關係";
	if (kind === "institution") return "機構共享概念";
	return "結構關係";
}

function kindColor(
	kind: "structural" | "cooccurrence" | "semantic" | "institution",
) {
	if (kind === "cooccurrence") return "#475569";
	if (kind === "semantic") return "#7c3aed";
	if (kind === "institution") return "#0f766e";
	return "#64748b";
}
