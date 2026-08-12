import { describe, expect, it } from "vitest";
import { compareImageLayout } from "../lib/compare-image";

describe("compareImageLayout", () => {
	it("空面板：內容寬為最小寬度、面板區高度 0", () => {
		const layout = compareImageLayout([]);
		expect(layout.panelX).toEqual([]);
		expect(layout.panelY).toEqual([]);
		expect(layout.contentWidth).toBe(960);
		expect(layout.panelsAreaHeight).toBe(0);
	});

	it("單張：單排、x=0、y=0，內容寬至少 960", () => {
		const layout = compareImageLayout([{ width: 400, height: 300 }]);
		expect(layout.columns).toBe(1);
		expect(layout.panelX).toEqual([0]);
		expect(layout.panelY).toEqual([0]);
		expect(layout.contentWidth).toBe(960);
		expect(layout.panelsAreaHeight).toBe(300);
	});

	it("兩張：單排橫排，x 依寬度累加、加間距；內容寬＝兩圖寬和＋間距", () => {
		const layout = compareImageLayout([
			{ width: 600, height: 400 },
			{ width: 500, height: 300 },
		]);
		expect(layout.columns).toBe(2);
		expect(layout.panelX).toEqual([0, 600 + 24]);
		expect(layout.panelY).toEqual([0, 0]);
		expect(layout.contentWidth).toBe(600 + 24 + 500);
		expect(layout.panelsAreaHeight).toBe(400);
	});

	it("三張：每列最多 2 張，第二列 y 為第一列高＋列距，寬取最寬列", () => {
		const layout = compareImageLayout([
			{ width: 700, height: 400 },
			{ width: 500, height: 350 },
			{ width: 600, height: 300 },
		]);
		expect(layout.columns).toBe(2);
		expect(layout.panelX).toEqual([0, 700 + 24, 0]);
		expect(layout.panelY).toEqual([0, 0, 400 + 48]);
		expect(layout.contentWidth).toBe(700 + 24 + 500);
		expect(layout.panelsAreaHeight).toBe(400 + 48 + 300);
	});

	it("六張：三列，每列 y 依前一列高累加", () => {
		const sizes = Array.from({ length: 6 }, (_, index) => ({
			width: 500,
			height: 200 + index * 50,
		}));
		const layout = compareImageLayout(sizes);
		expect(layout.columns).toBe(2);
		expect(layout.panelX).toEqual([0, 524, 0, 524, 0, 524]);
		// 列高：200/250、300/350、400/450 → 每列取 max
		expect(layout.panelY).toEqual([
			0,
			0,
			250 + 48,
			250 + 48,
			250 + 48 + 350 + 48,
			250 + 48 + 350 + 48,
		]);
		expect(layout.panelsAreaHeight).toBe(250 + 48 + 350 + 48 + 450);
		expect(layout.contentWidth).toBe(524 + 500);
	});

	it("每列超過 2 張時以 2 為上限（自訂 maxPerRow 生效）", () => {
		const layout = compareImageLayout(
			[
				{ width: 100, height: 100 },
				{ width: 100, height: 100 },
				{ width: 100, height: 100 },
			],
			3,
		);
		expect(layout.columns).toBe(3);
		expect(layout.panelX).toEqual([0, 124, 248]);
		expect(layout.panelY).toEqual([0, 0, 0]);
		expect(layout.panelsAreaHeight).toBe(100);
	});
});
