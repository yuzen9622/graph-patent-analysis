"use client";

import { graphSwatch } from "@/lib/graph-swatch";
import { Card, CardContent } from "@/components/ui/card";

import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Community } from "@/types/graph";

interface Props {
	communities: Community[];
	hiddenCommunities: Set<number>;
	onToggle: (id: number) => void;
}

export default function CommunityLegend({
	communities,
	hiddenCommunities,
	onToggle,
}: Props) {
	if (communities.length === 0) return null;

	const hiddenCount = communities.filter((c) =>
		hiddenCommunities.has(c.id),
	).length;

	return (
		<div>
			<p className="mb-2 text-[0.7rem] leading-relaxed text-muted-foreground">
				社群名稱取群內連結度最高的概念作為代表概念，不等同人工分類名稱。
			</p>
			{hiddenCount > 0 && (
				<Card><CardContent className="flex items-center justify-between">
					<span className="inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
						<EyeOff size={11} aria-hidden />
						已隱藏 {hiddenCount} 個社群
					</span>
					<Button
						type="button"
						variant="link"
						size="xs"
						onClick={() =>
							communities
								.filter((c) => hiddenCommunities.has(c.id))
								.forEach((c) => onToggle(c.id))
						}
					>
						全部顯示
					</Button>
				</CardContent></Card>
			)}
			<ul className="space-y-0.5">
				{communities.map((c) => {
					const isHidden = hiddenCommunities.has(c.id);
					return (
						<li key={c.id}>
							<Button
								variant="ghost"
								size="xs"
								onClick={() => onToggle(c.id)}
								title={isHidden ? `顯示「${c.name}」` : `隱藏「${c.name}」`}
								aria-pressed={!isHidden}
								className="w-full justify-start gap-2"
							>
								<span
									aria-hidden
									className={`w-3 h-3 rounded-full shrink-0 transition-opacity bg-graph-swatch ${isHidden ? "opacity-30" : ""}`}
									style={graphSwatch(c.color)}
								/>
								<span
									className={`flex-1 text-xs text-left truncate transition-colors ${
										isHidden
											? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
											: "text-foreground"
									}`}
								>
									{c.name}
								</span>
								<span className="text-[0.7rem] text-muted-foreground shrink-0 tabular-nums">
									{c.node_count}
								</span>
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
