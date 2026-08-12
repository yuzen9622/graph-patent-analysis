"use client";

import {
	ArrowLeftRight,
	GitCompare,
	Plus,
	TriangleAlert,
	X,
} from "lucide-react";
import SourceFileChecklist from "./Sidebar/SourceFileChecklist";
import { panelLabel, scopeLabel } from "@/lib/compare-export";
import { panelScopesDistinct } from "@/lib/graph-compare";

interface Props {
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
		<section
			aria-label="比較設定"
			className="absolute inset-0 z-20 flex items-start justify-center overflow-auto bg-background/95 p-6 backdrop-blur-sm"
		>
			<div className="w-full max-w-4xl rounded-lg border border-border bg-background p-5 shadow-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="font-serif text-base font-bold text-foreground">
							設定多面板比較
						</h2>
						<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
							每個面板各自選擇來源檔範圍（至少 2 個面板，最多 6
							個）。其餘篩選條件（年份、單位、著色、IPC…）各面板共用，只有來源檔不同。
						</p>
					</div>
					<button
						type="button"
						onClick={onCancel}
						aria-label="取消比較設定"
						className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<X size={16} />
					</button>
				</div>

				<div className="mt-4 grid gap-4 md:grid-cols-2">
					{panels.map((panel, index) => (
						<div key={index} className="rounded-md border border-border p-3">
							<div className="mb-2 flex items-center justify-between gap-2">
								<p className="text-sm font-medium text-foreground">
									{panelLabel(index, panelCount)}（面板 {index + 1}）來源
								</p>
								<button
									type="button"
									onClick={() => onRemovePanel(index)}
									disabled={panelCount <= 2}
									title={
										panelCount <= 2
											? "至少需要兩個面板"
											: `移除${panelLabel(index, panelCount)}`
									}
									aria-label={`移除${panelLabel(index, panelCount)}`}
									className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
								>
									<X size={14} />
								</button>
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
						<button
							type="button"
							onClick={onAddPanel}
							className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						>
							<Plus size={16} />
							新增面板
						</button>
					)}
				</div>

				<p
					role={distinct ? "status" : "alert"}
					className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
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

				<div className="mt-4 flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onStart}
						disabled={!distinct}
						className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<GitCompare size={16} />
						開始比較
					</button>
					{panelCount === 2 && (
						<button
							type="button"
							onClick={onSwap}
							className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						>
							<ArrowLeftRight size={16} />
							交換 A/B
						</button>
					)}
					<button
						type="button"
						onClick={onCancel}
						className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						取消
					</button>
				</div>
			</div>
		</section>
	);
}
