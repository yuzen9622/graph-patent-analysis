"use client";

import { Button } from "@/components/ui/button";
import { SOURCE_FILE_COLORS } from "@/lib/graph-view";

interface Props {
	/** 比較模式下區分左／右圖；單一檢視時省略。 */
	label?: string;
	allSourceFiles: string[];
	sourceFiles: string[];
	onChange: (files: string[]) => void;
}

export default function SourceFileChecklist({
	label,
	allSourceFiles,
	sourceFiles,
	onChange,
}: Props) {
	return (
		<div>
			{label && (
				<p className="text-[0.7rem] font-medium text-foreground mb-1.5">
					{label}
				</p>
			)}
			<div className="flex flex-col gap-1.5">
				{allSourceFiles.map((file, i) => {
					const active = sourceFiles.includes(file);
					return (
						<label
							key={file}
							className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer transition-colors ${
								active
									? "border-primary bg-primary/5"
									: "border-border bg-background"
							}`}
						>
							<input
								type="checkbox"
								checked={active}
								onChange={(event) => {
									const next = event.target.checked
										? [...sourceFiles, file]
										: sourceFiles.filter((f) => f !== file);
									onChange(next);
								}}
								className="mt-0.5"
							/>
							<span className="inline-flex items-center gap-1.5 min-w-0">
								<span
									aria-hidden
									className="size-2.5 shrink-0 rounded-full"
									style={{
										background:
											SOURCE_FILE_COLORS[i % SOURCE_FILE_COLORS.length],
									}}
								/>
								<span className="truncate">{file}</span>
							</span>
						</label>
					);
				})}
			</div>
			<div className="mt-2 flex gap-1.5">
				<Button
					type="button"
					variant="outline"
					size="xs"
					onClick={() => onChange([])}
					aria-pressed={sourceFiles.length === 0}
					className="h-auto rounded px-2 py-1 text-[0.65rem] text-muted-foreground hover:bg-accent"
				>
					全部來源
				</Button>
				<p className="text-[0.65rem] text-muted-foreground self-center">
					{sourceFiles.length === 0
						? "未篩選（顯示全圖）"
						: `篩選 ${sourceFiles.length} 個檔（任一來源命中即保留）`}
				</p>
			</div>
		</div>
	);
}
