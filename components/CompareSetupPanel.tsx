"use client";

import { ArrowLeftRight, GitCompare, TriangleAlert, X } from "lucide-react";
import SourceFileChecklist from "./Sidebar/SourceFileChecklist";
import { scopeLabel } from "@/lib/compare-export";
import { scopesEqual } from "@/lib/graph-compare";

interface Props {
	allSourceFiles: string[];
	left: string[];
	right: string[];
	onLeftChange: (files: string[]) => void;
	onRightChange: (files: string[]) => void;
	onSwap: () => void;
	onCancel: () => void;
	onStart: () => void;
}

export default function CompareSetupPanel({
	allSourceFiles,
	left,
	right,
	onLeftChange,
	onRightChange,
	onSwap,
	onCancel,
	onStart,
}: Props) {
	const sameScope = scopesEqual(left, right, allSourceFiles);

	return (
		<section
			aria-label="比較設定"
			className="absolute inset-0 z-20 flex items-start justify-center overflow-auto bg-background/95 p-6 backdrop-blur-sm"
		>
			<div className="w-full max-w-3xl rounded-lg border border-border bg-background p-5 shadow-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="font-serif text-base font-bold text-foreground">
							設定 A/B 比較
						</h2>
						<p className="mt-1 text-xs text-muted-foreground leading-relaxed">
							選擇 A、B
							兩側各自的來源檔範圍。其餘篩選條件（年份、單位、著色、IPC…）兩側共用，只有來源檔不同。
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
					<div className="rounded-md border border-border p-3">
						<SourceFileChecklist
							label="A（左圖）來源"
							allSourceFiles={allSourceFiles}
							sourceFiles={left}
							onChange={onLeftChange}
						/>
						<p className="mt-2 text-[0.65rem] text-muted-foreground">
							有效範圍：{scopeLabel(left, allSourceFiles)}
						</p>
					</div>
					<div className="rounded-md border border-border p-3">
						<SourceFileChecklist
							label="B（右圖）來源"
							allSourceFiles={allSourceFiles}
							sourceFiles={right}
							onChange={onRightChange}
						/>
						<p className="mt-2 text-[0.65rem] text-muted-foreground">
							有效範圍：{scopeLabel(right, allSourceFiles)}
						</p>
					</div>
				</div>

				<p
					role={sameScope ? "alert" : "status"}
					className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
						sameScope
							? "border-destructive/40 bg-destructive/5 text-destructive"
							: "border-border bg-accent/40 text-muted-foreground"
					}`}
				>
					{sameScope && (
						<TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
					)}
					<span>
						{sameScope
							? "A、B 的有效範圍相同（未勾選＝全部來源），沒有東西可比。請至少讓一側不同。"
							: "兩側範圍不同，可以開始比較。"}
					</span>
				</p>

				<div className="mt-4 flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onStart}
						disabled={sameScope}
						className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<GitCompare size={16} />
						開始比較
					</button>
					<button
						type="button"
						onClick={onSwap}
						className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						<ArrowLeftRight size={16} />
						交換 A/B
					</button>
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
