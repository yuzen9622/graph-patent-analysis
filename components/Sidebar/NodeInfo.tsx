"use client";

import { useState } from "react";
import { X, ChevronDown, ChevronUp, ArrowRight, Disc } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatCard from "./StatCard";
import type { GraphNode, GraphEdge, Community } from "@/types/graph";

interface Props {
	node: GraphNode;
	edges: GraphEdge[];
	nodes: GraphNode[];
	communities: Community[];
	onClose: () => void;
	onNodeSelect: (node: GraphNode) => void;
	onNodeFocus: (nodeId: string) => void;
	subgraphCenterId?: string;
	onEnterSubgraph?: (node: GraphNode) => void;
	onExitSubgraph?: () => void;
}

const TYPE_TOKENS = {
	applicant: "var(--color-layer-applicant, #4E79A7)",
	patent: "var(--color-layer-patent, #F28E2B)",
	concept: "var(--color-layer-concept, #59A14F)",
} as const;
const TYPE_LABELS = {
	applicant: "申請人",
	patent: "專利",
	concept: "技術概念",
} as const;

/** 年度分布條狀圖最多顯示的年份數（超過則收合）。 */
const MAX_YEAR_BARS = 14;

export default function NodeInfo({
	node,
	edges,
	nodes,
	communities,
	onClose,
	onNodeSelect,
	onNodeFocus,
	subgraphCenterId,
	onEnterSubgraph,
	onExitSubgraph,
}: Props) {
	const [abstractExpanded, setAbstractExpanded] = useState(false);

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

	const yearEntries = Object.entries(node.year_counts ?? {})
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([year, count]) => ({ year: Number(year), count }));
	const maxYearCount = Math.max(1, ...yearEntries.map((e) => e.count));
	const yearBarsShown = yearEntries.slice(0, MAX_YEAR_BARS);
	const yearBarsTruncated = yearEntries.length > MAX_YEAR_BARS;

	return (
		<div className="relative">
			<div className="flex items-start justify-between mb-2.5">
				<Badge
					className="text-[0.7rem] font-bold px-2 py-0.5 rounded border-0"
					style={{ background: TYPE_TOKENS[node.type], color: "white" }}
				>
					{TYPE_LABELS[node.type]}
				</Badge>
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={onClose}
					className="text-muted-foreground hover:text-foreground cursor-pointer -mt-0.5 rounded"
					aria-label="關閉節點資訊"
				>
					<X className="size-3.5" />
				</Button>
			</div>

			<h3 className="font-serif text-sm font-semibold text-foreground leading-snug mb-2.5 break-words">
				{node.label}
			</h3>

			{/* ── 子圖聚焦操作 ── */}
			{onEnterSubgraph && (
				<div className="mb-3">
					{subgraphCenterId === node.id ? (
						<div className="flex items-center justify-between gap-2 p-2 rounded-md bg-primary/10 border border-primary/20 text-xs">
							<span className="flex items-center gap-1.5 text-primary font-medium text-[0.75rem]">
								<Disc className="size-3.5 shrink-0" />
								目前子圖中心
							</span>
							{onExitSubgraph && (
								<Button
									variant="ghost"
									size="xs"
									onClick={onExitSubgraph}
									className="h-6 text-[0.7rem] text-muted-foreground hover:text-foreground cursor-pointer px-1.5"
								>
									返回全圖
								</Button>
							)}
						</div>
					) : (
						<Button
							variant="outline"
							size="sm"
							onClick={() => onEnterSubgraph(node)}
							className="w-full justify-center gap-1.5 text-xs text-primary border-primary/30 hover:bg-primary/10 hover:text-primary cursor-pointer"
						>
							<Disc className="size-3.5" />
							{subgraphCenterId ? "切換以此為子圖中心" : "聚焦此技術子圖"}
						</Button>
					)}
				</div>
			)}

			{/* ── 指標卡（最常看的數字放最前） ── */}
			<div className="grid grid-cols-2 gap-1.5 mb-3">
				{node.type === "applicant" && (
					<>
						<StatCard label="專利件數" value={`${node.patent_count ?? 0}`} sub="件" />
						{node.concept_count !== undefined && (
							<StatCard label="涉足概念" value={`${node.concept_count}`} sub="個" />
						)}
					</>
				)}
				{node.type === "patent" && (
					<>
						{node.year !== undefined && (
							<StatCard label="申請年" value={`${node.year}`} sub="年" />
						)}
						{node.cited_by_count !== undefined && (
							<StatCard label="被引用" value={`${node.cited_by_count}`} sub="次" />
						)}
						{node.ipc_primary && (
							<StatCard label="IPC 主分類" value={node.ipc_primary} />
						)}
						{node.case_status && (
							<StatCard label="案件狀態" value={node.case_status} />
						)}
					</>
				)}
				{node.type === "concept" && (
					<>
						<StatCard label="專利涵蓋" value={`${node.frequency ?? 0}`} sub="篇" />
						{node.applicant_count !== undefined && (
							<StatCard label="機構涵蓋" value={`${node.applicant_count}`} sub="家" />
						)}
						{node.first_year !== undefined && (
							<StatCard label="首次出現" value={`${node.first_year}`} sub="年" />
						)}
						{node.median_year !== undefined && (
							<StatCard label="中位年" value={`${node.median_year}`} sub="年" />
						)}
						{node.last_year !== undefined && (
							<StatCard label="最近出現" value={`${node.last_year}`} sub="年" />
						)}
						{node.q1_year !== undefined && node.q3_year !== undefined && (
							<StatCard
								label="四分位區間"
								value={`${node.q1_year}–${node.q3_year}`}
								sub="年"
							/>
						)}
					</>
				)}
			</div>

			{/* ── 詳細資料 ── */}
			<dl className="space-y-2 text-xs">
				{/* Applicant fields */}
				{node.type === "applicant" && node.org_type && (
					<Row label="機構類型" value={node.org_type} />
				)}

				{/* Patent fields */}
				{node.type === "patent" && (
					<>
						{node.applicant && <Row label="申請人" value={node.applicant} />}
						{node.filing_date && <Row label="申請日" value={node.filing_date} />}
						{node.application_number && (
							<Row label="申請號" value={node.application_number} />
						)}
						{node.source_files && node.source_files.length > 0 && (
							<Row label="來源檔" value={node.source_files.join("、")} />
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
										<Button
											variant="link"
											size="xs"
											onClick={() => setAbstractExpanded((v) => !v)}
											className="ml-1 h-auto gap-0.5 px-0 text-primary hover:text-accent hover:no-underline cursor-pointer"
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
										</Button>
									)}
								</dd>
							</div>
						)}
					</>
				)}

				{/* Concept fields */}
				{node.type === "concept" && community && (
					<div className="flex items-center gap-1.5">
						<dt className="text-foreground font-medium">社群</dt>
						<dd className="flex items-center gap-1.5 m-0">
							<span
								aria-hidden
								className="w-2.5 h-2.5 rounded-full shrink-0"
								style={{ background: community.color }}
							/>
							<span className="text-muted-foreground">{community.name}</span>
						</dd>
					</div>
				)}
			</dl>

			{/* ── 年度分布（概念） ── */}
			{node.type === "concept" && yearEntries.length > 0 && (
				<div className="mt-4">
					<p className="text-[0.7rem] font-medium text-foreground mb-1.5">
						年度分布
					</p>
					<div className="space-y-1">
						{yearBarsShown.map(({ year, count }) => (
							<div key={year} className="flex items-center gap-2 text-[0.7rem]">
								<span className="w-9 shrink-0 text-right text-muted-foreground tabular-nums">
									{year}
								</span>
								<div
									className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted"
									role="img"
									aria-label={`${year} 年 ${count} 篇`}
								>
									<div
										className="h-full rounded-sm bg-primary transition-[width] duration-200"
										style={{
											width: `${(count / maxYearCount) * 100}%`,
											minWidth: count > 0 ? "3px" : 0,
										}}
									/>
								</div>
								<span className="w-6 shrink-0 text-muted-foreground tabular-nums">
									{count}
								</span>
							</div>
						))}
						{yearBarsTruncated && (
							<p className="text-[0.7rem] text-muted-foreground pt-0.5">
								… 其餘 {yearEntries.length - MAX_YEAR_BARS} 年
							</p>
						)}
					</div>
				</div>
			)}

			{/* ── 相鄰節點 ── */}
			{adjacentNodes.length > 0 && (
				<div className="mt-4">
					<p className="text-xs text-foreground font-medium mb-2 flex items-center gap-1">
						<ArrowRight size={11} className="text-muted-foreground" aria-hidden />
						相鄰節點
					</p>
					<div className="flex flex-wrap gap-1.5">
						{adjacentNodes.map((n) => (
							<Button
								key={n.id}
								variant="outline"
								size="xs"
								onClick={() => {
									onNodeSelect(n);
									onNodeFocus(n.id);
								}}
								title={n.label}
								className="h-auto max-w-full truncate rounded-md px-2 py-1 text-[0.7rem] cursor-pointer hover:opacity-90 hover:shadow-sm"
								style={{
									borderColor: n.color,
									color: n.color,
									background: `${n.color}18`,
								}}
							>
								{n.label.length > 14 ? n.label.slice(0, 14) + "…" : n.label}
							</Button>
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
