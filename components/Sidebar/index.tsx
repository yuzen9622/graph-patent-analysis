"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
	ChevronDown,
	MousePointerClick,
	Network,
	RotateCcw,
	SlidersHorizontal,
	Sparkles,
	Tags,
} from "lucide-react";
import { useState } from "react";
import SearchBox from "./SearchBox";
import NodeInfo from "./NodeInfo";
import EdgeInfo from "./EdgeInfo";
import YearFilter from "./YearFilter";
import LayerToggle from "./LayerToggle";
import CommunityLegend from "./CommunityLegend";
import AIReport from "./AIReport";
import SourceFileChecklist from "./SourceFileChecklist";
import type { ColorMode, Unit, ApplicantAvailability } from "@/lib/graph-view";
import type { IpcLevel, IpcTreeNode } from "@/lib/ipc-filter";
import IpcTree from "./IpcTree";
import type {
	GraphNode,
	GraphEdge,
	Community,
	NodeType,
	GraphMethodology,
	GraphMode,
} from "@/types/graph";

interface Props {
	nodes: GraphNode[];
	allNodes: GraphNode[];
	edges: GraphEdge[];
	communities: Community[];
	aiReport: string;
	yearRange: [number, number];
	fullYearRange: [number, number];
	selectedNode: GraphNode | null;
	selectedEdge: GraphEdge | null;
	methodology: GraphMethodology;
	mode: GraphMode;
	colorMode: ColorMode;
	onColorModeChange: (mode: ColorMode) => void;
	unit: Unit;
	onUnitChange: (unit: Unit) => void;
	/** P9: 家單位資料可用性（stored／rebuildable／none）。'none' 時停用「家」切換。 */
	applicantAvailability: ApplicantAvailability;
	/** PRD v2 / P2: 可選的來源檔清單與須選取。 */
	allSourceFiles: string[];
	sourceFiles: string[];
	onSourceFilesChange: (files: string[]) => void;
	/** 比較模式：右圖獨立的來源檔選取；左圖沿用上面的 sourceFiles。 */
	compareMode: boolean;
	sourceFilesRight: string[];
	onSourceFilesRightChange: (files: string[]) => void;
	/** 比較模式中面板 3+ 的非空範圍數（供篩選計數）。 */
	extraPanelCount: number;
	/** PRD v2 / P5: IPC 層級與篩選（樹狀多選，S8）。 */
	ipcLevel: IpcLevel;
	onIpcLevelChange: (level: IpcLevel) => void;
	ipcFilter: string[];
	onIpcFilterChange: (keys: string[]) => void;
	ipcTree: IpcTreeNode[];
	hasIpcData: boolean;
	minSupport: number;
	maxSupport: number;
	visibleLayers: Set<NodeType>;
	hiddenCommunities: Set<number>;
	onYearChange: (range: [number, number]) => void;
	onLayerToggle: (type: NodeType) => void;
	onCommunityToggle: (id: number) => void;
	onNodeFocus: (nodeId: string) => void;
	onNodeSelect: (node: GraphNode | null) => void;
	onEdgeClose: () => void;
	onMinSupportChange: (value: number) => void;
	/** 重設所有篩選條件（年份／來源檔／IPC／門檻／圖層／社群／引用線）。 */
	onResetFilters: () => void;
	/** P6 獨立的引用虛線證據圖層（僅概念模式）。 */
	showCitations: boolean;
	onCitationsChange: (value: boolean) => void;
}

interface SectionProps {
	title: string;
	icon?: React.ReactNode;
	/** 顯示在標題右側的計數徽章（例如隱藏中的社群數）。 */
	count?: number;
	/** 此區有作用中的設定／篩選時顯示警示點。 */
	active?: boolean;
	defaultOpen?: boolean;
	/** 傳給 Collapsible 根元素（例如 flex 容器內的 flex-1）。 */
	className?: string;
	children: React.ReactNode;
}

