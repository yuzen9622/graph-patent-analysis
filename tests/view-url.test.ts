import { describe, expect, it } from "vitest";
import {
	parseViewQuery,
	toViewQueryString,
	type ViewState,
} from "../lib/view-url";

const FULL: ViewState = {
	mode: "concept",
	showSemantic: true,
	paperMode: false,
	colorMode: "first_year",
	minSupport: 3,
	yearRange: [2010, 2020],
};

describe("toViewQueryString", () => {
	it("完整 view state 可被序列化，colorMode/minSupport/年份俱在", () => {
		const q = toViewQueryString(FULL);
		expect(q).toContain("mode=concept");
		expect(q).toContain("colorMode=first_year");
		expect(q).toContain("minSupport=3");
		expect(q).toContain("yearStart=2010");
		expect(q).toContain("yearEnd=2020");
		expect(q).toContain("llm=1");
	});
});

describe("parseViewQuery 與 toViewQueryString 互逆", () => {
	it("serialize → parse 再回原 view state", () => {
		const parsed = parseViewQuery(`?${toViewQueryString(FULL)}`);
		expect(parsed).toEqual(FULL);
	});
	it("可解析含前導 ? 的完整查詢字串", () => {
		expect(
			parseViewQuery(
				"?mode=context&colorMode=first_year&llm=0&minSupport=2&yearStart=2007&yearEnd=2025&paper=1",
			),
		).toEqual({
			mode: "context",
			showSemantic: false,
			colorMode: "first_year",
			minSupport: 2,
			yearRange: [2007, 2025],
			paperMode: true,
		});
	});
});

describe("parseViewQuery 容錯", () => {
	it("空字串／無關參數 → 空白", () => {
		expect(parseViewQuery("")).toEqual({});
		expect(parseViewQuery("?foo=bar")).toEqual({});
	});
	it("無效 mode／colorMode 不套用", () => {
		expect(parseViewQuery("?mode=banana")).toEqual({});
		expect(parseViewQuery("?colorMode=bubbles")).toEqual({});
		expect(parseViewQuery("?mode=context&colorMode=nope")).toEqual({
			mode: "context",
		});
	});
	it("minSupport 需 ≥1 的整數（0/負/小數/非數字不套用）", () => {
		expect(parseViewQuery("?minSupport=0")).toEqual({});
		expect(parseViewQuery("?minSupport=-3")).toEqual({});
		expect(parseViewQuery("?minSupport=1.5")).toEqual({});
		expect(parseViewQuery("?minSupport=abc")).toEqual({});
		expect(parseViewQuery("?minSupport=4")).toEqual({ minSupport: 4 });
	});
	it("yearRange 需兩有限數字且 start ≤ end（逆序不套用）", () => {
		expect(parseViewQuery("?yearStart=2025&yearEnd=2020")).toEqual({});
		expect(parseViewQuery("?yearStart=x&yearEnd=2020")).toEqual({});
		expect(parseViewQuery("?yearStart=2020&yearEnd=2025")).toEqual({
			yearRange: [2020, 2025],
		});
	});
	it("llm／paper 只接受明確 1／0", () => {
		expect(parseViewQuery("?llm=yes")).toEqual({});
		expect(parseViewQuery("?llm=1")).toEqual({ showSemantic: true });
		expect(parseViewQuery("?paper=1")).toEqual({ paperMode: true });
	});
});
describe("edgeWeight（線寬指標）", () => {
	it("缺省 jaccard 不掛 URL；npmi 掛 ew=NPMI 並可 round-trip", () => {
		const base = toViewQueryString({
			...fullDefaults(),
			edgeWeight: "jaccard",
		});
		expect(base).not.toContain("ew=");
		const withNpmi = toViewQueryString({
			...fullDefaults(),
			edgeWeight: "npmi",
		});
		expect(withNpmi).toContain("ew=npmi");
		const parsed = parseViewQuery(`?${withNpmi}`);
		expect(parsed.edgeWeight).toBe("npmi");
	});
	it("無效 edgeWeight 不套用", () => {
		expect(parseViewQuery("?ew=weight")).toEqual({});
	});
});

function fullDefaults(): import("./../lib/view-url").ViewState {
	return {
		mode: "concept",
		showSemantic: false,
		paperMode: true,
		colorMode: "community",
		minSupport: 2,
		yearRange: [2007, 2025],
	};
}

