"use client";

import {
	ArrowLeftRight,
	GitCompare,
	Plus,
	TriangleAlert,
	X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
						<DialogTitle>
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
								className="shrink-0"
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
									className="shrink-0 disabled:pointer-events-auto"
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
							className="w-full gap-2"
						>
							<Plus size={16} />
							新增面板
						</Button>
					)}
				</div>

				<Alert role={distinct ? "status" : "alert"} variant={distinct ? "default" : "destructive"}>
					{!distinct && (
						<TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
					)}
					<AlertDescription>
						{distinct
							? `${panelCount} 個面板的有效範圍互異，可以開始比較。`
							: "兩個面板的來源相同。請調整其中一個面板的來源檔案。未勾選時會使用全部來源。"}
					</AlertDescription>
				</Alert>

				<DialogFooter className="flex-row flex-wrap items-center justify-start gap-2">
					<Button
						type="button"
						onClick={onStart}
						disabled={!distinct}
						className="gap-2"
					>
						<GitCompare size={16} />
						開始比較
					</Button>
					{panelCount === 2 && (
						<Button
							type="button"
							variant="outline"
							onClick={onSwap}
							className="gap-2"
						>
							<ArrowLeftRight size={16} />
							交換 A/B
						</Button>
					)}
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
					>
						取消
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
