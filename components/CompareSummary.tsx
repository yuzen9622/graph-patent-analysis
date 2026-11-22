"use client";

import { Badge } from "@/components/ui/badge";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from "@/components/ui/table";

import { ArrowLeftRight, Columns2, Diff, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	commonFilterSummary,
	formatJaccard,
	panelLabel,
	type CommonFilterInput,
	type CompareViewTab,
} from "@/lib/compare-export";
import {
	type CompareCount,
	type CompareMetrics,
} from "@/lib/graph-compare";

interface Props {
	labels: string[];
	filters: CommonFilterInput;
	metrics: CompareMetrics;
	tab: CompareViewTab;
	onTabChange: (tab: CompareViewTab) => void;
	onSwap?: () => void;
	onExit: () => void;
	onEditScope: () => void;
}

function MetricRow({ title, count }: { title: string; count: CompareCount }) {
	const panelCount = count.counts.length;
	if (panelCount <= 2) {
		return (
			<TableRow>
				<TableHead
					scope="row"
				>
					{title}
				</TableHead>
				<TableCell className="text-graph-diff-a">
					{count.aOnly ?? 0}
				</TableCell>
				<TableCell className="text-graph-diff-b">
					{count.bOnly ?? 0}
				</TableCell>
				<TableCell
					className="text-graph-diff-shared"
				>
					{count.counts[1] ?? 0}
				</TableCell>
				<TableCell>
					{formatJaccard(count.jaccard)}
				</TableCell>
			</TableRow>
		);
	}
	return (
		<TableRow>
			<TableHead
				scope="row"
			>
				{title}
			</TableHead>
			{count.counts.map((value, index) => (
				<TableCell key={index}>
					{value}
				</TableCell>
			))}
			<TableCell>
				{formatJaccard(count.jaccard)}
			</TableCell>
		</TableRow>
	);
}

export default function CompareSummary({
	labels,
	filters,
	metrics,
	tab,
	onTabChange,
	onSwap,
	onExit,
	onEditScope,
}: Props) {
	const panelCount = labels.length;
	const twoPanels = panelCount <= 2;

	return (
		<section
			aria-label="比較摘要"
			className="shrink-0 bg-accent/40 px-4 py-2.5"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
						{labels.map((label, index) =>
							twoPanels ? (
								<span
									key={index}
									className="inline-flex items-center gap-1.5 min-w-0"
								>
									<span
										aria-hidden
										className={`size-2.5 shrink-0 rounded-full ${index === 0 ? "bg-graph-diff-a" : "bg-graph-diff-b"}`}
									/>
									<span className="font-medium text-foreground">
										{panelLabel(index, panelCount)}
										{index === 0 ? "（左）" : "（右）"}
									</span>
									<span className="truncate text-muted-foreground">
										{label}
									</span>
								</span>
							) : (
								<Badge variant="secondary"
									key={index}
								>
									<span className="font-medium text-foreground">
										{panelLabel(index, panelCount)}
									</span>
									<span className="truncate text-muted-foreground">
										{label}
									</span>
								</Badge>
							),
						)}
					</div>
					<div className="text-[0.65rem] leading-relaxed text-muted-foreground">
						<span className="font-medium text-foreground">共用篩選：</span>
						{commonFilterSummary(filters).join("｜")}
					</div>
				</div>

				<div className="flex items-center gap-2">
					<div
						className="inline-flex rounded-md border border-border bg-background p-0.5"
						aria-label="比較檢視"
					>
						{(
							[
								["side-by-side", "並排", Columns2],
								["difference", "差異", Diff],
							] as const
						).map(([value, label, Icon]) => (
							<Button
								key={value}
								type="button"
								variant={tab === value ? "default" : "ghost"}
								size="sm"
								onClick={() => onTabChange(value)}
								aria-pressed={tab === value}
							>
								<Icon size={12} />
								{label}
							</Button>
						))}
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onEditScope}
						className="gap-1.5"
					>
						<Pencil size={12} />
						編輯範圍
					</Button>
					{onSwap && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={onSwap}
							className="gap-1.5"
						>
							<ArrowLeftRight size={12} />
							交換 A/B
						</Button>
					)}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onExit}
						className="gap-1.5"
					>
						<X size={12} />
						結束比較
					</Button>
				</div>
			</div>

			<div className="mt-2 overflow-x-auto text-[0.65rem]">
				<Table>
					<TableCaption className="sr-only">
						{twoPanels ? "A/B 差異指標" : "面板比較指標"}
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">
								指標
							</TableHead>
							{twoPanels ? (
								<>
									<TableHead scope="col">
										僅 A
									</TableHead>
									<TableHead scope="col">
										僅 B
									</TableHead>
									<TableHead scope="col">
										共有
									</TableHead>
								</>
							) : (
								metrics.nodes.counts.map((_, index) => (
									<TableHead
										key={index}
										scope="col"
									>
										僅 {index + 1} 組
									</TableHead>
								))
							)}
							<TableHead scope="col">
								{twoPanels ? "Jaccard" : "共有比例"}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<MetricRow title="節點" count={metrics.nodes} />
						<MetricRow title="關係邊" count={metrics.edges} />
					</TableBody>
				</Table>
			</div>
		</section>
	);
}
