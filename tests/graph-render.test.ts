import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const debounceHarness = vi.hoisted(() => {
	let currentValue: unknown;
	let initialized = false;
	let cleanup: (() => void) | undefined;
	const setValue = vi.fn((next: unknown) => {
		currentValue = next;
	});

	return {
		useState(initialValue: unknown) {
			if (!initialized) {
				currentValue = initialValue;
				initialized = true;
			}
			return [currentValue, setValue] as const;
		},
		useEffect(effect: () => void | (() => void)) {
			cleanup?.();
			cleanup = effect() ?? undefined;
		},
		reset() {
			cleanup?.();
			cleanup = undefined;
			currentValue = undefined;
			initialized = false;
			setValue.mockClear();
		},
		setValue,
	};
});

vi.mock("react", () => ({
	useEffect: debounceHarness.useEffect,
	useState: debounceHarness.useState,
}));

import {
	fingerprintTopology,
	revealSchedule,
} from "@/lib/graph-render";
import { useDebouncedValue } from "@/lib/use-debounced-value";

describe("fingerprintTopology", () => {
	const nodes = [
		{ id: "concept:b", color: "#f00", size: 12 },
		{ id: "concept:a", color: "#0f0", size: 24 },
	];
	const edges = [
		{ id: "edge:b", from: "concept:b", to: "concept:a" },
		{ id: "edge:a", from: "concept:a", to: "concept:b" },
	];

	it("忽略 node 與 edge 的輸入順序", () => {
		expect(fingerprintTopology(nodes, edges)).toBe(
			fingerprintTopology([...nodes].reverse(), [...edges].reverse()),
		);
	});

	it("增刪 node 或 edge 時改變", () => {
		const baseline = fingerprintTopology(nodes, edges);
		expect(fingerprintTopology([...nodes, { id: "concept:c" }], edges)).not.toBe(
			baseline,
		);
		expect(fingerprintTopology(nodes.slice(1), edges)).not.toBe(baseline);
		expect(
			fingerprintTopology(
				nodes,
				[...edges, { id: "edge:c", from: "concept:a", to: "concept:c" }],
			),
		).not.toBe(baseline);
		expect(fingerprintTopology(nodes, edges.slice(1))).not.toBe(baseline);
	});

	it("忽略 node 的 color 與 size", () => {
		expect(fingerprintTopology(nodes, edges)).toBe(
			fingerprintTopology(
				nodes.map((node) => ({
					...node,
					color: "#123456",
					size: node.size + 10,
				})),
				edges,
			),
		);
	});

	it("edge 的 from 或 to 改變時改變", () => {
		const baseline = fingerprintTopology(nodes, edges);
		expect(
			fingerprintTopology(nodes, [
				{ ...edges[0], from: "concept:a" },
				edges[1],
			]),
		).not.toBe(baseline);
		expect(
			fingerprintTopology(nodes, [
				edges[0],
				{ ...edges[1], to: "concept:a" },
			]),
		).not.toBe(baseline);
	});
});

describe("revealSchedule", () => {
	it("以 degree 降冪穩定排程所有節點", () => {
		const degree = new Map([
			["hub", 8],
			["bridge", 4],
			["tie:a", 2],
			["tie:b", 2],
			["leaf", 1],
		]);
		const ids = ["tie:b", "leaf", "hub", "tie:a", "bridge"];
		const first = revealSchedule(ids, (id) => degree.get(id) ?? 0);
		const second = revealSchedule(ids, (id) => degree.get(id) ?? 0);

		for (const id of ids) {
			expect(first.startMs.get(id)).toBeTypeOf("number");
		}
		expect([...first.startMs.keys()]).toEqual([
			"hub",
			"bridge",
			"tie:a",
			"tie:b",
			"leaf",
		]);
		expect(first.startMs.get("hub")!).toBeLessThanOrEqual(
			first.startMs.get("bridge")!,
		);
		expect(first.startMs.get("bridge")!).toBeLessThanOrEqual(
			first.startMs.get("tie:a")!,
		);
		expect(first.startMs.get("tie:a")!).toBeLessThanOrEqual(
			first.startMs.get("tie:b")!,
		);
		expect(first.totalMs).toBe(
			Math.max(...first.startMs.values()) + 240,
		);
		expect([...first.startMs]).toEqual([...second.startMs]);
		expect(first.totalMs).toBe(second.totalMs);
	});
});

describe("useDebouncedValue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		debounceHarness.reset();
	});

	afterEach(() => {
		debounceHarness.reset();
		vi.useRealTimers();
	});

	it("假時鐘下連續變更只提交最後一個值", () => {
		useDebouncedValue(1, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(2, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(3, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(4, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(5, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(6, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(7, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(8, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(9, 200);
		vi.advanceTimersByTime(10);
		useDebouncedValue(10, 200);
		vi.advanceTimersByTime(10);

		vi.advanceTimersByTime(189);
		expect(debounceHarness.setValue).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(debounceHarness.setValue).toHaveBeenCalledTimes(1);
		expect(debounceHarness.setValue).toHaveBeenLastCalledWith(10);
	});
});