describe("unit（分析單位）", () => {
	it("缺省 patent 不掛 URL；applicant 掛 unit=applicant 並可 round-trip", () => {
		const base = toViewQueryString({ ...fullDefaults(), unit: "patent" });
		expect(base).not.toContain("unit=");
		const withApp = toViewQueryString({ ...fullDefaults(), unit: "applicant" });
		expect(withApp).toContain("unit=applicant");
		expect(parseViewQuery(`?${withApp}`).unit).toBe("applicant");
	});
	it("無效 unit 不套用", () => {
		expect(parseViewQuery("?unit=family")).toEqual({});
	});
});
describe("P2 來源檔（source= 多值）", () => {
	it("選定的來源檔 round-trip；未選不掛 URL", () => {
		const withSrc = toViewQueryString({
			...fullDefaults(),
			sourceFiles: ["fileA", "fileB"],
		});
		expect(withSrc).toContain("source=fileA");
		expect(withSrc).toContain("source=fileB");
		expect(parseViewQuery(`?${withSrc}`).sourceFiles).toEqual([
			"fileA",
			"fileB",
		]);
		const none = toViewQueryString(fullDefaults());
		expect(none).not.toContain("source=");
	});
});
describe("P6 temporal reference / citation layer", () => {
	it("full-history reference and visible citation layer round-trip", () => {
		const q = toViewQueryString({
			...fullDefaults(),
			temporalReference: "full",
			showCitations: true,
		});
		expect(q).toContain("temporal_ref=full");
		expect(q).toContain("citations=1");
		expect(parseViewQuery(`?${q}`)).toMatchObject({
			temporalReference: "full",
			showCitations: true,
		});
	});
	it("active reference and hidden citations remain URL defaults", () => {
		const q = toViewQueryString({
			...fullDefaults(),
			temporalReference: "active",
			showCitations: false,
		});
		expect(q).not.toContain("temporal_ref=");
		expect(q).not.toContain("citations=");
	});
});

describe("A/B 比較（compare / compareView / rsource）", () => {
	it("比較狀態 round-trip：模式、分頁與右側來源檔", () => {
		const q = toViewQueryString({
			...fullDefaults(),
			sourceFiles: ["a.xlsx"],
			compare: true,
			compareView: "difference",
			sourceFilesRight: ["b.xlsx", "c.xlsx"],
		});
		expect(q).toContain("compare=1");
		expect(q).toContain("compareView=difference");
		expect(q).toContain("rsource=b.xlsx");
		expect(q).toContain("rsource=c.xlsx");
		const parsed = parseViewQuery(`?${q}`);
		expect(parsed.compare).toBe(true);
		expect(parsed.compareView).toBe("difference");
		expect(parsed.sourceFiles).toEqual(["a.xlsx"]);
		expect(parsed.sourceFilesRight).toEqual(["b.xlsx", "c.xlsx"]);
	});

	it("並排是缺省分頁，不掛 URL", () => {
		const q = toViewQueryString({
			...fullDefaults(),
			compare: true,
			compareView: "side-by-side",
			sourceFilesRight: ["b.xlsx"],
		});
		expect(q).toContain("compare=1");
		expect(q).not.toContain("compareView=");
		expect(parseViewQuery(`?${q}`).compareView).toBeUndefined();
	});

	it("未啟用比較時三個參數都不掛（舊連結行為不變）", () => {
		const q = toViewQueryString({
			...fullDefaults(),
			compare: false,
			compareView: "difference",
			sourceFilesRight: ["b.xlsx"],
		});
		expect(q).not.toContain("compare=");
		expect(q).not.toContain("compareView=");
		expect(q).not.toContain("rsource=");
		expect(parseViewQuery(`?${q}`)).toEqual(fullDefaults());
	});

	it("舊 URL（沒有 compare 參數）解析結果不含比較欄位", () => {
		const parsed = parseViewQuery("?mode=concept&source=a.xlsx");
		expect(parsed).toEqual({ mode: "concept", sourceFiles: ["a.xlsx"] });
		expect("compare" in parsed).toBe(false);
		expect("compareView" in parsed).toBe(false);
		expect("sourceFilesRight" in parsed).toBe(false);
	});

	it("異常值不套用；空 rsource 被舍棄", () => {
		expect(parseViewQuery("?compare=yes")).toEqual({});
		expect(parseViewQuery("?compare=0")).toEqual({ compare: false });
		expect(parseViewQuery("?compareView=banana")).toEqual({});
		expect(parseViewQuery("?rsource=&rsource=")).toEqual({});
		expect(parseViewQuery("?rsource=b.xlsx")).toEqual({
			sourceFilesRight: ["b.xlsx"],
		});
	});
});

describe("P5 IPC（ipcLevel / ipc= 多值）", () => {
	it("層級與篩選 round-trip；缺省層級不掛 URL", () => {
		const q = toViewQueryString({
			...fullDefaults(),
			ipcLevel: 4,
			ipcFilter: ["G06Q10", "H04L9"],
		});
		expect(q).toContain("ipcLevel=4");
		expect(q).toContain("ipc=G06Q10");
		expect(q).toContain("ipc=H04L9");
		const parsed = parseViewQuery(`?${q}`);
		expect(parsed.ipcLevel).toBe(4);
		expect(parsed.ipcFilter).toEqual(["G06Q10", "H04L9"]);
	});
	it("缺省層級（3）不掛；無篩選不掛 ipc=", () => {
		const def = toViewQueryString({
			...fullDefaults(),
			ipcLevel: 3,
			ipcFilter: [],
		});
		expect(def).not.toContain("ipcLevel=");
		expect(def).not.toContain("ipc=");
	});
	it("非法層級忽略；colorMode=ipc 可 round-trip", () => {
		expect(parseViewQuery("?ipcLevel=9&ipc=X")).toEqual({ ipcFilter: ["X"] });
		expect(parseViewQuery("?colorMode=ipc").colorMode).toBe("ipc");
		const q = toViewQueryString({ ...fullDefaults(), colorMode: "ipc" });
		expect(parseViewQuery(`?${q}`).colorMode).toBe("ipc");
	});
});
