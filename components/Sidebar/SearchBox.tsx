"use client";

import { graphSwatch } from "@/lib/graph-swatch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Disc, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import presentation from "./sidebar.module.css";
import { Input } from "@/components/ui/input";
import type { GraphNode } from "@/types/graph";

interface Props {
	nodes: GraphNode[];
	onNodeFocus: (nodeId: string) => void;
	onNodeSelect: (node: GraphNode) => void;
	onEnterSubgraph?: (node: GraphNode) => void;
	onSearchKeyword?: (keyword: string) => void;
	placeholder?: string;
	className?: string;
}

export default function SearchBox({
	nodes,
	onNodeFocus,
	onNodeSelect,
	onEnterSubgraph,
	onSearchKeyword,
	placeholder = "搜尋概念、機構或專利",
	className = "",
}: Props) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const results = useMemo(
		() =>
			query.trim().length > 0
				? nodes
						.filter(
							(n) =>
								n.label.toLowerCase().includes(query.toLowerCase()) ||
								(n.title && n.title.toLowerCase().includes(query.toLowerCase())) ||
								(n.abstract &&
									n.abstract.toLowerCase().includes(query.toLowerCase())) ||
								(n.applicant &&
									n.applicant.toLowerCase().includes(query.toLowerCase())),
						)
						.slice(0, 25)
				: [],
		[nodes, query],
	);

	const handleSelectNode = useCallback(
		(node: GraphNode) => {
			onNodeFocus(node.id);
			onNodeSelect(node);
			setQuery(node.label);
			setOpen(false);
		},
		[onNodeFocus, onNodeSelect],
	);

	const handleTriggerKeywordSearch = useCallback(
		(kw: string) => {
			if (!kw.trim()) return;
			if (onSearchKeyword) {
				onSearchKeyword(kw.trim());
				setOpen(false);
			} else if (results.length > 0) {
				handleSelectNode(results[0]);
			}
		},
		[onSearchKeyword, results, handleSelectNode],
	);

	const clear = useCallback(() => {
		setQuery("");
		setOpen(false);
	}, []);

	/** Enter：若有 onSearchKeyword 直接生成該關鍵字的主題圖譜；Esc 關閉選單。 */
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter") {
				if (query.trim().length > 0) {
					e.preventDefault();
					handleTriggerKeywordSearch(query);
				}
			} else if (e.key === "Escape") {
				setOpen(false);
			}
		},
		[query, handleTriggerKeywordSearch],
	);

	// 全域快速鍵：按 "/" 或 "⌘K / Ctrl+K" 自動聚焦搜尋框
	useEffect(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			const isInputActive =
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable);

			if (
				(e.key === "/" && !isInputActive) ||
				((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
			) {
				e.preventDefault();
				inputRef.current?.focus();
				setOpen(true);
			}
		}
		window.addEventListener("keydown", handleGlobalKeyDown);
		return () => window.removeEventListener("keydown", handleGlobalKeyDown);
	}, []);

	useEffect(() => {
		function onClickOutside(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", onClickOutside);
		return () => document.removeEventListener("mousedown", onClickOutside);
	}, []);

	const TYPE_LABELS = { applicant: "機構", patent: "專利", concept: "技術概念" };

	return (
		<div ref={wrapperRef} className={`relative ${className}`}>
			<div className={presentation.searchField}>
				<Search
					size={14}
					className="shrink-0"
					aria-hidden
				/>
				<Input
					ref={inputRef}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					aria-label="搜尋技術關鍵字"
					autoComplete="off"
				/>
				<div className="flex shrink-0 items-center">
					{query ? (
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={clear}
							aria-label="清除搜尋"
						>
							<X size={12} />
						</Button>
					) : (
						<kbd className="hidden sm:inline-flex h-4 items-center gap-0.5 rounded border border-border bg-background px-1 font-mono text-[0.6rem] font-medium text-muted-foreground select-none pointer-events-none">
							/
						</kbd>
					)}
				</div>
			</div>

			{open && query.trim().length > 0 && (
				<Card className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto"><CardContent><ul aria-label="關鍵字搜尋結果" className="grid gap-2">
					{/* 首項：一鍵生成該關鍵字之完整主題圖譜 */}
					{onSearchKeyword && (
						<li><Button variant="outline" onClick={() => handleTriggerKeywordSearch(query)} className="w-full justify-start">
							<div className="flex items-center gap-2 min-w-0 flex-1">
								<Sparkles className="size-4 text-primary shrink-0" />
								<span className="truncate">
									生成「
									<strong className="underline underline-offset-2">
										{query.trim()}
									</strong>
									」主題技術圖譜
								</span>
							</div>
							<Badge variant="secondary">
								{results.length > 0
									? `含 ${results.length} 個相符概念`
									: "搜尋關聯脈絡"}{" "}
								· 按 Enter
							</Badge>
						</Button></li>
					)}

					{results.length > 0 && (
						<li
							className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground"
							aria-hidden
						>
							<span>相關概念與節點 ({results.length})</span>
							<span className="text-[0.65rem] text-muted-foreground">
								點擊定位 · 點 🎯 深入單項
							</span>
						</li>
					)}

					{results.map((node) => (
						<li key={node.id} className="flex items-center gap-1">
                            <Button variant="ghost" className="min-w-0 flex-1 justify-start" onClick={() => handleSelectNode(node)}>
								<span
									aria-hidden
									className="size-2.5 rounded-full shrink-0 bg-graph-swatch"
									style={graphSwatch(node.color)}
								/>
								<span className="text-foreground font-medium truncate">
									{node.label}
								</span>
								{node.frequency !== undefined && (
									<span className="text-[0.7rem] text-muted-foreground shrink-0 tabular-nums">
										({node.frequency} 篇)
									</span>
								)}
								{node.patent_count !== undefined && (
									<span className="text-[0.7rem] text-muted-foreground shrink-0 tabular-nums">
										({node.patent_count} 篇)
									</span>
								)}
							</Button>

							<div className="flex items-center gap-1.5 shrink-0">
								<Badge variant="secondary">
									{TYPE_LABELS[node.type]}
								</Badge>
								{onEnterSubgraph && (
									<Button
										variant="outline"
										size="xs"
										className="gap-1 shrink-0"
										title={`以此「${node.label}」為中心，深入局部圖譜`}
										aria-label={`以此「${node.label}」為中心，深入局部圖譜`}
										onClick={(e) => {
											e.stopPropagation();
											onEnterSubgraph(node);
											setQuery(node.label);
											setOpen(false);
										}}
									>
										<Disc className="size-3" />
										深入
									</Button>
								)}
							</div>
						</li>
					))}

					{results.length === 0 && (
						<li className="p-3 text-xs text-muted-foreground text-center">
							無完全符合的節點名稱，點擊上方或按 Enter 可直接以「{query.trim()}
							」檢索相關專利脈絡。
						</li>
					)}
				</ul></CardContent></Card>
			)}
		</div>
	);
}