function Section({
	title,
	icon,
	count,
	active,
	defaultOpen = true,
	className,
	children,
}: SectionProps) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className={className}>
			<CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-1.5 py-2.5 -mx-1.5 hover:bg-muted/70 transition-colors cursor-pointer text-left">
				{icon && (
					<span className="text-muted-foreground shrink-0" aria-hidden>
						{icon}
					</span>
				)}
				<span className="text-xs font-semibold text-foreground tracking-wide flex-1">
					{title}
				</span>
				{active && (
					<span
						className="size-1.5 rounded-full bg-warning shrink-0"
						title="此區有作用中的設定"
						aria-label="此區有作用中的設定"
					/>
				)}
				{count !== undefined && count > 0 && (
					<span className="rounded-full bg-primary/10 text-primary font-mono text-[0.7rem] leading-none px-1.5 py-1 shrink-0 tabular-nums">
						{count}
					</span>
				)}
				<ChevronDown
					size={13}
					className="text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="pb-3">{children}</CollapsibleContent>
		</Collapsible>
	);
}

/** 目前的篩選條件有幾項生效（供標題計數與重設按鈕用）。 */
function countActiveFilters(props: {
	mode: GraphMode;
	yearRange: [number, number];
	fullYearRange: [number, number];
	sourceFiles: string[];
	sourceFilesRight: string[];
	compareMode: boolean;
	extraPanelCount: number;
	ipcFilter: string[];
	minSupport: number;
	showCitations: boolean;
	visibleLayers: Set<NodeType>;
	hiddenCommunities: Set<number>;
}): number {
	let n = 0;
	if (
		props.yearRange[0] !== props.fullYearRange[0] ||
		props.yearRange[1] !== props.fullYearRange[1]
	)
		n++;
	if (props.mode === "concept" || props.mode === "institution") {
		if (props.sourceFiles.length > 0) n++;
		if (props.compareMode && props.sourceFilesRight.length > 0) n++;
		if (props.compareMode && props.extraPanelCount > 0) n++;
		if (props.ipcFilter.length > 0) n++;
		if (props.minSupport > 1) n++;
	}
	if (props.mode === "concept") {
		if (props.showCitations) n++;
		if (props.hiddenCommunities.size > 0) n++;
	}
	if (props.mode === "context" || props.mode === "concept") {
		if (props.visibleLayers.size < 3) n++;
	}
	return n;
}

