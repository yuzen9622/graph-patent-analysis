/**
 * A/B 比較匯出（PNG 註記與離線 HTML）共用的文案、統計行與檔名規則。
 * 純字串組裝，讓瀏覽器端畫布與伺服器端 HTML 兩條路徑不會漂移。
 */
import { DEFAULT_IPC_LEVEL, type IpcLevel } from "./ipc-filter";
import {
	DIFF_COLORS,
	DIFF_LABELS,
	DIFF_MEMBERSHIPS,
	DIFF_SHAPE_LABELS,
	effectiveScope,
	type CompareCount,
	type CompareMetrics,
	type DiffMembership,
} from "./graph-compare";
import type { ColorMode, EdgeWeightMetric, Unit } from "./graph-view";
import type { GraphMode } from "../types/graph";

export const COMPARE_TITLE = "專利知識圖譜 A/B 比較";

export type CompareViewTab = "side-by-side" | "difference";

export const COMPARE_TAB_LABELS: Record<CompareViewTab, string> = {
	"side-by-side": "並排檢視",
	difference: "差異檢視",
};

/** A／B 範圍的顯示文字；空選擇＝全部來源檔。 */
export function scopeLabel(
	sourceFiles: readonly string[] | undefined,
	allSourceFiles: readonly string[],
): string {
	const scope = effectiveScope(sourceFiles, allSourceFiles);
	const all = Array.from(new Set(allSourceFiles));
	if (all.length === 0) return "（無來源檔）";
	if (scope.length === all.length) return `全部來源（${all.length} 檔）`;
	return scope.join("、");
}

const MODE_LABELS: Record<GraphMode, string> = {
	concept: "技術概念網路",
	context: "專利脈絡圖",
	institution: "機構網絡",
};

const COLOR_MODE_LABELS: Record<ColorMode, string> = {
	community: "社群",
	first_year: "首次出現年",
	community_applicants: "社群（家單位）",
	source: "來源檔",
	ipc: "IPC 分類",
};

export interface CommonFilterInput {
	mode: GraphMode;
	unit: Unit;
	colorMode: ColorMode;
	edgeWeight: EdgeWeightMetric;
	minSupport: number;
	yearRange: [number, number];
	ipcLevel?: IpcLevel;
	ipcFilter?: readonly string[];
	showCitations?: boolean;
}

/**
 * 共用篩選摘要：來源檔以外的條件左右兩側完全一致，這幾行就是「比較的前提」。
 */
export function commonFilterSummary(input: CommonFilterInput): string[] {
	const lines = [
		`圖譜模式：${MODE_LABELS[input.mode]}｜分析單位：${input.unit === "applicant" ? "家（機構）" : "篇（專利）"}`,
		`年份：${input.yearRange[0]}–${input.yearRange[1]}｜支持門檻：≥ ${input.minSupport}｜線寬指標：${input.edgeWeight === "npmi" ? "NPMI" : "Jaccard"}`,
		`節點著色：${COLOR_MODE_LABELS[input.colorMode]}｜引用虛線：${input.showCitations ? "顯示" : "隱藏"}`,
	];
	const ipcKeys = input.ipcFilter ?? [];
	if (ipcKeys.length > 0) {
		lines.push(
			`IPC 篩選（L${input.ipcLevel ?? DEFAULT_IPC_LEVEL}）：${ipcKeys.join("、")}`,
		);
	}
	return lines;
}

export function formatJaccard(value: number): string {
	return value.toFixed(3);
}

function metricLine(prefix: string, count: CompareCount): string {
	return `${prefix}：僅 A ${count.aOnly}｜僅 B ${count.bOnly}｜共有 ${count.shared}｜聯集 ${count.union}｜Jaccard ${formatJaccard(count.jaccard)}`;
}

/** 匯出檔要印的指標行（節點一行、邊一行）。 */
export function compareMetricLines(metrics: CompareMetrics): string[] {
	return [
		metricLine("節點", metrics.nodes),
		metricLine("關係邊", metrics.edges),
	];
}

export interface CompareLegendItem {
	membership: DiffMembership;
	color: string;
	label: string;
	encoding: string;
}

/** 差異圖圖例：顏色以外一律附上形狀／線型說明（冗餘編碼）。 */
export function compareLegendItems(): CompareLegendItem[] {
	return DIFF_MEMBERSHIPS.map((membership) => ({
		membership,
		color: DIFF_COLORS[membership],
		label: DIFF_LABELS[membership],
		encoding: DIFF_SHAPE_LABELS[membership],
	}));
}

export interface CompareAnnotationInput extends CommonFilterInput {
	aLabel: string;
	bLabel: string;
	metrics: CompareMetrics;
	tab: CompareViewTab;
}

/**
 * PNG 註記與離線 HTML 標頭共用的整份說明文字（標題另計）。
 */
export function compareAnnotationLines(
	input: CompareAnnotationInput,
): string[] {
	return [
		`A（左）：${input.aLabel}`,
		`B（右）：${input.bLabel}`,
		`檢視：${COMPARE_TAB_LABELS[input.tab]}｜共用篩選如下`,
		...commonFilterSummary(input),
		...compareMetricLines(input.metrics),
		`圖例：${compareLegendItems()
			.map((item) => `${item.label}（${item.encoding}）`)
			.join("｜")}`,
	];
}

function datePart(now: Date): string {
	return [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("");
}

/** 比較匯出檔名；jobId 只取前 8 碼，與既有單圖匯出的慣例一致。 */
export function compareExportFilename(
	jobId: string,
	extension: "png" | "html",
	tab: CompareViewTab,
	now = new Date(),
): string {
	const tabPart = tab === "difference" ? "diff" : "side";
	const idPart = jobId.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 8) || "graph";
	return `patent-graph-compare-${tabPart}-${idPart}-${datePart(now)}.${extension}`;
}
