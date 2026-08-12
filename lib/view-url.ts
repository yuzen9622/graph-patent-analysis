/**
 * PRD v2 / P3 (N6): view-state ⇄ URL serialisation.
 *
 * The analysis viewer mirrors its view state into the page URL with
 * `history.replaceState` so a shared link restores the exact view — including
 * the P3 gradient colour mode (`colorMode`). Both directions are kept pure
 * here so they are unit-testable (the repo's convention is pure-logic tests;
 * there is no component test harness in this project).
 */
import type { CompareViewTab } from "./compare-export";
import type { ColorMode, EdgeWeightMetric, Unit } from "./graph-view";
import { DEFAULT_IPC_LEVEL, type IpcLevel } from "./ipc-filter";
import type { GraphMode } from "../types/graph";

export interface ViewState {
	mode: GraphMode;
	showSemantic: boolean;
	paperMode: boolean;
	colorMode: ColorMode;
	minSupport: number;
	yearRange: [number, number];
	/** PRD v2 / P4: 線寬指標（缺省 jaccard，不掛在 URL 進位位）。 */
	edgeWeight?: EdgeWeightMetric;
	/** PRD v2 / P4 (Q3): 分析單位（缺省 patent，不掛 URL）。 */
	unit?: Unit;
	/** PRD v2 / P2: 來源檔篩選（多檔比對）。空＝不篩；非空以其子集重推導。 */
	sourceFiles?: string[];
	/** PRD v2 / P5: IPC 層級（缺省 3，不掛 URL）。 */
	ipcLevel?: IpcLevel;
	/** PRD v2 / P5: 選定層級的 IPC key（多值；空＝不篩）。 */
	ipcFilter?: string[];
	/** P6 temporal median reference (active analysis scope is the default). */
	temporalReference?: "active" | "full";
	/** P6 citation-only evidence layer. */
	showCitations?: boolean;
	/** A/B 比較工作區是否啟用；舊連結沒有這個參數，行為不變。 */
	compare?: boolean;
	/** 比較工作區的分頁（缺省並排，不掛 URL）。 */
	compareView?: CompareViewTab;
	/** B（右）側的來源檔範圍；空＝全部來源。 */
	sourceFilesRight?: string[];
}

const isMode = (value: string | null): value is GraphMode =>
	value === "concept" || value === "context" || value === "institution";

const isColorMode = (value: string | null): value is ColorMode =>
	value === "community" ||
	value === "first_year" ||
	value === "community_applicants" ||
	value === "source" ||
	value === "ipc";

const isEdgeWeight = (value: string | null): value is EdgeWeightMetric =>
	value === "jaccard" || value === "npmi";

const isUnit = (value: string | null): value is Unit =>
	value === "patent" || value === "applicant";

/**
 * Parse a URL query (pass `window.location.search`, including a leading `?`).
 * Returns only the fields that are valid; absent / malformed values are left
 * undefined so callers fall back to their defaults.
 */
export function parseViewQuery(search: string): Partial<ViewState> {
	const p = new URLSearchParams(search);
	const out: Partial<ViewState> = {};

	const mode = p.get("mode");
	if (isMode(mode)) out.mode = mode;

	const colorMode = p.get("colorMode");
	if (isColorMode(colorMode)) out.colorMode = colorMode;

	const edgeWeight = p.get("ew");
	if (isEdgeWeight(edgeWeight)) out.edgeWeight = edgeWeight;

	const unit = p.get("unit");
	if (isUnit(unit)) out.unit = unit;

	// PRD v2 / P2: 來源檔可重複（多檔）。空／缺省＝不篩。
	const sources = p.getAll("source").filter(Boolean);
	if (sources.length > 0) out.sourceFiles = sources;

	// PRD v2 / P5: IPC 層級與篩選（多值）。非法層級忽略（缺省 3）。
	const levelRaw = p.get("ipcLevel");
	const level = Number(levelRaw);
	if (
		levelRaw !== null &&
		Number.isInteger(level) &&
		level >= 1 &&
		level <= 5
	) {
		out.ipcLevel = level as IpcLevel;
	}
	const ipcKeys = p.getAll("ipc").filter(Boolean);
	if (ipcKeys.length > 0) out.ipcFilter = ipcKeys;

	// A/B 比較：三個參數都缺省不掛，所以舊連結解析結果完全不變。
	const compare = p.get("compare");
	if (compare === "1") out.compare = true;
	else if (compare === "0") out.compare = false;
	const compareView = p.get("compareView");
	if (compareView === "difference" || compareView === "side-by-side") {
		out.compareView = compareView;
	}
	const rightSources = p.getAll("rsource").filter(Boolean);
	if (rightSources.length > 0) out.sourceFilesRight = rightSources;

	const temporalReference = p.get("temporal_ref");
	if (temporalReference === "active" || temporalReference === "full")
		out.temporalReference = temporalReference;
	const citations = p.get("citations");
	if (citations === "1") out.showCitations = true;
	else if (citations === "0") out.showCitations = false;

	const llm = p.get("llm");
	if (llm === "1") out.showSemantic = true;
	else if (llm === "0") out.showSemantic = false;

	const minSupport = Number(p.get("minSupport"));
	if (Number.isInteger(minSupport) && minSupport >= 1)
		out.minSupport = minSupport;

	const paper = p.get("paper");
	if (paper === "1") out.paperMode = true;
	else if (paper === "0") out.paperMode = false;

	// Number(null) is 0, so guard on the raw value before coercing: an ABSENT
	// year parameter must not be read as year 0.
	const startRaw = p.get("yearStart");
	const endRaw = p.get("yearEnd");
	const start = startRaw === null ? NaN : Number(startRaw);
	const end = endRaw === null ? NaN : Number(endRaw);
	if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
		out.yearRange = [start, end];
	}

	return out;
}

/** Serialise the full view state into a URLSearchParams query string. */
export function toViewQueryString(state: ViewState): string {
	const params: Record<string, string> = {
		mode: state.mode,
		llm: state.showSemantic ? "1" : "0",
		paper: state.paperMode ? "1" : "0",
		colorMode: state.colorMode,
		minSupport: String(state.minSupport),
		yearStart: String(state.yearRange[0]),
		yearEnd: String(state.yearRange[1]),
	};
	if (state.edgeWeight && state.edgeWeight !== "jaccard") {
		params["ew"] = state.edgeWeight;
	}
	if (state.unit && state.unit !== "patent") {
		params["unit"] = state.unit;
	}
	if (state.compare) params["compare"] = "1";
	if (state.compare && state.compareView === "difference")
		params["compareView"] = "difference";
	if (state.temporalReference === "full") params["temporal_ref"] = "full";
	if (state.showCitations) params["citations"] = "1";
	if (state.ipcLevel && state.ipcLevel !== DEFAULT_IPC_LEVEL) {
		params["ipcLevel"] = String(state.ipcLevel);
	}
	const searchParams = new URLSearchParams(params);
	for (const source of state.sourceFiles ?? [])
		searchParams.append("source", source);
	if (state.compare) {
		for (const source of state.sourceFilesRight ?? [])
			searchParams.append("rsource", source);
	}
	for (const key of state.ipcFilter ?? []) searchParams.append("ipc", key);
	return searchParams.toString();
}
