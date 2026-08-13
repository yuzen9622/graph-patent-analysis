"use client";

import {
	ArrowLeftRight,
	GitCompare,
	Plus,
	TriangleAlert,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import SourceFileChecklist from "./Sidebar/SourceFileChecklist";
import { panelLabel, scopeLabel } from "@/lib/compare-export";
import { panelScopesDistinct } from "@/lib/graph-compare";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	allSourceFiles: string[];
	/** 每個面板的來源檔範圍；長度 2..6。 */
	panels: string[][];
	onPanelsChange: (panels: string[][]) => void;
	onSwap: () => void;
	onCancel: () => void;
	onStart: () => void;
	onAddPanel: () => void;
	onRemovePanel: (index: number) => void;
}

export default function CompareSetupPanel({
	open,
	onOpenChange,
	allSourceFiles,
	panels,
	onPanelsChange,
	onSwap,
	onCancel,
	onStart,
	onAddPanel,
	onRemovePanel,
}: Props) {
	const distinct = panelScopesDistinct(panels, allSourceFiles);
	const panelCount = panels.length;
	const canAdd = panelCount < 6;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="max-w-4xl sm:max-w-4xl max-h-[85svh] overflow-y-auto"
			>
				<DialogHeader className="flex-row items-start justify-between gap-3">
					<div>
						<DialogTitle className="font-serif text-base font-bold text-foreground">
							設定多面板比較
						</DialogTitle>
						<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
							每個面板各自選擇來源檔範圍（至少 2 個面板，最多 6
							個）。其餘篩選條件（年份、單位、著色、IPC…）各面板共用，只有來源檔不同。
						</p>
					</div>
					<DialogClose
						render={
							<Button
								type="button"
								variant="outline"
								size="icon-lg"
								aria-label="取消比較設定"
								className="size-11 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
							/>
						}
					>
						<X size={16} />
					</DialogClose>
				</DialogHeader>

				<div className="grid gap-4 md:grid-cols-2">
					{panels.map((panel, index) => (
						<div key={index} className="rounded-md border border-border p-3">
							<div className="mb-2 flex items-center justify-between gap-2">
								<p className="text-sm font-medium text-foreground">
									{panelLabel(index, panelCount)}（面板 {index + 1}）來源
								</p>
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									onClick={() => onRemovePanel(index)}
									disabled={panelCount <= 2}
									title={
										panelCount <= 2
											? "至少需要兩個面板"
											: `移除${panelLabel(index, panelCount)}`
									}
									aria-label={`移除${panelLabel(index, panelCount)}`}
									className="shrink-0 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-40"
								>
									<X size={14} />
								</Button>
							</div>
							<SourceFileChecklist
								allSourceFiles={allSourceFiles}
								sourceFiles={panel}
								onChange={(next) => {
									const nextPanels = [...panels];
									nextPanels[index] = next;
									onPanelsChange(nextPanels);
								}}
							/>
							<p className="mt-2 text-[0.65rem] text-muted-foreground">
								有效範圍：{scopeLabel(panel, allSourceFiles)}
							</p>
						</div>
					))}
					{canAdd && (
						<Button
							type="button"
							variant="outline"
							onClick={onAddPanel}
							className="h-auto min-h-24 w-full gap-2 rounded-md border-dashed text-sm text-muted-foreground hover:border-primary hover:text-foreground"
						>
							<Plus size={16} />
							新增面板
						</Button>
					)}
				</div>

				<p
					role={distinct ? "status" : "alert"}
					className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
						distinct
							? "border-border bg-accent/40 text-muted-foreground"
							: "border-destructive/40 bg-destructive/5 text-destructive"
					}`}
				>
					{!distinct && (
						<TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
					)}
					<span>
						{distinct
							? `${panelCount} 個面板的有效範圍互異，可以開始比較。`
							: "有兩個面板的有效範圍相同（未勾選＝全部來源），沒有東西可比。請讓每個面板的範圍互異。"}
					</span>
				</p>

				<DialogFooter className="flex-row flex-wrap items-center justify-start gap-2">
					<Button
						type="button"
						onClick={onStart}
						disabled={!distinct}
						className="h-auto min-h-11 gap-2 rounded-md px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
					>
						<GitCompare size={16} />
						開始比較
					</Button>
					{panelCount === 2 && (
						<Button
							type="button"
							variant="outline"
							onClick={onSwap}
							className="h-auto min-h-11 gap-2 rounded-md px-4 text-sm hover:bg-accent"
						>
							<ArrowLeftRight size={16} />
							交換 A/B
						</Button>
					)}
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						className="h-auto min-h-11 rounded-md px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						取消
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
