// lib/concept-time.ts — PRD v2 / P3 概念時間
//
// 給每個概念節點算出時間元資料（first/last/median_year、year_counts），
// 並提供「依首次出現年份漸層著色」的純函式。全部純函式、可測、不碰 DOM/DB。
//
// 設計要點（docs/PRD-v2-P3-概念時間.md）：
//  - 母體 = 多重集合：每個有「有效年份」的專利各貢獻一個年份，重複必須保留。
//    不是 year_counts 的鍵集，否則中位數算錯（[2015,2020,2020,2020] → 2020）。
//  - 有效年份 = [1990, 今年+1]，與 P0 §3.1 的 date_out_of_range 門檻同源；
//    防止單筆髒資料把漸層窗綁架（B5）。
//  - 漸層映射 = sRGB 逐通道線性插值 + Math.round；7 個錨色為常數（B4）。
//  - GraphNode.color / concepts.color 永遠是社群色，漸層只活在 view 層（B1）。

import type { ConceptNetworkResult } from "./concept-network";
import { leaveOneOutMedianSpan, medianStandard, quartiles } from "./temporal";

/** rainbow：7 個錨色（紅橙黃綠藍靛紫，常數；方法圖例要印名稱）。
 * 2026-08-09 修訂：由 sequential_blue 9 錨改為彩虹 7 錨（老師指定），
 * 圖例由左（紅＝最早）至右（紫＝最近）。 */
export const RAINBOW_COLORS = [
	"#EF4444",
	"#F97316",
	"#EAB308",
	"#22C55E",
	"#3B82F6",
	"#4F46E5",
	"#8B5CF6",
] as const;

/** 年份未知概念 / 社群模式缺省的灰色。 */
export const UNKNOWN_YEAR_COLOR = "#BAB0AC";

export const VALID_YEAR_MIN = 1990;
export const VALID_YEAR_MAX = () => new Date().getFullYear() + 1;

/**
 * 申請年解析：取 filing_date 前 4 碼為整數年。純解析，不做值域過濾
 * （值域由 isValidYear 決定），與 graph-builder 共用同一實作（N3）。
 */
export function parseFilingYear(filingDate?: string): number | undefined {
	if (!filingDate) return undefined;
	const match = /^(\d{4})/.exec(filingDate);
	if (!match) return undefined;
	const year = Number(match[1]);
	return Number.isFinite(year) ? year : undefined;
}

/** 有效年份判準：[1990, 今年+1]，與 P0 §3.1 門檻同源（B5）。 */
export function isValidYear(year: number): boolean {
	return (
		Number.isInteger(year) && year >= VALID_YEAR_MIN && year <= VALID_YEAR_MAX()
	);
}

export interface ConceptYearStats {
	/** 首次有效申請年。 */
	first_year?: number;
	/** 最近有效申請年。 */
	last_year?: number;
	/** 第一／第三四分位數（nearest-rank，多重集合）。 */
	q1_year?: number;
	q3_year?: number;
	/** 中位有效申請年（標準 median，偶數篇取中間兩值平均）。 */
	median_year?: number;
	/** leave-one-out median 的可能範圍；v1 僅保存、不改箭頭。 */
	median_loo_min?: number;
	median_loo_max?: number;
	/** 年度分布 {year: count}；count = 該年不同專利數。 */
	year_counts?: Record<string, number>;
}

/**
 * 由合併後的概念網路 + 「專利 id → 申請年」計算每個概念的統計。
 * 母體為多重集合（相同申請年保留）；有效年份之外、無年份者不參與。
 */
export function computeConceptStats(
	conceptNetwork: ConceptNetworkResult,
	yearsByPatent: Map<string, number>,
): Map<string, ConceptYearStats> {
	const out = new Map<string, ConceptYearStats>();
	for (const [label, aggregate] of conceptNetwork.concepts) {
		const years: number[] = [];
		const counts = new Map<number, number>();
		for (const patentId of aggregate.source_patents) {
			const year = yearsByPatent.get(patentId);
			if (year === undefined || !isValidYear(year)) continue;
			years.push(year);
			counts.set(year, (counts.get(year) ?? 0) + 1);
		}
		if (years.length === 0) {
			out.set(label, {});
			continue;
		}
		const yearCounts: Record<string, number> = {};
		for (const [y, c] of counts) yearCounts[String(y)] = c;
		const qs = quartiles(years);
		const loo = leaveOneOutMedianSpan(years);
		out.set(label, {
			first_year: Math.min(...years),
			q1_year: qs.q1,
			median_year: medianStandard(years),
			q3_year: qs.q3,
			last_year: Math.max(...years),
			median_loo_min: loo?.min,
			median_loo_max: loo?.max,
			year_counts: yearCounts,
		});
	}
	return out;
}

