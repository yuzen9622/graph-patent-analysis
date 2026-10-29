import {
	LAYOUT_OPTIONS,
	type LayoutInput,
	type CompletedLayout,
} from "./types";
export interface LayoutBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}
export function layoutBounds(
	positions: Float64Array,
	radii: Float64Array,
): LayoutBounds | null {
	if (!radii.length) return null;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (let i = 0; i < radii.length; i++) {
		minX = Math.min(minX, positions[2 * i] - radii[i]);
		maxX = Math.max(maxX, positions[2 * i] + radii[i]);
		minY = Math.min(minY, positions[2 * i + 1] - radii[i]);
		maxY = Math.max(maxY, positions[2 * i + 1] + radii[i]);
	}
	return { minX, minY, maxX, maxY };
}
function collisionPairs(
	positions: Float64Array,
	radii: Float64Array,
	visit: (a: number, b: number, distance: number) => void,
	gap = 0,
): void {
	const sorted = Array.from(radii, (_, i) => i).sort(
		(a, b) =>
			positions[a * 2] - radii[a] - (positions[b * 2] - radii[b]) || a - b,
	);
	for (let k = 0; k < sorted.length; k++) {
		const a = sorted[k],
			right = positions[a * 2] + radii[a] + gap;
		for (let l = k + 1; l < sorted.length; l++) {
			const b = sorted[l];
			if (positions[b * 2] - radii[b] >= right) break;
			const required = radii[a] + radii[b] + gap,
				dy = positions[b * 2 + 1] - positions[a * 2 + 1];
			if (Math.abs(dy) >= required) continue;
			const distance = Math.hypot(positions[b * 2] - positions[a * 2], dy);
			if (distance < required) visit(a, b, distance);
		}
	}
}
export function countOverlaps(
	positions: Float64Array,
	radii: Float64Array,
): number {
	let count = 0;
	collisionPairs(positions, radii, () => count++);
	return count;
}
export function separateCollisions(
	positions: Float64Array,
	radii: Float64Array,
): { collisionPasses: number; expansion: number } {
	if (
		positions.length !== radii.length * 2 ||
		!positions.every(Number.isFinite)
	) {
		throw Error("Invalid solver coordinates");
	}
	if (countOverlaps(positions, radii) === 0)
		return { collisionPasses: 0, expansion: 1 };
	let passes = 0;
	for (; passes < LAYOUT_OPTIONS.collisionPasses; passes++) {
		const pairs: [number, number][] = [];
		collisionPairs(
			positions,
			radii,
			(a, b) => pairs.push([a, b]),
			LAYOUT_OPTIONS.collisionGap,
		);
		if (!pairs.length) return { collisionPasses: passes, expansion: 1 };
		for (const [a, b] of pairs) {
			let dx = positions[b * 2] - positions[a * 2],
				dy = positions[b * 2 + 1] - positions[a * 2 + 1],
				d = Math.hypot(dx, dy);
			const required = radii[a] + radii[b] + LAYOUT_OPTIONS.collisionGap;
			if (d >= required) continue;
			if (d === 0) {
				const angle =
					((a + 1) * 2.399963229728653 + (b + 1) * 0.754877666) * Math.PI;
				dx = Math.cos(angle);
				dy = Math.sin(angle);
				d = 1;
				const move = required / 2 + LAYOUT_OPTIONS.collisionGap;
				positions[a * 2] -= dx * move;
				positions[a * 2 + 1] -= dy * move;
				positions[b * 2] += dx * move;
				positions[b * 2 + 1] += dy * move;
			} else {
				const move = (required - d) / 2 + LAYOUT_OPTIONS.collisionGap;
				positions[a * 2] -= (dx / d) * move;
				positions[a * 2 + 1] -= (dy / d) * move;
				positions[b * 2] += (dx / d) * move;
				positions[b * 2 + 1] += (dy / d) * move;
			}
		}
	}
	// Exact coincidences need distinct positions before uniform expansion can separate them.
	const occupied = new Set<string>();
	for (let i = 0; i < radii.length; i++) {
		let x = positions[2 * i],
			y = positions[2 * i + 1];
		while (occupied.has(`${x},${y}`)) {
			x += 0.001 * (i + 1);
			y += 0.001;
		}
		positions[2 * i] = x;
		positions[2 * i + 1] = y;
		occupied.add(`${x},${y}`);
	}
	let expansion = 1;
	collisionPairs(
		positions,
		radii,
		(a, b, d) => {
			expansion = Math.max(
				expansion,
				(radii[a] + radii[b] + LAYOUT_OPTIONS.collisionGap) / d,
			);
		},
		LAYOUT_OPTIONS.collisionGap,
	);
	if (expansion > 1) {
		expansion *= 1 + 1e-10;
		let cx = 0,
			cy = 0;
		for (let i = 0; i < radii.length; i++) {
			cx += positions[i * 2];
			cy += positions[i * 2 + 1];
		}
		cx /= radii.length;
		cy /= radii.length;
		for (let i = 0; i < radii.length; i++) {
			positions[i * 2] = cx + (positions[i * 2] - cx) * expansion;
			positions[i * 2 + 1] = cy + (positions[i * 2 + 1] - cy) * expansion;
		}
	}
	return { collisionPasses: passes, expansion };
}
export function validateLayout(
	input: LayoutInput,
	value: unknown,
): value is CompletedLayout {
	if (!value || typeof value !== "object") return false;
	const v = value as CompletedLayout;
	return (
		v.fingerprint === input.fingerprint &&
		v.reason === (input.nodeIds.length < 2 ? "trivial" : "iteration-budget") &&
		v.positions instanceof Float64Array &&
		v.positions.length === input.nodeIds.length * 2 &&
		v.positions.every(
			(n) => Number.isFinite(n) && Math.abs(n) <= LAYOUT_OPTIONS.maxCoordinate,
		) &&
		!!v.diagnostics &&
		v.diagnostics.ticks ===
			(input.nodeIds.length < 2 ? 0 : LAYOUT_OPTIONS.ticks) &&
		Number.isInteger(v.diagnostics.collisionPasses) &&
		v.diagnostics.collisionPasses >= 0 &&
		v.diagnostics.collisionPasses <= LAYOUT_OPTIONS.collisionPasses &&
		Number.isFinite(v.diagnostics.expansion) &&
		v.diagnostics.expansion >= 1 &&
		countOverlaps(v.positions, input.radii) === 0
	);
}
export function fallbackGrid(input: LayoutInput): Float64Array {
	const n = input.nodeIds.length,
		columns = Math.max(1, Math.ceil(Math.sqrt(n)));
	let radius = 10;
	for (const r of input.radii) radius = Math.max(radius, r);
	const spacing = radius * 2 + 10;
	return Float64Array.from({ length: n * 2 }, (_, i) =>
		i % 2 === 0
			? ((Math.floor(i / 2) % columns) - (columns - 1) / 2) * spacing
			: (Math.floor(Math.floor(i / 2) / columns) -
					(Math.ceil(n / columns) - 1) / 2) *
				spacing,
	);
}
