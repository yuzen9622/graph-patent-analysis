"use client";

import { useState } from "react";
import { FileImage, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	isFullLabelBlocked,
	fullLabelBlockedMessage,
	type PublicationDpi,
	type PublicationLabelMode,
} from "@/lib/publication-export";

export interface PublicationGenerateOptions {
	mode: "overview" | "subgraph";
	widthMm: number;
	dpi: PublicationDpi;
	labelMode: PublicationLabelMode;
	centerNodeId?: string;
	hops?: 1 | 2;
}

interface Props {
	/** M1 整體圖的節點數，用於 §3 封鎖矩陣判斷。 */
	overviewNodeCount: number;
	/** 目前畫布上選取的節點（M2 子圖的中心）；沒選就是 null。 */
	selectedNodeId: string | null;
	selectedNodeLabel: string | null;
	/** 純函數：給中心節點與 hop 數，回傳子圖會有幾個節點（用於封鎖矩陣判斷）。 */
	getSubgraphNodeCount: (nodeId: string, hops: 1 | 2) => number;
	disabled: boolean;
	disabledReason?: string;
	onGenerate: (options: PublicationGenerateOptions) => void;
}

const WIDTH_PRESETS: Array<[number, string]> = [
	[85, "85mm"],
	[120, "120mm"],
	[180, "180mm"],
];
const LABEL_OPTIONS: Array<[PublicationLabelMode, string]> = [
	["primary", "僅主要概念"],
	["all", "全部概念"],
	["none", "不顯示"],
];
const DPI_OPTIONS: PublicationDpi[] = [300, 600];

/**
 * PRD-Q8 出版圖選項面板：M1 整體圖／M2 局部子圖共用一個面板，圖幅支援
 * 85/120/180mm 快捷值＋自訂 mm，另有 300/600dpi。觸發後由父層呼叫
 * GraphViewer 的 onPublicationCaptureReady 產生圖片。
 */