/** 漸層窗 = 所有有 first_year 概念的最小/最大；無任何概念有年份 → null。 */
export function computeTimeWindow(
	stats: Map<string, ConceptYearStats>,
): [number, number] | null {
	let min = Infinity;
	let max = -Infinity;
	for (const stat of stats.values()) {
		if (stat.first_year === undefined) continue;
		if (stat.first_year < min) min = stat.first_year;
		if (stat.first_year > max) max = stat.first_year;
	}
	return Number.isFinite(min) ? [min, max] : null;
}

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
	];
}

/** sRGB 8-bit → 線性 sRGB（OKLab 轉換前置）。 */
function srgbToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** 線性 sRGB → sRGB 8-bit（clamp 後四捨五入）。 */
function linearToSrgb(v: number): number {
	const l = Math.min(1, Math.max(0, v));
	return Math.round(
		255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055),
	);
}

/** sRGB hex → OKLab（Björn Ottosson 2019；感知均勻，彩虹插值用）。 */
function hexToOklab(hex: string): [number, number, number] {
	const [r8, g8, b8] = hexToRgb(hex);
	const r = srgbToLinear(r8);
	const g = srgbToLinear(g8);
	const b = srgbToLinear(b8);
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
	const l1 = Math.cbrt(l);
	const m1 = Math.cbrt(m);
	const s1 = Math.cbrt(s);
	return [
		0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1,
		1.9779984951 * l1 - 2.428592205 * m1 + 0.4505937099 * s1,
		0.0259040371 * l1 + 0.7827717662 * m1 - 0.808675766 * s1,
	];
}

/** OKLab → sRGB hex。 */
function oklabToHex(L: number, a: number, b: number): string {
	const l1 = L + 0.3963377774 * a + 0.2158037573 * b;
	const m1 = L - 0.1055613458 * a - 0.0638541728 * b;
	const s1 = L - 0.0894841775 * a - 1.291485548 * b;
	const lm = l1 * l1 * l1;
	const mm = m1 * m1 * m1;
	const sm = s1 * s1 * s1;
	return rgbToHex([
		linearToSrgb(4.0767416621 * lm - 3.3077115913 * mm + 0.2309699292 * sm),
		linearToSrgb(-1.2684380046 * lm + 2.6097574011 * mm - 0.3413193965 * sm),
		linearToSrgb(-0.0041960863 * lm - 0.7034186147 * mm + 1.707614701 * sm),
	]);
}

function rgbToHex(rgb: [number, number, number]): string {
	return (
		"#" + rgb.map((c) => c.toString(16).padStart(2, "0").toUpperCase()).join("")
	);
}

/**
 * first_year → 色。插值在 OKLab（感知均勻）空間進行 + 四捨五入。
 * 2026-08-09 二次修訂：由 sRGB 逐通道插值改為 OKLab——sRGB 直線插值在彩虹上
 * 的中間色會變濁變暗（如黃→綠的濁綠），OKLab 讓漸變平滑無濁色。
 * window 為 null 或無年份 → 灰（UNKNOWN_YEAR_COLOR）。
 * 純函式：相同 t 兩次呼叫結果相同；t == 錨點座標時精確命中該錨色（B4）。
 */
export function gradientColor(
	firstYear: number | undefined,
	window: [number, number] | null,
): string {
	if (window === null || firstYear === undefined) return UNKNOWN_YEAR_COLOR;
	const n = RAINBOW_COLORS.length;
	const span = window[1] - window[0];
	const t =
		span > 0 ? Math.min(1, Math.max(0, (firstYear - window[0]) / span)) : 0;
	const pos = t * (n - 1);
	const lo = Math.floor(pos);
	const hi = Math.min(n - 1, lo + 1);
	const f = pos - lo;
	const a = hexToOklab(RAINBOW_COLORS[lo]!);
	const b = hexToOklab(RAINBOW_COLORS[hi]!);
	return oklabToHex(
		a[0] + (b[0] - a[0]) * f,
		a[1] + (b[1] - a[1]) * f,
		a[2] + (b[2] - a[2]) * f,
	);
}
