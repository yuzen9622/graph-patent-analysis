import { validateLayout } from "./geometry";
import {
	LAYOUT_VERSION,
	type CompletedLayout,
	type LayoutCache,
} from "./types";
export const STORAGE_KEY = "wang.graphLayout.v1";
const MAX_CHARS = 3 * 1024 * 1024;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
interface Entry {
	version: string;
	fingerprint: string;
	count: number;
	reason: CompletedLayout["reason"];
	positions: number[];
	diagnostics: CompletedLayout["diagnostics"];
}
const copyDiagnostics = (
	d: CompletedLayout["diagnostics"],
): CompletedLayout["diagnostics"] => ({
	ticks: d.ticks,
	collisionPasses: d.collisionPasses,
	expansion: d.expansion,
});
const copy = (layout: CompletedLayout): CompletedLayout => ({
	...layout,
	positions: layout.positions.slice(),
	diagnostics: copyDiagnostics(layout.diagnostics),
});
export function createLayoutCache(
	getStorage: () => StorageLike | undefined = () =>
		typeof window === "undefined" ? undefined : window.localStorage,
): LayoutCache & { memorySize: () => number } {
	const memory = new Map<string, CompletedLayout>();
	const storage = () => {
		try {
			return getStorage();
		} catch {
			return undefined;
		}
	};
	const read = (): Entry[] => {
		try {
			const raw = storage()?.getItem(STORAGE_KEY);
			if (!raw || raw.length > MAX_CHARS) return [];
			const data = JSON.parse(raw);
			if (
				data?.version !== LAYOUT_VERSION ||
				!Array.isArray(data.entries) ||
				data.entries.length > 12
			)
				return [];
			return data.entries
				.filter(
					(entry: Entry) =>
						entry &&
						entry.version === LAYOUT_VERSION &&
						typeof entry.fingerprint === "string" &&
						/^[0-9a-z]+-[0-9a-z]+$/.test(entry.fingerprint) &&
						Number.isSafeInteger(entry.count) &&
						entry.count >= 0 &&
						(entry.reason === "trivial" ||
							entry.reason === "iteration-budget") &&
						Array.isArray(entry.positions) &&
						entry.positions.length === entry.count * 2 &&
						entry.positions.every(
							(n) => typeof n === "number" && Number.isFinite(n),
						) &&
						entry.diagnostics &&
						Number.isInteger(entry.diagnostics.ticks) &&
						Number.isInteger(entry.diagnostics.collisionPasses) &&
						Number.isFinite(entry.diagnostics.expansion),
				)
				.map((entry: Entry) => ({
					version: entry.version,
					fingerprint: entry.fingerprint,
					count: entry.count,
					reason: entry.reason,
					positions: entry.positions,
					diagnostics: copyDiagnostics(entry.diagnostics),
				}));
		} catch {
			return [];
		}
	};
	const remember = (key: string, layout: CompletedLayout) => {
		memory.delete(key);
		memory.set(key, copy(layout));
		while (memory.size > 16) memory.delete(memory.keys().next().value!);
	};
	return {
		memorySize: () => memory.size,
		get(input) {
			const hit = memory.get(input.fingerprint);
			if (hit) {
				if (validateLayout(input, hit)) {
					remember(input.fingerprint, hit);
					return { layout: copy(hit), source: "memory" };
				}
				memory.delete(input.fingerprint);
			}
			const entries = read();
			for (const entry of entries) {
				if (
					!entry ||
					entry.version !== LAYOUT_VERSION ||
					entry.fingerprint !== input.fingerprint ||
					entry.count !== input.nodeIds.length ||
					!Array.isArray(entry.positions) ||
					!entry.positions.every(
						(n) => typeof n === "number" && Number.isFinite(n),
					)
				)
					continue;
				const layout: CompletedLayout = {
					fingerprint: entry.fingerprint,
					reason: entry.reason,
					positions: Float64Array.from(entry.positions),
					diagnostics: entry.diagnostics,
				};
				if (validateLayout(input, layout)) {
					remember(input.fingerprint, layout);
					try {
						storage()?.setItem(
							STORAGE_KEY,
							JSON.stringify({
								version: LAYOUT_VERSION,
								entries: [...entries.filter((e) => e !== entry), entry],
							}),
						);
					} catch {
						return { layout: copy(layout), source: "storage" };
					}
					return { layout: copy(layout), source: "storage" };
				}
			}
			return null;
		},
		put(input, layout) {
			if (!validateLayout(input, layout)) return;
			remember(input.fingerprint, layout);
			const entry: Entry = {
				version: LAYOUT_VERSION,
				fingerprint: input.fingerprint,
				count: input.nodeIds.length,
				reason: layout.reason,
				positions: [...layout.positions],
				diagnostics: copyDiagnostics(layout.diagnostics),
			};
			const entries = read().filter(
				(e) => e && e.fingerprint !== input.fingerprint,
			);
			entries.push(entry);
			while (entries.length > 12) entries.shift();
			const encode = () => JSON.stringify({ version: LAYOUT_VERSION, entries });
			let raw = encode();
			while (raw.length > MAX_CHARS && entries.length) {
				entries.shift();
				raw = encode();
			}
			try {
				storage()?.setItem(STORAGE_KEY, raw);
			} catch {
				const one = JSON.stringify({
					version: LAYOUT_VERSION,
					entries: [entry],
				});
				if (one.length <= MAX_CHARS) {
					try {
						storage()?.setItem(STORAGE_KEY, one);
					} catch {
						return;
					}
				}
			}
		},
	};
}
export const graphLayoutCache = createLayoutCache();
