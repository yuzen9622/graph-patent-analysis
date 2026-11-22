"use client";

import { Badge } from "@/components/ui/badge";

import { Card, CardContent } from "@/components/ui/card";

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
import { Progress } from "@/components/ui/progress";
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
					className="flex items-center gap-2"
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
			<Card className="relative"><CardContent>
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
							<Badge variant="secondary">
								<Sparkles className="size-2.5" />+{newNodesCount} 新節點
							</Badge>
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
							className="w-6"
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
							className="w-full"
							aria-label="縮時年份時間軸"
						/>
					</div>

					<div className="flex justify-between items-center text-[0.68rem] text-muted-foreground font-mono">
						<span>{minYear} 年</span>
						<div className="flex items-center gap-1">
							<Progress value={progressPercent} aria-label="縮時播放進度" className="w-20 sm:w-32" />
							<span className="text-[0.62rem] opacity-75">
								{Math.round(progressPercent)}%
							</span>
						</div>
						<span>{maxYear} 年</span>
					</div>
				</div>

				{/* Bottom Controls: Navigation buttons, Speed, Loop */}
				<div className="flex items-center justify-between gap-2 mt-2 pt-2">
					{/* Left: Playback transport buttons */}
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							variant="outline"
							size="icon-xs"
							onClick={onReset}
							title="重設回到起始年份"
							className="w-7"
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
							className="w-7"
						>
							<SkipBack className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant={isPlaying ? "secondary" : "default"}
							size="sm"
							onClick={onTogglePlay}
							title={isPlaying ? "暫停 (空白鍵)" : "播放縮時動畫 (空白鍵)"}
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
							className="w-7"
						>
							<SkipForward className="size-3.5" />
						</Button>
					</div>

					{/* Right: Speed controls & Loop toggle */}
					<div className="flex items-center gap-1.5">
						<Card><CardContent className="flex items-center">
							{SPEED_OPTIONS.map((opt) => (
								<Button variant={speed === opt.value ? "secondary" : "ghost"} aria-pressed={speed === opt.value}
									key={opt.value}
									type="button"
									onClick={() => onSpeedChange(opt.value)}
									title={`播放速度 ${opt.label}`}
								>
									{opt.label}
								</Button>
							))}
						</CardContent></Card>

						<Button
							type="button"
							variant={loop ? "secondary" : "ghost"}
							size="icon-xs"
							onClick={onToggleLoop}
							title={loop ? "已開啟循環播放" : "開啟循環播放"}
						>
							<Repeat className="size-3.5" />
						</Button>
					</div>
				</div>
			</CardContent></Card>
		</div>
	);
}
