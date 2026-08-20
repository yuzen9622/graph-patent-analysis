"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Layers, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RAINBOW_COLORS, UNKNOWN_YEAR_COLOR } from "@/lib/concept-time";
import {
	SOURCE_FILE_COLORS,
	SOURCE_OVERLAP_COLOR,
	INSTITUTION_TYPE_COLORS,
	type ColorMode,
	type InstitutionType,
} from "@/lib/graph-view";
import type { IpcLevel } from "@/lib/ipc-filter";
import type { Community, NodeType, GraphMode } from "@/types/graph";

interface Props {
	mode: GraphMode;
	colorMode: ColorMode;
	communities: Community[];
	hiddenCommunities?: Set<number>;
	onToggleCommunity?: (id: number) => void;
	ipcLegend: Array<{ key: string; color: string; count: number }>;
	ipcLevel: IpcLevel;
	yearRange: [number, number];
	fullYearRange?: [number, number];
	timeWindow?: [number, number] | null;
	allSourceFiles: string[];
	visibleLayers?: Set<NodeType>;
}

const CONTEXT_LAYERS: Array<{
	type: NodeType;
	label: string;
	color: string;
	shape: string;
}> = [
	{ type: "applicant", label: "申請人層", color: "#4E79A7", shape: "★ 星形" },
	{ type: "patent", label: "專利層", color: "#F28E2B", shape: "● 圓點" },
	{ type: "concept", label: "概念層", color: "#59A14F", shape: "● 圓點" },
];

const IPC_LEVEL_NAMES: Record<IpcLevel, string> = {
	1: "L1 部 (Section)",
	2: "L2 類 (Class)",
	3: "L3 次類 (Subclass)",
	4: "L4 主類 (Main Group)",
	5: "L5 次目 (Subgroup)",
};

