/** 純圖譜渲染輔助：拓樸指紋與節點浮現排程。 */

/** FNV-1a 32-bit hash。 */
function fnv1a(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 只代表會影響 layout 的 node/edge 拓樸。輸入順序、節點外觀與 edge 權重都不影響結果。
 */
export function fingerprintTopology(
	nodes: { id: string }[],
	edges: { id: string; from: string; to: string }[],
): string {
	const nodeHash = fnv1a(
		nodes
			.map((node) => node.id)
			.sort()
			.join("\n"),
	);
	const edgeHash = fnv1a(
		edges
			.map((edge) => `${edge.id}|${edge.from}|${edge.to}`)
			.sort()
			.join("\n"),
	);
	return `n=${nodes.length}:${nodeHash}|e=${edges.length}:${edgeHash}`;
}

export interface RevealPlan {
	readonly startMs: Map<string, number>;
	readonly totalMs: number;
}

export interface RevealScheduleOptions {
	waves?: number;
	waveGapMs?: number;
	fadeMs?: number;
}

const DEFAULT_WAVE_GAP_MS = 60;
const DEFAULT_FADE_MS = 240;

/**
 * 依 degree 由高至低分批安排節點浮現；同 degree 時以 id 固定排序，讓結果可重現。
 */
export function revealSchedule(
	nodeIds: string[],
	degreeOf: (id: string) => number,
	opts: RevealScheduleOptions = {},
): RevealPlan {
	const waves = Math.max(
		1,
		Math.round(
			opts.waves ?? Math.min(12, Math.max(4, Math.ceil(nodeIds.length / 8))),
		),
	);
	const waveGapMs = Math.max(0, opts.waveGapMs ?? DEFAULT_WAVE_GAP_MS);
	const fadeMs = Math.max(0, opts.fadeMs ?? DEFAULT_FADE_MS);
	const sortedIds = [...nodeIds].sort(
		(a, b) => degreeOf(b) - degreeOf(a) || a.localeCompare(b),
	);
	const startMs = new Map<string, number>();

	for (const [index, id] of sortedIds.entries()) {
		const wave = Math.floor((index * waves) / Math.max(sortedIds.length, 1));
		startMs.set(id, wave * waveGapMs);
	}

	const maxStartMs = Math.max(0, ...startMs.values());
	return { startMs, totalMs: maxStartMs + fadeMs };
}
