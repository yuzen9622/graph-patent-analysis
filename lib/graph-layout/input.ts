import type { GraphNode, GraphEdge } from "../../types/graph";
import { LAYOUT_VERSION, LAYOUT_OPTIONS, type LayoutInput } from "./types";
export function stableUnit(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) / 0xffffffff;
}

export function seedPositions(
	nodes: GraphNode[],
	edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>();

	const byComm = new Map<number, string[]>();
	nodes.forEach((n) => {
		const commId =
			n.community_id !== undefined
				? n.community_id
				: (n as { community?: number }).community;
		if (commId !== undefined) {
			const arr = byComm.get(commId) ?? [];
			arr.push(n.id);
			byComm.set(commId, arr);
		}
	});

	const comms = [...byComm.entries()]
		.sort(([a], [b]) => a - b)
		.map(([id, ids]) => [id, [...ids].sort()] as [number, string[]]);
	const K = comms.length;

	if (K > 0) {
		const RING = Math.max(300, Math.min(K * 40, 1200));
		const SPREAD = 80;

		comms.forEach(([, ids], ci) => {
			const ca = (ci / K) * 2 * Math.PI;
			const cx = Math.cos(ca) * RING;
			const cy = Math.sin(ca) * RING;
			ids.forEach((id, ni) => {
				const na = (ni / Math.max(ids.length, 1)) * 2 * Math.PI;
				const r = SPREAD * (0.35 + (ni % 3) * 0.32);
				positions.set(id, {
					x: cx + Math.cos(na) * r,
					y: cy + Math.sin(na) * r,
				});
			});
		});
	}

	const adj = new Map<string, string[]>();
	edges.forEach((e) => {
		if (!adj.has(e.from)) adj.set(e.from, []);
		if (!adj.has(e.to)) adj.set(e.to, []);
		adj.get(e.from)!.push(e.to);
		adj.get(e.to)!.push(e.from);
	});

	const unpositionedNodes = nodes.filter((n) => {
		const commId =
			n.community_id !== undefined
				? n.community_id
				: (n as { community?: number }).community;
		return commId === undefined;
	});

	for (let pass = 0; pass < 3; pass++) {
		let placedAny = false;
		unpositionedNodes.forEach((n) => {
			if (positions.has(n.id)) return;

			const neighbors = adj.get(n.id) ?? [];
			let sumX = 0;
			let sumY = 0;
			let count = 0;

			neighbors.forEach((neighId) => {
				const pos = positions.get(neighId);
				if (pos) {
					sumX += pos.x;
					sumY += pos.y;
					count++;
				}
			});

			if (count > 0) {
				const jitterX = (stableUnit(`${n.id}:x`) - 0.5) * 30;
				const jitterY = (stableUnit(`${n.id}:y`) - 0.5) * 30;
				positions.set(n.id, {
					x: sumX / count + jitterX,
					y: sumY / count + jitterY,
				});
				placedAny = true;
			}
		});
		if (!placedAny) break;
	}

	let unplacedCount = 0;
	unpositionedNodes.forEach((n) => {
		if (!positions.has(n.id)) {
			unplacedCount++;
		}
	});

	let unplacedIdx = 0;
	unpositionedNodes.forEach((n) => {
		if (!positions.has(n.id)) {
			const angle = (unplacedIdx / Math.max(unplacedCount, 1)) * 2 * Math.PI;
			const r = 200 + stableUnit(`${n.id}:radius`) * 100;
			positions.set(n.id, {
				x: Math.cos(angle) * r,
				y: Math.sin(angle) * r,
			});
			unplacedIdx++;
		}
	});

	return positions;
}

// Dual-seed cyrb53 is a non-cryptographic geometry cache fingerprint, not an authorization boundary.
function hash53(text: string, seed: number): string {
	let h1 = 0xdeadbeef ^ seed,
		h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function isLayoutEdge(edge: GraphEdge): boolean {
	return edge.kind !== "semantic" && edge.kind !== "institution";
}
export function buildLayoutInput(
	nodes: GraphNode[],
	edges: GraphEdge[],
	scopeKey = "",
	version = LAYOUT_VERSION,
	positions?: ReadonlyMap<string, { x: number; y: number }>,
): LayoutInput {
	const ordered = [...nodes].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
	const nodeIds = Object.freeze(ordered.map((n) => n.id));
	if (new Set(nodeIds).size !== nodeIds.length)
		throw Error("Duplicate layout node");
	const index = new Map(nodeIds.map((id, i) => [id, i]));
	const radii = Float64Array.from(ordered, (n) => {
		if (!Number.isFinite(n.size) || n.size < 0)
			throw Error("Invalid layout radius");
		return n.size || 10;
	});
	const pairs = edges
		.filter(isLayoutEdge)
		.flatMap((e) => {
			const a = index.get(e.from),
				b = index.get(e.to);
			return a === undefined || b === undefined || a === b
				? []
				: [[Math.min(a, b), Math.max(a, b)]];
		})
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const layoutEdges = Uint32Array.from(pairs.flat());
	const seeds =
		positions ??
		seedPositions(
			ordered,
			edges
				.filter(isLayoutEdge)
				.slice()
				.sort((a, b) =>
					a.from < b.from
						? -1
						: a.from > b.from
							? 1
							: a.to < b.to
								? -1
								: a.to > b.to
									? 1
									: 0,
				),
		);
	const initial = Float64Array.from(
		nodeIds.flatMap((id) => {
			const p = seeds.get(id);
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
				throw Error("Invalid initial layout position");
			return [p.x, p.y];
		}),
	);
	const key = JSON.stringify([
		version,
		LAYOUT_OPTIONS,
		hash53(scopeKey, 0) + "-" + hash53(scopeKey, 1),
		nodeIds,
		[...radii],
		pairs,
	]);
	return Object.freeze({
		nodeIds,
		radii,
		initial,
		edges: layoutEdges,
		fingerprint: hash53(key, 0) + "-" + hash53(key, 1),
	});
}