export default function Sidebar({
	nodes,
	allNodes,
	edges,
	communities,
	aiReport,
	yearRange,
	fullYearRange,
	selectedNode,
	selectedEdge,
	methodology,
	mode,
	colorMode,
	onColorModeChange,
	unit,
	onUnitChange,
	applicantAvailability,
	allSourceFiles,
	sourceFiles,
	onSourceFilesChange,
	compareMode,
	sourceFilesRight,
	onSourceFilesRightChange,
	extraPanelCount,
	ipcLevel,
	onIpcLevelChange,
	ipcFilter,
	onIpcFilterChange,
	ipcTree,
	hasIpcData,
	minSupport,
	maxSupport,
	visibleLayers,
	hiddenCommunities,
	onYearChange,
	onLayerToggle,
	onCommunityToggle,
	onNodeFocus,
	onNodeSelect,
	onEdgeClose,
	onMinSupportChange,
	onResetFilters,
	showCitations,
	onCitationsChange,
}: Props) {
	const activeFilterCount = countActiveFilters({
		mode,
		yearRange,
		fullYearRange,
		sourceFiles,
		sourceFilesRight,
		compareMode,
		extraPanelCount,
		ipcFilter,
		minSupport,
		showCitations,
		visibleLayers,
		hiddenCommunities,
	});

	return (
		<aside
			className="w-[300px] shrink-0 bg-background border-l border-border flex flex-col overflow-hidden"
			aria-label="控制側邊欄"
		>
			{/* 常駐搜尋列：捲動時仍可使用 */}
			<div className="shrink-0 border-b border-border bg-background px-3 py-2.5">
				<SearchBox
					nodes={nodes}
					onNodeFocus={onNodeFocus}
					onNodeSelect={(n) => onNodeSelect(n)}
				/>
			</div>

			<ScrollArea className="flex-1">
				<div className="px-3 pt-2 space-y-0.5 pb-4">
					{/* ── 節點／關係資訊 ── */}
					<Section
						title="節點／關係資訊"
						icon={<Network size={13} />}
						active={selectedNode !== null || selectedEdge !== null}
					>
						{selectedEdge ? (
							<div className="rounded-lg border border-border bg-muted/30 p-3">
								<EdgeInfo
									edge={selectedEdge}
									nodes={allNodes}
									methodology={methodology}
									onClose={onEdgeClose}
								/>
							</div>
						) : selectedNode ? (
							<div className="rounded-lg border border-border bg-muted/30 p-3">
								<NodeInfo
									node={selectedNode}
									edges={edges}
									nodes={nodes}
									communities={communities}
									onClose={() => onNodeSelect(null)}
									onNodeSelect={(n) => {
										onNodeSelect(n);
										onNodeFocus(n.id);
									}}
									onNodeFocus={onNodeFocus}
								/>
							</div>
						) : (
							<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
								<MousePointerClick
									size={18}
									className="text-muted-foreground/70"
									aria-hidden
								/>
								<p className="text-xs text-muted-foreground leading-relaxed">
									點擊圖譜中的節點或線條
									<br />
									在此查看詳細資訊與關聯指標
								</p>
							</div>
						)}
					</Section>

					<Separator className="bg-border" />

					{/* ── 篩選器 ── */}
					<div className="flex items-start gap-1">
						<Section
							title="篩選器"
							icon={<SlidersHorizontal size={13} />}
							count={activeFilterCount}
							active={activeFilterCount > 0}
							className="flex-1 min-w-0"
						>
							<div className="space-y-4">
								{mode === "context" ? (
									<>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												年份範圍
											</p>
											<YearFilter
												value={yearRange}
												fullRange={fullYearRange}
												onChange={onYearChange}
											/>
										</div>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												節點層
											</p>
											<LayerToggle
												visibleLayers={visibleLayers}
												onToggle={onLayerToggle}
											/>
										</div>
									</>
								) : mode === "institution" ? (
									<>
										<label className="block text-xs text-foreground">
											<span className="flex justify-between mb-2">
												<span className="font-medium">最低共享概念數</span>
												<span className="font-mono text-primary tabular-nums">
													{minSupport}
												</span>
											</span>
											<input
												type="range"
												min={1}
												max={Math.max(1, maxSupport)}
												value={Math.min(minSupport, Math.max(1, maxSupport))}
												onChange={(event) =>
													onMinSupportChange(Number(event.target.value))
												}
												className="w-full accent-primary"
											/>
										</label>
										<p className="text-[0.7rem] text-muted-foreground leading-relaxed">
											邊＝兩家機構共同投入 ≥
											該數量的技術概念；調高以聚焦強連帶。
										</p>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												機構類型
											</p>
											<ul className="space-y-1.5">
												{communities.map((c) => (
													<li
														key={c.name}
														className="flex items-center gap-2 text-xs"
													>
														<span
															aria-hidden
															className="size-2.5 rounded-full shrink-0"
															style={{ background: c.color }}
														/>
														<span className="text-muted-foreground">
															{c.name}
														</span>
														<span className="ml-auto font-mono text-primary tabular-nums">
															{c.node_count}
														</span>
													</li>
												))}
											</ul>
										</div>
									</>
								) : (
									<>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												年份範圍
											</p>
											<YearFilter
												value={yearRange}
												fullRange={fullYearRange}
												onChange={onYearChange}
											/>
										</div>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												分析單位
											</p>
											<div
												className="inline-flex rounded-md border border-border bg-background p-0.5"
												role="group"
												aria-label="分析單位"
											>
												{(
													[
														["patent", "篇（專利）"],
														["applicant", "家（機構）"],
													] as const
												).map(([value, label]) => {
													const disabled =
														value === "applicant" &&
														applicantAvailability === "none";
													return (
														<button
															key={value}
															type="button"
															onClick={() => onUnitChange(value)}
															disabled={disabled}
															aria-pressed={unit === value}
															title={
																disabled
																	? "此分析未含機構資料，無法使用「家（機構）」單位"
																	: undefined
															}
															className={`rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
																unit === value
																	? "bg-primary text-primary-foreground"
																	: "text-foreground/60 hover:text-foreground disabled:hover:text-muted-foreground"
															}`}
														>
															{label}
														</button>
													);
												})}
											</div>
											<p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
												{applicantAvailability === "none"
													? "此分析未含機構資料，無法使用「家（機構）」單位；請重新執行分析。"
													: unit === "applicant"
														? "門檻/大小/線寬改以「機構家數」計；同一機構跨篇碰過兩概念也算共同投入。" +
															(applicantAvailability === "rebuildable"
																? "（此分析為舊格式，「家」計量由專利—機構結構重建）"
																: "")
														: "門檻/大小/線寬以「專利篇數」計。"}
											</p>
										</div>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												概念顏色
											</p>
											<div
												className="inline-flex rounded-md border border-border bg-background p-0.5"
												role="group"
												aria-label="概念顏色模式"
											>
												{(
													[
														["community", "社群色"],
														["first_year", "首次出現年"],
														...(allSourceFiles.length > 1
															? ([["source", "依來源檔"]] as const)
															: []),
														...(hasIpcData
															? ([["ipc", "依 IPC"]] as const)
															: []),
													] as const
												).map(([value, label]) => (
													<button
														key={value}
														type="button"
														onClick={() => onColorModeChange(value)}
														aria-pressed={colorMode === value}
														className={`rounded px-2 py-1 text-xs transition-colors ${
															colorMode === value
																? "bg-primary text-primary-foreground"
																: "text-foreground/60 hover:text-foreground"
														}`}
													>
														{label}
													</button>
												))}
											</div>
											{colorMode === "community" && (
												<p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
													{unit === "applicant"
														? "顏色＝「家」單位 Louvain 社群（同一機構跨篇碰過的概念對分）；隨分析單位自動切換，分區獨立於「篇」單位社群。"
														: "顏色＝以 support 加權的 Louvain 技術社群（「篇」單位）。"}
												</p>
											)}
											{colorMode === "first_year" && (
												<p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
													顏色＝概念首次出現的申請年份（漸層由早至晚）；切換只影響顯示，不改變資料。
												</p>
											)}
											{colorMode === "community_applicants" && (
												<p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
													顏色＝「家」單位 Louvain
													社群（同一機構跨篇碰過的概念對分）；分區獨立於「篇」單位社群。
												</p>
											)}
											{colorMode === "source" && (
												<p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
													顏色＝該概念在哪幾個來源檔出現；單獨一文用該檔本色，跨多檔概念用灰紫共享色。
													<br />
													只著色不篩選——想只看某檔再往下「來源檔篩選」。
												</p>
											)}
											{colorMode === "ipc" && (
												<p className="text-[0.7rem] text-muted-foreground mt-1.5 leading-relaxed">
													顏色＝概念優勢 IPC（L{ipcLevel}
													）：該概念的多數專利落在哪個分類。IPC
													篩選請見下方「IPC 分類篩選」。
												</p>
											)}
										</div>
										<div>
											<p className="text-xs text-foreground font-medium mb-2">
												來源檔案篩選
											</p>
											{allSourceFiles.length <= 1 ? (
												<p className="text-[0.7rem] text-muted-foreground leading-relaxed">
													此分析只有一個來源檔；多檔上傳後可用來源檔篩選做「比對」。
												</p>
											) : compareMode ? (
												<div className="space-y-3">
													<SourceFileChecklist
														label="A（左圖）來源"
														allSourceFiles={allSourceFiles}
														sourceFiles={sourceFiles}
														onChange={onSourceFilesChange}
													/>
													<SourceFileChecklist
														label="B（右圖）來源"
														allSourceFiles={allSourceFiles}
														sourceFiles={sourceFilesRight}
														onChange={onSourceFilesRightChange}
													/>
												</div>
											) : (
												<SourceFileChecklist
													allSourceFiles={allSourceFiles}
													sourceFiles={sourceFiles}
													onChange={onSourceFilesChange}
												/>
											)}
										</div>
										{hasIpcData && (
											<div>
												<div className="flex items-center justify-between">
													<p className="text-xs text-foreground font-medium mb-2">
														IPC 層級
													</p>
													<span className="font-mono text-primary tabular-nums">
														L{ipcLevel}
													</span>
												</div>
												<input
													type="range"
													min={1}
													max={5}
													value={ipcLevel}
													onChange={(event) =>
														onIpcLevelChange(
															Number(event.target.value) as IpcLevel,
														)
													}
													className="w-full accent-primary"
													aria-label="IPC 層級"
												/>
												<p className="text-[0.7rem] text-muted-foreground leading-relaxed">
													{ipcLevel} 級（
													{
														["L1 部", "L2 類", "L3 次類", "L4 主類", "L5 次目"][
															ipcLevel - 1
														]
													}
													）。
													<br />
													切換層級會清空 IPC 篩選。
												</p>
												<p className="mt-3 text-xs text-foreground font-medium mb-1.5">
													IPC 分類篩選
												</p>
												<IpcTree
													nodes={ipcTree}
													level={ipcLevel}
													selected={ipcFilter}
													onToggle={(key) =>
														onIpcFilterChange(
															ipcFilter.includes(key)
																? ipcFilter.filter((k) => k !== key)
																: [...ipcFilter, key],
														)
													}
												/>
												<div className="mt-2 flex gap-1.5">
													<button
														type="button"
														onClick={() => onIpcFilterChange([])}
														className="rounded border border-border px-2 py-1 text-[0.7rem] text-muted-foreground hover:bg-accent"
													>
														全部 IPC
													</button>
													<p className="text-[0.7rem] text-muted-foreground self-center">
														{ipcFilter.length === 0
															? "未篩選（顯示全圖）"
															: `篩選 ${ipcFilter.length} 個 IPC（任一命中即保留）`}
													</p>
												</div>
											</div>
										)}
										<label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
											<input
												type="checkbox"
												checked={showCitations}
												onChange={(event) =>
													onCitationsChange(event.target.checked)
												}
												className="mt-0.5"
											/>
											<span>
												顯示引用虛線
												<span className="block text-[0.7rem] text-muted-foreground mt-0.5">
													疊上專利間引用關係投影到概念層；可用內部引用篇數不多，畫面通常變化很小
												</span>
											</span>
										</label>
										<label className="block text-xs text-foreground">
											<span className="flex justify-between mb-2">
												<span className="font-medium">
													{unit === "applicant"
														? "最低共同家數"
														: "最低共同專利數"}
												</span>
												<span className="font-mono text-primary tabular-nums">
													{minSupport}
												</span>
											</span>
											<input
												type="range"
												min={1}
												max={Math.max(1, maxSupport)}
												value={Math.min(minSupport, Math.max(1, maxSupport))}
												onChange={(event) =>
													onMinSupportChange(Number(event.target.value))
												}
												className="w-full accent-primary"
											/>
										</label>
										<p className="text-[0.7rem] text-muted-foreground leading-relaxed">
											概念統計與關係指標由選定的年份／來源檔／IPC
											子集重新計算；門檻只過濾顯示。
										</p>
									</>
								)}
							</div>
						</Section>
						{activeFilterCount > 0 && (
							<button
								type="button"
								onClick={onResetFilters}
								title="重設年份、來源檔、IPC、門檻、圖層、社群與引用線等所有篩選"
								className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-[0.7rem] text-primary hover:bg-primary/10 transition-colors cursor-pointer"
							>
								<RotateCcw size={11} />
								重設
							</button>
						)}
					</div>

					<Separator className="bg-border" />

					{/* Community Legend */}
					{mode === "concept" && communities.length > 0 && (
						<>
							<Section
								title="技術社群"
								icon={<Tags size={13} />}
								count={hiddenCommunities.size}
								active={hiddenCommunities.size > 0}
							>
								<CommunityLegend
									communities={communities}
									hiddenCommunities={hiddenCommunities}
									onToggle={onCommunityToggle}
								/>
							</Section>
							<Separator className="bg-border" />
						</>
					)}

					{/* AI Report */}
					{aiReport && (
						<Section
							title="AI 趨勢報告"
							icon={<Sparkles size={13} />}
							defaultOpen={false}
						>
							<AIReport html={aiReport} />
						</Section>
					)}
				</div>
			</ScrollArea>
		</aside>
	);
}
