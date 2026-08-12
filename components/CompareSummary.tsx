"use client";

import { ArrowLeftRight, Columns2, Diff, Pencil, X } from "lucide-react";
import {
	commonFilterSummary,
	formatJaccard,
	panelLabel,
	type CommonFilterInput,
	type CompareViewTab,
} from "@/lib/compare-export";
import {
	DIFF_COLORS,
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
			<tr>
				<th
					scope="row"
					className="py-0.5 pr-3 text-left font-medium text-foreground"
				>
					{title}
				</th>
				<td className="py-0.5 pr-3 font-mono" style={{ color: DIFF_COLORS.a }}>
					{count.aOnly ?? 0}
				</td>
				<td className="py-0.5 pr-3 font-mono" style={{ color: DIFF_COLORS.b }}>
					{count.bOnly ?? 0}
				</td>
				<td
					className="py-0.5 pr-3 font-mono"
					style={{ color: DIFF_COLORS.shared }}
				>
					{count.counts[1] ?? 0}
				</td>
				<td className="py-0.5 font-mono text-foreground">
					{formatJaccard(count.jaccard)}
				</td>
			</tr>
		);
	}
	return (
		<tr>
			<th
				scope="row"
				className="py-0.5 pr-3 text-left font-medium text-foreground"
			>
				{title}
			</th>
			{count.counts.map((value, index) => (
				<td key={index} className="py-0.5 pr-3 font-mono text-foreground">
					{value}
				</td>
			))}
			<td className="py-0.5 font-mono text-foreground">
				{formatJaccard(count.jaccard)}
			</td>
		</tr>
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
			className="shrink-0 border-b border-border bg-accent/40 px-4 py-2.5"
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
										className="size-2.5 shrink-0 rounded-full"
										style={{
											background: index === 0 ? DIFF_COLORS.a : DIFF_COLORS.b,
										}}
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
								<span
									key={index}
									className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5"
								>
									<span className="font-medium text-foreground">
										{panelLabel(index, panelCount)}
									</span>
									<span className="truncate text-muted-foreground">
										{label}
									</span>
								</span>
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
							<button
								key={value}
								type="button"
								onClick={() => onTabChange(value)}
								aria-pressed={tab === value}
								className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
									tab === value
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								<Icon size={12} />
								{label}
							</button>
						))}
					</div>
					<button
						type="button"
						onClick={onEditScope}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<Pencil size={12} />
						編輯範圍
					</button>
					{onSwap && (
						<button
							type="button"
							onClick={onSwap}
							className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						>
							<ArrowLeftRight size={12} />
							交換 A/B
						</button>
					)}
					<button
						type="button"
						onClick={onExit}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<X size={12} />
						結束比較
					</button>
				</div>
			</div>

			<div className="mt-2 overflow-x-auto text-[0.65rem]">
				<table>
					<caption className="sr-only">
						{twoPanels ? "A/B 差異指標" : "面板比較指標"}
					</caption>
					<thead className="text-muted-foreground">
						<tr>
							<th scope="col" className="pr-3 text-left font-normal">
								指標
							</th>
							{twoPanels ? (
								<>
									<th scope="col" className="pr-3 text-left font-normal">
										僅 A
									</th>
									<th scope="col" className="pr-3 text-left font-normal">
										僅 B
									</th>
									<th scope="col" className="pr-3 text-left font-normal">
										共有
									</th>
								</>
							) : (
								metrics.nodes.counts.map((_, index) => (
									<th
										key={index}
										scope="col"
										className="pr-3 text-left font-normal"
									>
										僅 {index + 1} 組
									</th>
								))
							)}
							<th scope="col" className="text-left font-normal">
								{twoPanels ? "Jaccard" : "共有比例"}
							</th>
						</tr>
					</thead>
					<tbody>
						<MetricRow title="節點" count={metrics.nodes} />
						<MetricRow title="關係邊" count={metrics.edges} />
					</tbody>
				</table>
			</div>
		</section>
	);
}