export default function FloatingLegend({
	mode,
	colorMode,
	communities,
	hiddenCommunities,
	onToggleCommunity,
	ipcLegend,
	ipcLevel,
	yearRange,
	fullYearRange,
	timeWindow,
	allSourceFiles,
	visibleLayers,
}: Props) {
	const [expanded, setExpanded] = useState(true);

	// Determine title and content according to view mode & colorMode
	let title = "圖譜圖例";
	let badgeText = "";

	if (mode === "context") {
		title = "專利脈絡圖例";
		badgeText = "三層節點";
	} else if (mode === "institution") {
		title = "機構類型圖例";
		badgeText = "機構類別";
	} else if (colorMode === "community" || colorMode === "community_applicants") {
		title =
			colorMode === "community_applicants" ? "機構社群圖例" : "技術社群圖例";
		badgeText = `共 ${communities.length} 個社群`;
	} else if (colorMode === "first_year") {
		title = "首次出現年份圖例";
		badgeText = "時間彩虹漸層";
	} else if (colorMode === "ipc") {
		title = `IPC 分類圖例（${IPC_LEVEL_NAMES[ipcLevel] ?? `L${ipcLevel}`}）`;
		badgeText = `共 ${ipcLegend.length} 個分類`;
	} else if (colorMode === "source") {
		title = "來源檔案圖例";
		badgeText = `共 ${allSourceFiles.length} 檔`;
	}

	const renderContent = () => {
		if (mode === "context") {
			return (
				<div className="space-y-1">
					{CONTEXT_LAYERS.map((layer) => {
						const isVisible = !visibleLayers || visibleLayers.has(layer.type);
						return (
							<div
								key={layer.type}
								className={`flex items-center justify-between gap-2 py-0.5 text-xs transition-opacity ${
									isVisible ? "opacity-100" : "opacity-40"
								}`}
							>
								<div className="flex items-center gap-1.5 min-w-0">
									<span
										aria-hidden
										className="size-2.5 shrink-0 rounded-sm"
										style={{ background: layer.color }}
									/>
									<span className="truncate text-foreground font-medium">
										{layer.label}
									</span>
								</div>
								<span className="text-[0.65rem] text-muted-foreground shrink-0 font-mono">
									{layer.shape}
								</span>
							</div>
						);
					})}
				</div>
			);
		}

		if (mode === "institution") {
			const types = Object.entries(INSTITUTION_TYPE_COLORS) as Array<
				[InstitutionType, string]
			>;
			return (
				<div className="grid grid-cols-2 gap-x-2 gap-y-1">
					{types.map(([name, color]) => (
						<div key={name} className="flex items-center gap-1.5 py-0.5 text-xs">
							<span
								aria-hidden
								className="size-2.5 shrink-0 rounded-full"
								style={{ background: color }}
							/>
							<span className="truncate text-foreground">{name}</span>
						</div>
					))}
				</div>
			);
		}

		if (colorMode === "community" || colorMode === "community_applicants") {
			if (communities.length === 0) {
				return <p className="text-[0.7rem] text-muted-foreground">無社群資料</p>;
			}
			return (
				<div className="space-y-1">
					<p className="text-[0.65rem] text-muted-foreground mb-1">
						以群內核心概念命名（點擊可切換顯示／隱藏）：
					</p>
					<div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
						{communities.map((c) => {
							const isHidden = hiddenCommunities?.has(c.id);
							return (
								<button
									key={c.id}
									type="button"
									onClick={() => onToggleCommunity?.(c.id)}
									className={`flex w-full items-center justify-between gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent cursor-pointer ${
										isHidden ? "opacity-40" : "opacity-100"
									}`}
									title={isHidden ? `點擊顯示「${c.name}」` : `點擊隱藏「${c.name}」`}
								>
									<div className="flex items-center gap-1.5 min-w-0">
										<span
											aria-hidden
											className="size-2.5 shrink-0 rounded-full"
											style={{ background: c.color }}
										/>
										<span className="truncate text-foreground">{c.name}</span>
									</div>
									<div className="flex items-center gap-1 shrink-0 text-[0.65rem] text-muted-foreground font-mono">
										{isHidden && <EyeOff size={10} />}
										<span>{c.node_count ?? 0}</span>
									</div>
								</button>
							);
						})}
					</div>
				</div>
			);
		}

		if (colorMode === "first_year") {
			const minYear = timeWindow
				? timeWindow[0]
				: fullYearRange
					? fullYearRange[0]
					: yearRange[0];
			const maxYear = timeWindow
				? timeWindow[1]
				: fullYearRange
					? fullYearRange[1]
					: yearRange[1];
			const midYear = Math.round((minYear + maxYear) / 2);

			return (
				<div className="space-y-2 text-xs">
					<div>
						<div
							className="h-3 w-full rounded-md shadow-inner"
							style={{
								background: `linear-gradient(to right, ${RAINBOW_COLORS.join(", ")})`,
							}}
							title="紅（最早）→ 橙 → 黃 → 綠 → 藍 → 靛 → 紫（最近）"
						/>
						<div className="mt-1 flex items-center justify-between text-[0.65rem] font-mono text-muted-foreground">
							<span className="text-red-500 font-semibold">{minYear} 年</span>
							<span>{midYear} 年</span>
							<span className="text-purple-500 font-semibold">{maxYear} 年</span>
						</div>
					</div>

					<div className="flex items-center justify-between border-t border-border/60 pt-1.5 text-[0.7rem]">
						<div className="flex items-center gap-1">
							{RAINBOW_COLORS.map((color, i) => (
								<span
									key={color}
									className="size-2 rounded-full"
									style={{ background: color }}
									title={["紅", "橙", "黃", "綠", "藍", "靛", "紫"][i]}
								/>
							))}
							<span className="text-muted-foreground ml-1">早至晚</span>
						</div>
						<div className="flex items-center gap-1.5 text-muted-foreground">
							<span
								aria-hidden
								className="size-2 rounded-full"
								style={{ background: UNKNOWN_YEAR_COLOR }}
							/>
							<span>未知年份</span>
						</div>
					</div>
				</div>
			);
		}

		if (colorMode === "ipc") {
			if (ipcLegend.length === 0) {
				return (
					<p className="text-[0.7rem] text-muted-foreground">
						此分析無 IPC 分類資料
					</p>
				);
			}
			return (
				<div className="space-y-1">
					<p className="text-[0.65rem] text-muted-foreground mb-1">
						概念節點依優勢 IPC 分類著色：
					</p>
					<div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
						{ipcLegend.map((item) => (
							<div
								key={item.key}
								className="flex items-center justify-between gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
							>
								<div className="flex items-center gap-1.5 min-w-0">
									<span
										aria-hidden
										className="size-2.5 shrink-0 rounded-sm"
										style={{ background: item.color }}
									/>
									<span className="font-mono font-medium text-foreground truncate">
										{item.key}
									</span>
								</div>
								<span className="font-mono text-[0.65rem] text-muted-foreground shrink-0">
									{item.count} 篇
								</span>
							</div>
						))}
					</div>
				</div>
			);
		}

		if (colorMode === "source") {
			return (
				<div className="space-y-1">
					<div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
						{allSourceFiles.map((filename, i) => (
							<div
								key={filename}
								className="flex items-center justify-between gap-1.5 rounded px-1 py-0.5 text-xs"
							>
								<div className="flex items-center gap-1.5 min-w-0">
									<span
										aria-hidden
										className="size-2.5 shrink-0 rounded-full"
										style={{
											background: SOURCE_FILE_COLORS[i % SOURCE_FILE_COLORS.length],
										}}
									/>
									<span className="truncate text-foreground">{filename}</span>
								</div>
							</div>
						))}
						<div className="flex items-center justify-between gap-1.5 rounded px-1 py-0.5 text-xs border-t border-border/50 pt-1 mt-1">
							<div className="flex items-center gap-1.5 min-w-0">
								<span
									aria-hidden
									className="size-2.5 shrink-0 rounded-full"
									style={{ background: SOURCE_OVERLAP_COLOR }}
								/>
								<span className="text-muted-foreground font-medium">
									跨多檔共有概念
								</span>
							</div>
						</div>
					</div>
				</div>
			);
		}

		return null;
	};

	return (
		<aside
			aria-label="右下角顏色圖例清單"
			className="absolute bottom-3 right-3 z-10 w-[min(18.5rem,calc(100%-1.5rem))] rounded-lg border border-border bg-background/92 p-2.5 text-xs shadow-lg backdrop-blur-md transition-all dark:bg-background/95"
		>
			<div className="flex items-center justify-between gap-1 pb-1.5 border-b border-border/60">
				<div className="flex items-center gap-1.5 min-w-0">
					<Layers size={13} className="text-primary shrink-0" aria-hidden />
					<h3 className="font-semibold text-foreground truncate text-xs">{title}</h3>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{badgeText && (
						<span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground font-medium">
							{badgeText}
						</span>
					)}
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => setExpanded(!expanded)}
						className="size-5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
						aria-label={expanded ? "收合圖例" : "展開圖例"}
					>
						{expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
					</Button>
				</div>
			</div>

			{expanded && <div className="pt-2">{renderContent()}</div>}
		</aside>
	);
}
