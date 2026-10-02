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

export interface InheritedPositions {
	/** 有舊座標或已依鄰居推得座標的節點。 */
	readonly positions: Map<string, { x: number; y: number }>;
	/** 原本就有舊座標的節點數。 */
	readonly matched: number;
	/** 無舊座標、也無已定位鄰居可參考的節點。 */
	readonly unplaced: string[];
}

/**
 * 沿用前一次穩定版面的節點座標；新節點放在已定位鄰居的平均位置附近，
 * 讓它們從鄰居旁開始而不是被丟到遠處，之後仍需交給物理引擎收斂。
 */
export function inheritPositions(
	nodeIds: string[],
	edges: { from: string; to: string }[],
	previous: ReadonlyMap<string, { x: number; y: number }>,
	jitter: (id: string, axis: "x" | "y") => number = () => 0,
): InheritedPositions {
	const positions = new Map<string, { x: number; y: number }>();
	let matched = 0;
	for (const id of nodeIds) {
		const pos = previous.get(id);
		if (pos) {
			positions.set(id, { x: pos.x, y: pos.y });
			matched += 1;
		}
	}

	const adjacency = new Map<string, string[]>();
	for (const edge of edges) {
		if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
		if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
		adjacency.get(edge.from)!.push(edge.to);
		adjacency.get(edge.to)!.push(edge.from);
	}

	let pending = nodeIds.filter((id) => !positions.has(id));
	while (pending.length > 0) {
		const placedThisPass = new Map<string, { x: number; y: number }>();
		for (const id of pending) {
			let sumX = 0;
			let sumY = 0;
			let count = 0;
			for (const neighbor of adjacency.get(id) ?? []) {
				const pos = positions.get(neighbor);
				if (pos) {
					sumX += pos.x;
					sumY += pos.y;
					count += 1;
				}
			}
			if (count > 0) {
				placedThisPass.set(id, {
					x: sumX / count + jitter(id, "x"),
					y: sumY / count + jitter(id, "y"),
				});
			}
		}
		if (placedThisPass.size === 0) break;
		for (const [id, pos] of placedThisPass) positions.set(id, pos);
		pending = pending.filter((id) => !placedThisPass.has(id));
	}

	return { positions, matched, unplaced: pending };
}
