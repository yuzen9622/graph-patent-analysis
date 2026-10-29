import { describe, expect, it } from "vitest";
import { buildLayoutInput } from "../lib/graph-layout/input";
import { computeGraphLayout } from "../lib/graph-layout/compute";
import {
	countOverlaps,
	validateLayout,
	separateCollisions,
	fallbackGrid,
} from "../lib/graph-layout/geometry";
import type { GraphNode, GraphEdge } from "../types/graph";
describe("bounded deterministic layout", () => {
	it("keeps collision-free coordinates unchanged and repairs dense collisions with integer-export safety", () => {
		const positions = new Float64Array([0.1, 0.2, 100.3, 100.4]);
		const original = positions.slice();
		separateCollisions(positions, new Float64Array([10, 10]));
		expect(positions).toEqual(original);
		const dense = new Float64Array(300 * 2),
			radii = new Float64Array(300).fill(10);
		const diagnostics = separateCollisions(dense, radii);
		expect(diagnostics.collisionPasses).toBeLessThanOrEqual(32);
		expect(countOverlaps(dense, radii)).toBe(0);
		expect(countOverlaps(Float64Array.from(dense, Math.round), radii)).toBe(0);
	});
	it("provides a bounded non-overlapping fallback without solving", () => {
		const input = buildLayoutInput(
			Array.from({ length: 1200 }, (_, i) => ({
				id: String(i),
				type: "concept",
				label: "",
				color: "",
				size: i % 3 ? 10 : 35,
			})),
			[],
		);
		const positions = fallbackGrid(input);
		expect(positions.length).toBe(2400);
		expect(positions.every(Number.isFinite)).toBe(true);
		expect(countOverlaps(positions, input.radii)).toBe(0);
	});
	it.each([0, 1, 2, 35, 1200])(
		"preserves all %i nodes, finite nonoverlapping geometry",
		(n) => {
			const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
				id: String(i),
				type: "concept",
				label: "",
				color: "red",
				size: 10,
			}));
			const edges: GraphEdge[] =
				n === 35
					? []
					: nodes.slice(1).map((node) => ({
							id: node.id,
							from: "0",
							to: node.id,
							kind: "structural",
							relation: "",
							weight: 1,
						}));
			const input = buildLayoutInput(nodes, edges);
			const result = computeGraphLayout(input);
			expect(result.positions.length).toBe(n * 2);
			expect(validateLayout(input, result)).toBe(true);
			expect(countOverlaps(result.positions, input.radii)).toBe(0);
			expect(result.reason).toBe(n < 2 ? "trivial" : "iteration-budget");
			expect(computeGraphLayout(input).positions).toEqual(result.positions);
		},
		20000,
	);
	it("repairs identical initial positions deterministically", () => {
		const nodes: GraphNode[] = Array.from({ length: 20 }, (_, i) => ({
			id: String(i),
			type: "concept",
			label: "",
			color: "",
			size: 30,
		}));
		const input = buildLayoutInput(nodes, []);
		const identical = {
			...input,
			initial: new Float64Array(input.initial.length),
		};
		expect(validateLayout(identical, computeGraphLayout(identical))).toBe(true);
	});
});
