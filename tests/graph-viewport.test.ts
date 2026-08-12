import { describe, expect, it } from "vitest";
import {
	graphViewportsEqual,
	isValidGraphViewport,
} from "../lib/graph-viewport";

describe("isValidGraphViewport", () => {
	it("接受有限座標與正縮放比例", () => {
		expect(
			isValidGraphViewport({ position: { x: -120.5, y: 80 }, scale: 0.35 }),
		).toBe(true);
	});

	it.each([
		null,
		{ position: { x: Number.NaN, y: 0 }, scale: 1 },
		{ position: { x: 0, y: Number.POSITIVE_INFINITY }, scale: 1 },
		{ position: { x: 0, y: 0 }, scale: Number.NaN },
		{ position: { x: 0, y: 0 }, scale: 0 },
		{ position: { x: 0, y: 0 }, scale: -1 },
	])("拒絕無效或首次載入 viewport：%j", (viewport) => {
		expect(isValidGraphViewport(viewport)).toBe(false);
	});
});

describe("graphViewportsEqual", () => {
	const base = { position: { x: 100, y: -50 }, scale: 1.25 };

	it("完全相同視為等價", () => {
		expect(graphViewportsEqual(base, { ...base })).toBe(true);
	});

	it("容差內的浮點誤差視為等價（避免兩側互推）", () => {
		expect(
			graphViewportsEqual(base, {
				position: { x: 100.0005, y: -50.0005 },
				scale: 1.2505,
			}),
		).toBe(true);
	});

	it.each([
		{ position: { x: 100.02, y: -50 }, scale: 1.25 },
		{ position: { x: 100, y: -49.9 }, scale: 1.25 },
		{ position: { x: 100, y: -50 }, scale: 1.3 },
	])("超過容差就不等價：%j", (other) => {
		expect(graphViewportsEqual(base, other)).toBe(false);
	});

	it("自訂容差可放寬判定", () => {
		expect(
			graphViewportsEqual(
				base,
				{ position: { x: 100.4, y: -50 }, scale: 1.25 },
				0.5,
			),
		).toBe(true);
	});

	it("任一側無效（含 null）一律不等價，首次同步不會被跳過", () => {
		expect(graphViewportsEqual(base, null)).toBe(false);
		expect(graphViewportsEqual(null, base)).toBe(false);
		expect(graphViewportsEqual(null, null)).toBe(false);
		expect(
			graphViewportsEqual(base, { position: { x: 100, y: -50 }, scale: 0 }),
		).toBe(false);
	});
});
