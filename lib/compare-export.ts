/**
 * N 面板比較匯出（PNG 註記與離線 HTML）共用的文案、統計行與檔名規則。
 * 純字串組裝，讓瀏覽器端畫布與伺服器端 HTML 兩條路徑不會漂移。
 *
 * 兩面板沿用 A／B 語意（文案逐字與舊版相同）；三面板以上改用
 * 「僅 1 組…僅 N 組＋聯集＋共有比例」的層級表述。
 */
import { DEFAULT_IPC_LEVEL, type IpcLevel } from "./ipc-filter";
import {
	DIFF_COLORS,
	DIFF_LABELS,
	DIFF_SHAPE_LABELS,
	diffMemberships,
	effectiveScope,
	type CompareCount,
	type CompareMetrics,
	type DiffMembership,
} from "./graph-compare";
import type { ColorMode, EdgeWeightMetric, Unit } from "./graph-view";
import type { GraphMode } from "../types/graph";

export const COMPARE_TITLE = "專利知識圖譜比較";

export type CompareViewTab = "side-by-side" | "difference";

export const COMPARE_TAB_LABELS: Record<CompareViewTab, string> = {
	"side-by-side": "並排檢視",
	difference: "差異檢視",
};

/** 面板的顯示名稱：兩面板沿用 A／B，三面板以上用「面板 N」。 */
export function panelLabel(index: number, panelCount: number): string {
	if (panelCount <= 2) return index === 0 ? "A" : "B";
	return `面板 ${index + 1}`;
}

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
 * 共用篩選摘要：來源檔以外的條件各面板完全一致，這幾行就是「比較的前提」。
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
	const panelCount = count.counts.length;
	if (panelCount <= 2) {
		// 兩面板：與舊版 A/B 文案逐字相同。
		return `${prefix}：僅 A ${count.aOnly ?? 0}｜僅 B ${count.bOnly ?? 0}｜共有 ${count.counts[1] ?? 0}｜聯集 ${count.union}｜Jaccard ${formatJaccard(count.jaccard)}`;
	}
	const layers = count.counts
		.map((value, index) => `僅 ${index + 1} 組 ${value}`)
		.join("｜");
	return `${prefix}：${layers}｜聯集 ${count.union}｜共有比例 ${formatJaccard(count.jaccard)}`;
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
export function compareLegendItems(panelCount: number): CompareLegendItem[] {
	return diffMemberships(panelCount).map((membership) => ({
		membership,
		color: DIFF_COLORS[membership],
		label: diffMembershipLabels(panelCount)[membership],
		encoding: DIFF_SHAPE_LABELS[membership],
	}));
}

/** 依面板數產生各歸屬的顯示文字（shared 在三面板以上帶面板數）。 */
export function diffMembershipLabels(
	panelCount: number,
): Record<DiffMembership, string> {
	const labels = { ...DIFF_LABELS };
	if (panelCount > 2) labels.shared = `全部 ${panelCount} 組共有`;
	return labels;
}

export interface CompareAnnotationInput extends CommonFilterInput {
	/** 每個面板的範圍標籤（scopeLabel 輸出），長度＝面板數。 */
	labels: string[];
	metrics: CompareMetrics;
	tab: CompareViewTab;
}

/**
 * PNG 註記與離線 HTML 標頭共用的整份說明文字（標題另計）。
 */
export function compareAnnotationLines(
	input: CompareAnnotationInput,
): string[] {
	const panelCount = input.labels.length;
	const scopeLines =
		panelCount <= 2
			? [
					`A（左）：${input.labels[0] ?? ""}`,
					`B（右）：${input.labels[1] ?? ""}`,
				]
			: input.labels.map((label, index) => `面板 ${index + 1}：${label}`);
	return [
		...scopeLines,
		`檢視：${COMPARE_TAB_LABELS[input.tab]}｜共用篩選如下`,
		...commonFilterSummary(input),
		...compareMetricLines(input.metrics),
		`圖例：${compareLegendItems(panelCount)
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
