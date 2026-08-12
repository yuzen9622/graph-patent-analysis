"use client";

import { compareLegendItems } from "@/lib/compare-export";
import type { DiffMembership } from "@/lib/graph-compare";

interface Props {
	hidden: Set<DiffMembership>;
	onToggle: (membership: DiffMembership) => void;
	visibleNodeCount: number;
	totalNodeCount: number;
}

export default function DiffLegend({
	hidden,
	onToggle,
	visibleNodeCount,
	totalNodeCount,
}: Props) {
	return (
		<aside
			aria-label="差異圖例與顯示切換"
			className="absolute bottom-3 left-3 z-10 w-[min(20rem,calc(100%-1.5rem))] rounded-md border border-border bg-background/95 px-3 py-2.5 text-xs backdrop-blur-sm"
		>
			<p className="mb-1.5 font-medium text-foreground">
				差異圖例（可切換顯示）
			</p>
			<div className="flex flex-col gap-0.5">
				{compareLegendItems().map((item) => (
					<label
						key={item.membership}
						className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 hover:bg-accent"
					>
						<input
							type="checkbox"
							checked={!hidden.has(item.membership)}
							onChange={() => onToggle(item.membership)}
							className="size-4"
						/>
						<span
							aria-hidden
							className="size-3 shrink-0 rounded-sm"
							style={{ background: item.color }}
						/>
						<span className="min-w-0">
							<span className="text-foreground">{item.label}</span>
							<span className="text-muted-foreground"> · {item.encoding}</span>
						</span>
					</label>
				))}
			</div>
			<p role="status" className="mt-1.5 text-[0.65rem] text-muted-foreground">
				顯示中的節點：{visibleNodeCount} / {totalNodeCount}
			</p>
		</aside>
	);
}
