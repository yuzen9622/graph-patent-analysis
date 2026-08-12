"use client";

import { ArrowLeftRight, Columns2, Diff, X } from "lucide-react";
import {
	commonFilterSummary,
	formatJaccard,
	type CommonFilterInput,
	type CompareViewTab,
} from "@/lib/compare-export";
import {
	DIFF_COLORS,
	type CompareCount,
	type CompareMetrics,
} from "@/lib/graph-compare";

interface Props {
	aLabel: string;
	bLabel: string;
	filters: CommonFilterInput;
	metrics: CompareMetrics;
	tab: CompareViewTab;
	onTabChange: (tab: CompareViewTab) => void;
	onSwap: () => void;
	onExit: () => void;
}

function MetricRow({ title, count }: { title: string; count: CompareCount }) {
	return (
		<tr>
			<th
				scope="row"
				className="py-0.5 pr-3 text-left font-medium text-foreground"
			>
				{title}
			</th>
			<td className="py-0.5 pr-3 font-mono" style={{ color: DIFF_COLORS.a }}>
				{count.aOnly}
			</td>
			<td className="py-0.5 pr-3 font-mono" style={{ color: DIFF_COLORS.b }}>
				{count.bOnly}
			</td>
			<td
				className="py-0.5 pr-3 font-mono"
				style={{ color: DIFF_COLORS.shared }}
			>
				{count.shared}
			</td>
			<td className="py-0.5 font-mono text-foreground">
				{formatJaccard(count.jaccard)}
			</td>
		</tr>
	);
}

export default function CompareSummary({
	aLabel,
	bLabel,
	filters,
	metrics,
	tab,
	onTabChange,
	onSwap,
	onExit,
}: Props) {
	return (
		<section
			aria-label="比較摘要"
			className="shrink-0 border-b border-border bg-accent/40 px-4 py-2.5"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
						<span className="inline-flex items-center gap-1.5 min-w-0">
							<span
								aria-hidden
								className="size-2.5 shrink-0 rounded-full"
								style={{ background: DIFF_COLORS.a }}
							/>
							<span className="font-medium text-foreground">A（左）</span>
							<span className="truncate text-muted-foreground">{aLabel}</span>
						</span>
						<span className="inline-flex items-center gap-1.5 min-w-0">
							<span
								aria-hidden
								className="size-2.5 shrink-0 rounded-full"
								style={{ background: DIFF_COLORS.b }}
							/>
							<span className="font-medium text-foreground">B（右）</span>
							<span className="truncate text-muted-foreground">{bLabel}</span>
						</span>
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
						onClick={onSwap}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<ArrowLeftRight size={12} />
						交換 A/B
					</button>
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

			<table className="mt-2 text-[0.65rem]">
				<caption className="sr-only">A/B 差異指標</caption>
				<thead className="text-muted-foreground">
					<tr>
						<th scope="col" className="pr-3 text-left font-normal">
							指標
						</th>
						<th scope="col" className="pr-3 text-left font-normal">
							僅 A
						</th>
						<th scope="col" className="pr-3 text-left font-normal">
							僅 B
						</th>
						<th scope="col" className="pr-3 text-left font-normal">
							共有
						</th>
						<th scope="col" className="text-left font-normal">
							Jaccard
						</th>
					</tr>
				</thead>
				<tbody>
					<MetricRow title="節點" count={metrics.nodes} />
					<MetricRow title="關係邊" count={metrics.edges} />
				</tbody>
			</table>
		</section>
	);
}