export default function PublicationExportPanel({
	overviewNodeCount,
	selectedNodeId,
	selectedNodeLabel,
	getSubgraphNodeCount,
	disabled,
	disabledReason,
	onGenerate,
}: Props) {
	const [open, setOpen] = useState(false);
	const [figureMode, setFigureMode] = useState<"overview" | "subgraph">(
		"overview",
	);
	const [widthMm, setWidthMm] = useState(180);
	const [dpi, setDpi] = useState<PublicationDpi>(300);
	const [labelMode, setLabelMode] = useState<PublicationLabelMode>("primary");
	const [hops, setHops] = useState<1 | 2>(2);
	const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

	const isSubgraph = figureMode === "subgraph";
	const needsCenterNode = isSubgraph && !selectedNodeId;
	const effectiveNodeCount = isSubgraph
		? selectedNodeId
			? getSubgraphNodeCount(selectedNodeId, hops)
			: 0
		: overviewNodeCount;
	// §2 M2：子圖一律全標籤，忽略下方的標籤選擇。
	const effectiveLabelMode: PublicationLabelMode = isSubgraph
		? "all"
		: labelMode;

	// §3 矩陣原本是硬擋；碰撞避讓已經會自動省略重疊標籤，不會畫出疊字的圖，
	// 所以這裡改成「示警 + 使用者勾選承擔」——下載後會誠實回報實際放上幾個、省略幾個。
	const risky =
		effectiveLabelMode === "all" &&
		isFullLabelBlocked(effectiveNodeCount, widthMm);
	const canGenerate = !needsCenterNode && (!risky || acknowledgeRisk);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				disabled={disabled}
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-pressed={open}
						title={
							disabled
								? (disabledReason ?? "等待圖譜佈局完成")
								: "產生可放入論文的出版圖（PRD-Q8 M1/M2）"
						}
						className={`h-auto gap-1.5 rounded-md py-1.5 text-xs disabled:pointer-events-auto ${
							disabled
								? "cursor-not-allowed"
								: "cursor-pointer hover:bg-accent hover:text-accent-foreground"
						}`}
						aria-label="出版整體圖選項"
					/>
				}
			>
				<FileImage size={12} />
				出版圖
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" sideOffset={8} className="w-72 p-3">
				<p className="text-xs font-semibold text-foreground mb-2">
					出版圖（PRD-Q8）
				</p>

				<DropdownMenuRadioGroup
					value={figureMode}
					onValueChange={(value) => setFigureMode(value as "overview" | "subgraph")}
					aria-label="M1／M2"
					className="mb-3"
				>
					<DropdownMenuRadioItem value="overview">M1 整體圖</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="subgraph">M2 局部子圖</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>

				{isSubgraph && (
					<div className="mb-3 space-y-2">
						<p className="text-[0.65rem] text-muted-foreground">
							中心節點：
							{selectedNodeLabel ? (
								<span className="font-medium text-foreground">{selectedNodeLabel}</span>
							) : (
								<span className="text-destructive">請先在圖上點選一個節點</span>
							)}
						</p>
						<div>
							<p className="text-[0.65rem] text-muted-foreground mb-1.5">
								關聯範圍（層級）
							</p>
							<DropdownMenuRadioGroup
								value={String(hops)}
								onValueChange={(value) => setHops(Number(value) as 1 | 2)}
								aria-label="關聯範圍"
							>
								<DropdownMenuRadioItem value="1">
									1 層（僅直接關聯）
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="2">
									2 層（延伸脈絡，建議）
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</div>
						{selectedNodeId && (
							<p className="text-[0.65rem] text-muted-foreground">
								子圖節點數：{effectiveNodeCount}（全部顯示中文標籤）
							</p>
						)}
					</div>
				)}

				<div className="mb-3">
					<p className="text-[0.65rem] text-muted-foreground mb-1.5">圖幅</p>
					<DropdownMenuRadioGroup
						value={String(widthMm)}
						onValueChange={(value) => setWidthMm(Number(value))}
						aria-label="圖幅快捷值"
					>
						{WIDTH_PRESETS.map(([value, label]) => (
							<DropdownMenuRadioItem key={value} value={String(value)}>
								{label}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					<label className="mt-1.5 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
						自訂
						<input
							type="number"
							min={40}
							max={400}
							value={widthMm}
							onKeyDown={(event) => event.stopPropagation()}
							onChange={(event) => {
								const next = Number(event.target.value);
								if (Number.isFinite(next) && next > 0) setWidthMm(next);
							}}
							className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-[0.7rem] text-foreground"
						/>
						mm
					</label>
				</div>

				<div className="mb-3">
					<p className="text-[0.65rem] text-muted-foreground mb-1.5">解析度</p>
					<DropdownMenuRadioGroup
						value={String(dpi)}
						onValueChange={(value) => setDpi(Number(value) as PublicationDpi)}
						aria-label="dpi"
					>
						{DPI_OPTIONS.map((value) => (
							<DropdownMenuRadioItem key={value} value={String(value)}>
								{value}dpi
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</div>

				{isSubgraph ? (
					<p className="mb-3 text-[0.65rem] leading-relaxed text-muted-foreground">
						子圖固定顯示完整標籤（規格：局部子圖是唯一允許全標籤的場合）。
					</p>
				) : (
					<div className="mb-3">
						<p className="text-[0.65rem] text-muted-foreground mb-1.5">標籤</p>
						<DropdownMenuRadioGroup
							value={labelMode}
							onValueChange={(value) => setLabelMode(value as PublicationLabelMode)}
							aria-label="標籤"
						>
							{LABEL_OPTIONS.map(([value, label]) => (
								<DropdownMenuRadioItem key={value} value={value}>
									{label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</div>
				)}

				{risky && (
					<div className="mb-2 space-y-1.5">
						<p className="text-[0.65rem] leading-relaxed text-destructive">
							{fullLabelBlockedMessage(effectiveNodeCount)}
							重疊的標籤會被自動省略，不會畫出疊字的圖；下載後會顯示實際放上幾個。
						</p>
						<DropdownMenuCheckboxItem
							checked={acknowledgeRisk}
							onCheckedChange={(checked) => setAcknowledgeRisk(checked)}
							className="text-[0.65rem] text-foreground"
						>
							我了解部分標籤可能被自動省略，仍要產生
						</DropdownMenuCheckboxItem>
					</div>
				)}

				<Button
					type="button"
					variant={canGenerate ? "default" : "outline"}
					size="sm"
					disabled={!canGenerate}
					onClick={() => {
						onGenerate({
							mode: figureMode,
							widthMm,
							dpi,
							labelMode,
							centerNodeId: isSubgraph ? (selectedNodeId ?? undefined) : undefined,
							hops: isSubgraph ? hops : undefined,
						});
						setOpen(false);
					}}
					className={`h-auto w-full gap-1.5 rounded-md py-1.5 text-xs ${
						!canGenerate
							? "cursor-not-allowed text-muted-foreground"
							: "cursor-pointer border-primary"
					}`}
				>
					<Download size={12} />
					產生並下載
				</Button>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
