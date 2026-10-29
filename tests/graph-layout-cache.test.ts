import { describe, expect, it } from "vitest";
import { createLayoutCache, STORAGE_KEY } from "../lib/graph-layout/cache";
import { buildLayoutInput } from "../lib/graph-layout/input";
import { computeGraphLayout } from "../lib/graph-layout/compute";
import type { GraphNode } from "../types/graph";
const input = (scope = "secret scope") =>
	buildLayoutInput(
		[
			{
				id: "private patent",
				label: "private label",
				type: "patent",
				color: "red",
				size: 10,
			},
		],
		[],
		scope,
	);
function storage() {
	let raw: string | null = null;
	return {
		getItem: () => raw,
		setItem: (_key: string, v: string) => {
			raw = v;
		},
		raw: () => raw,
	};
}
describe("validated bounded geometry cache", () => {
	it("refreshes persistent recency when a layout is loaded from storage", () => {
		const s = storage(),
			cache = createLayoutCache(() => s);
		for (let i = 0; i < 12; i++) {
			const a = input(String(i));
			cache.put(a, computeGraphLayout(a));
		}
		const reloaded = createLayoutCache(() => s);
		expect(reloaded.get(input("0"))?.source).toBe("storage");
		const next = input("12");
		reloaded.put(next, computeGraphLayout(next));
		expect(createLayoutCache(() => s).get(input("0"))?.source).toBe("storage");
		expect(createLayoutCache(() => s).get(input("1"))).toBeNull();
	});
	it("evicts by total serialized size, not just entry count", () => {
		const nodes: GraphNode[] = Array.from({ length: 12000 }, (_, i) => ({
			id: String(i),
			type: "concept",
			label: "",
			color: "",
			size: 1,
		}));
		const s = storage(),
			cache = createLayoutCache(() => s);
		let newest = buildLayoutInput(nodes, [], "0");
		for (let i = 0; i < 15; i++) {
			newest = buildLayoutInput(nodes, [], String(i));
			cache.put(newest, {
				fingerprint: newest.fingerprint,
				reason: "iteration-budget",
				positions: Float64Array.from({ length: 24000 }, (_, k) =>
					k % 2
						? Math.floor(k / 2) * 0.123456789
						: Math.floor(k / 2) * 20 + 0.123456789,
				),
				diagnostics: { ticks: 1500, collisionPasses: 0, expansion: 1 },
			});
		}
		expect(s.raw()!.length).toBeLessThanOrEqual(3 * 1024 * 1024);
		expect(JSON.parse(s.raw()!).entries.length).toBeLessThan(12);
		expect(createLayoutCache(() => s).get(newest)?.source).toBe("storage");
	}, 20000);
	it("refreshes memory LRU on read and retries quota once with only the latest entry", () => {
		const s = storage(),
			cache = createLayoutCache(() => s);
		for (let i = 0; i < 16; i++) {
			const a = input(String(i));
			cache.put(a, computeGraphLayout(a));
		}
		expect(cache.get(input("0"))?.source).toBe("memory");
		const next = input("16");
		cache.put(next, computeGraphLayout(next));
		expect(cache.get(input("0"))?.source).toBe("memory");
		expect(cache.get(input("1"))).toBeNull();
		const attempts: number[] = [];
		const failing = createLayoutCache(() => ({
			getItem: s.getItem,
			setItem: (_key, raw) => {
				attempts.push(JSON.parse(raw).entries.length);
				throw Error("quota");
			},
		}));
		const latest = input("latest");
		failing.put(latest, computeGraphLayout(latest));
		expect(attempts).toEqual([12, 1]);
		expect(failing.get(latest)?.source).toBe("memory");
	});
	it("does not carry unknown content from corrupted storage into a rewritten envelope", () => {
		const s = storage(),
			a = input();
		createLayoutCache(() => s).put(a, computeGraphLayout(a));
		const data = JSON.parse(s.raw()!);
		data.entries[0].label = "private injected label";
		data.entries[0].diagnostics.scope = "private injected scope";
		s.setItem("", JSON.stringify(data));
		const cache = createLayoutCache(() => s);
		expect(cache.get(a)?.source).toBe("storage");
		const next = input("next");
		cache.put(next, computeGraphLayout(next));
		expect(s.raw()).not.toMatch(/private injected/);
	});
	it("persists only geometry and returns independent copies", () => {
		const s = storage(),
			a = input(),
			result = computeGraphLayout(a);
		const cache = createLayoutCache(() => s);
		cache.put(a, result);
		const raw = s.raw()!;
		expect(raw).not.toMatch(/private|secret/);
		expect(STORAGE_KEY).toBeTruthy();
		const hit = cache.get(a)!;
		expect(hit.source).toBe("memory");
		hit.layout.positions[0] = 999;
		expect(cache.get(a)!.layout.positions[0]).not.toBe(999);
		expect(createLayoutCache(() => s).get(a)?.source).toBe("storage");
	});
	it.each(["bad json", "{}", '{"version":1,"entries":[]}'])(
		"ignores corrupt envelope %s",
		(raw) => {
			expect(
				createLayoutCache(() => ({
					getItem: () => raw,
					setItem: () => {},
				})).get(input()),
			).toBeNull();
		},
	);
	it("validates hash, count, version, reason, coordinates and overlap", () => {
		const s = storage(),
			a = buildLayoutInput(
				[
					{ id: "a", type: "concept", label: "", color: "", size: 10 },
					{ id: "b", type: "concept", label: "", color: "", size: 10 },
				],
				[],
			);
		createLayoutCache(() => s).put(a, computeGraphLayout(a));
		const original = JSON.parse(s.raw()!);
		for (const patch of [
			{ fingerprint: "wrong" },
			{ count: 3 },
			{ version: "wrong" },
			{ reason: "converged" },
			{ reason: "trivial" },
			{ diagnostics: { ticks: 1, collisionPasses: 0, expansion: 1 } },
			{ positions: [0, 0, 0, 0] },
			{ positions: [null, 0, 100, 0] },
			{ positions: [1e8, 0, 100, 0] },
			{ positions: [0, 0] },
		]) {
			const data = structuredClone(original);
			Object.assign(data.entries[0], patch);
			s.setItem("", JSON.stringify(data));
			expect(createLayoutCache(() => s).get(a)).toBeNull();
		}
	});
	it("bounds L1 to16, L2 to12 and storage bytes", () => {
		const s = storage(),
			cache = createLayoutCache(() => s);
		for (let i = 0; i < 25; i++) {
			const a = input(String(i));
			cache.put(a, computeGraphLayout(a));
		}
		expect(cache.memorySize()).toBe(16);
		expect(JSON.parse(s.raw()!).entries.length).toBeLessThanOrEqual(12);
		expect(s.raw()!.length).toBeLessThanOrEqual(3 * 1024 * 1024);
		expect(cache.get(input("24"))?.source).toBe("memory");
		expect(cache.get(input("0"))).toBeNull();
	});
	it("handles getter, read and quota failures without losing L1", () => {
		for (const get of [
			() => {
				throw Error("SecurityError");
			},
			() => ({
				getItem: () => {
					throw Error("read");
				},
				setItem: () => {
					throw Error("quota");
				},
			}),
		]) {
			const cache = createLayoutCache(get),
				a = input();
			expect(() => cache.put(a, computeGraphLayout(a))).not.toThrow();
			expect(cache.get(a)?.source).toBe("memory");
		}
	});
});
