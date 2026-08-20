"use client";

import { useState } from "react";
import {
	Play,
	Pause,
	RotateCcw,
	SkipBack,
	SkipForward,
	Repeat,
	Sparkles,
	Clock,
	Maximize2,
	Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export interface FloatingTimelapseProps {
	yearRange: [number, number];
	fullYearRange: [number, number];
	onYearChange: (range: [number, number]) => void;
	isPlaying: boolean;
	onTogglePlay: () => void;
	speed: number;
	onSpeedChange: (speed: number) => void;
	loop: boolean;
	onToggleLoop: () => void;
	onReset: () => void;
	onStep: (direction: -1 | 1) => void;
	currentNodesCount: number;
	totalNodesCount: number;
	newNodesCount?: number;
	currentEdgesCount?: number;
}

const SPEED_OPTIONS = [
	{ label: "0.5x", value: 0.5 },
	{ label: "1x", value: 1 },
	{ label: "2x", value: 2 },
	{ label: "3x", value: 3 },
];

export default function FloatingTimelapse({
	yearRange,
	fullYearRange,
	onYearChange,
	isPlaying,
	onTogglePlay,
	speed,
	onSpeedChange,
	loop,
	onToggleLoop,
	onReset,
	onStep,
	currentNodesCount,
	totalNodesCount,
	newNodesCount = 0,
	currentEdgesCount,
}: FloatingTimelapseProps) {
	const [minYear, maxYear] = fullYearRange;
	const hasValidRange = minYear > 0 && maxYear > 0 && maxYear >= minYear;
	const [minimized, setMinimized] = useState(false);

	if (!hasValidRange) return null;

	const currentYear = yearRange[1];
	const isAtEnd = currentYear >= maxYear;
	const progressPercent = Math.max(
		0,
		Math.min(
			100,
			maxYear === minYear
				? 100
				: ((currentYear - minYear) / (maxYear - minYear)) * 100,
		),
	);

	const handleSliderChange = (vals: number | readonly number[]) => {
		const arr = Array.isArray(vals) ? vals : [vals];
		const selectedYear = arr[arr.length - 1];
		onYearChange([minYear, selectedYear]);
	};

	if (minimized) {
		return (
			<div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setMinimized(false)}
					className="flex items-center gap-2 rounded-full border border-border/80 bg-background/90 px-4 py-2 shadow-lg backdrop-blur-md hover:bg-background hover:border-primary/50 transition-all text-xs"
					title="展開縮時動畫播放器"
				>
					<div
						className={`size-2 rounded-full ${
							isPlaying ? "bg-primary animate-pulse" : "bg-muted-foreground"
						}`}
					/>
					<span className="font-semibold text-foreground font-mono">
						{currentYear} 年
					</span>
					<span className="text-muted-foreground text-[0.7rem]">
						({currentNodesCount}/{totalNodesCount} 節點)
					</span>
					<Maximize2 className="size-3 text-muted-foreground ml-1" />
				</Button>
			</div>
		);
	}

	return (
		<div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[94%] max-w-xl">
			<div className="relative rounded-xl border border-border/70 bg-background/90 p-3.5 shadow-2xl backdrop-blur-md transition-all">
				{/* Top Bar: Title, Year counter, Live emergence badge, and Minimize */}
				<div className="flex items-center justify-between gap-2 mb-2.5">
					<div className="flex items-center gap-2 min-w-0">
						<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold shrink-0">
							<Clock className="size-3.5" />
							<span>縮時演進</span>
						</div>
						<div className="flex items-baseline gap-1.5">
							<span className="text-lg font-bold font-mono tracking-tight text-foreground tabular-nums">
								{currentYear}
							</span>
							<span className="text-xs text-muted-foreground font-mono">年</span>
						</div>
						{newNodesCount > 0 && (
							<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.68rem] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 animate-in fade-in zoom-in-95 duration-200">
								<Sparkles className="size-2.5" />+{newNodesCount} 新節點
							</span>
						)}
					</div>

					<div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
						<span className="font-mono tabular-nums">
							累計{" "}
							<strong className="text-foreground font-semibold">
								{currentNodesCount}
							</strong>
							<span className="opacity-60">/{totalNodesCount}</span> 節點
							{currentEdgesCount !== undefined && (
								<span className="hidden sm:inline">
									{" "}
									·{" "}
									<strong className="text-foreground font-semibold">
										{currentEdgesCount}
									</strong>{" "}
									條邊
								</span>
							)}
						</span>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => setMinimized(true)}
							title="最小化播放列"
							className="text-muted-foreground hover:text-foreground h-6 w-6 rounded-md"
						>
							<Minimize2 className="size-3.5" />
						</Button>
					</div>
				</div>

				{/* Center: Interactive Scrubber / Slider */}
				<div className="space-y-1.5 px-1 py-1">
					<div className="relative flex items-center">
						<Slider
							min={minYear}
							max={maxYear}
							step={1}
							value={[currentYear]}
							onValueChange={handleSliderChange}
							className="w-full cursor-pointer"
							aria-label="縮時年份時間軸"
						/>
					</div>

					<div className="flex justify-between items-center text-[0.68rem] text-muted-foreground font-mono">
						<span>{minYear} 年</span>
						<div className="flex items-center gap-1">
							<div className="w-20 sm:w-32 h-1 bg-muted rounded-full overflow-hidden">
								<div
									className="h-full bg-primary transition-all duration-200"
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
							<span className="text-[0.62rem] opacity-75">
								{Math.round(progressPercent)}%
							</span>
						</div>
						<span>{maxYear} 年</span>
					</div>
				</div>

				{/* Bottom Controls: Navigation buttons, Speed, Loop */}
				<div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
					{/* Left: Playback transport buttons */}
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="outline"
							size="icon-xs"
							onClick={onReset}
							title="重設回到起始年份"
							className="h-7 w-7 rounded-md"
						>
							<RotateCcw className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon-xs"
							onClick={() => onStep(-1)}
							disabled={currentYear <= minYear}
							title="上一年 (←)"
							className="h-7 w-7 rounded-md"
						>
							<SkipBack className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant={isPlaying ? "secondary" : "default"}
							size="sm"
							onClick={onTogglePlay}
							title={isPlaying ? "暫停 (空白鍵)" : "播放縮時動畫 (空白鍵)"}
							className={`h-7 px-3 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all shadow-sm ${
								isPlaying
									? "bg-primary text-primary-foreground hover:bg-primary/90 ring-2 ring-primary/30 animate-pulse"
									: ""
							}`}
						>
							{isPlaying ? (
								<>
									<Pause className="size-3.5 fill-current" />
									<span>暫停</span>
								</>
							) : isAtEnd ? (
								<>
									<RotateCcw className="size-3.5" />
									<span>重播</span>
								</>
							) : (
								<>
									<Play className="size-3.5 fill-current" />
									<span>播放</span>
								</>
							)}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon-xs"
							onClick={() => onStep(1)}
							disabled={currentYear >= maxYear}
							title="下一年 (→)"
							className="h-7 w-7 rounded-md"
						>
							<SkipForward className="size-3.5" />
						</Button>
					</div>

					{/* Right: Speed controls & Loop toggle */}
					<div className="flex items-center gap-1.5">
						<div className="flex items-center rounded-md border border-border bg-background/60 p-0.5">
							{SPEED_OPTIONS.map((opt) => (
								<button
									key={opt.value}
									type="button"
									onClick={() => onSpeedChange(opt.value)}
									className={`px-1.5 py-0.5 text-[0.65rem] font-medium rounded transition-colors ${
										speed === opt.value
											? "bg-primary text-primary-foreground font-semibold shadow-xs"
											: "text-muted-foreground hover:text-foreground"
									}`}
									title={`播放速度 ${opt.label}`}
								>
									{opt.label}
								</button>
							))}
						</div>

						<Button
							type="button"
							variant={loop ? "secondary" : "ghost"}
							size="icon-xs"
							onClick={onToggleLoop}
							title={loop ? "已開啟循環播放" : "開啟循環播放"}
							className={`h-7 w-7 rounded-md ${
								loop
									? "bg-primary/15 text-primary hover:bg-primary/20"
									: "text-muted-foreground"
							}`}
						>
							<Repeat className="size-3.5" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
