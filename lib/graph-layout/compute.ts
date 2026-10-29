import { forceManyBody } from "d3-force";
import { separateCollisions, validateLayout } from "./geometry";
import {
	LAYOUT_OPTIONS as o,
	type LayoutInput,
	type CompletedLayout,
} from "./types";
export function computeGraphLayout(input: LayoutInput): CompletedLayout {
	const n = input.nodeIds.length;
	const nodes = Array.from({ length: n }, (_, index) => ({
		index,
		x: input.initial[index * 2],
		y: input.initial[index * 2 + 1],
		vx: 0,
		vy: 0,
		oldVx: 0,
		oldVy: 0,
		degree: 1,
	}));
	const edges = Array.from({ length: input.edges.length / 2 }, (_, i) => [
		nodes[input.edges[i * 2]],
		nodes[input.edges[i * 2 + 1]],
	]);
	for (const [a, b] of edges) {
		a.degree++;
		b.degree++;
	}
	if (n > 1) {
		const large = n >= o.largeGraph,
			rest = large ? o.restLarge : o.restSmall;
		const repulsion = forceManyBody<(typeof nodes)[number]>()
			.strength(large ? o.strengthLarge : o.strengthSmall)
			.theta(o.theta)
			.distanceMin(o.distanceMin);
		let seed = 1;
		repulsion.initialize(
			nodes,
			() =>
				((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) /
				4294967296,
		);
		for (let tick = 0; tick < o.ticks; tick++) {
			for (const node of nodes) {
				node.vx = 0;
				node.vy = 0;
			}
			repulsion(1);
			for (const node of nodes) {
				node.vx = (node.vx - o.central * node.x) * node.degree;
				node.vy = (node.vy - o.central * node.y) * node.degree;
			}
			for (const [a, b] of edges) {
				const dx = b.x - a.x,
					dy = b.y - a.y,
					d = Math.max(0.01, Math.hypot(dx, dy)),
					f = (o.spring * (d - rest)) / d,
					fx = dx * f,
					fy = dy * f;
				a.vx += fx;
				a.vy += fy;
				b.vx -= fx;
				b.vy -= fy;
			}
			for (const node of nodes) {
				node.oldVx = Math.max(
					-o.maxVelocity,
					Math.min(
						o.maxVelocity,
						node.oldVx + (node.vx - o.damping * node.oldVx) * o.dt,
					),
				);
				node.oldVy = Math.max(
					-o.maxVelocity,
					Math.min(
						o.maxVelocity,
						node.oldVy + (node.vy - o.damping * node.oldVy) * o.dt,
					),
				);
				node.x += node.oldVx * o.dt;
				node.y += node.oldVy * o.dt;
			}
		}
	}
	const positions = Float64Array.from(
		nodes.flatMap((node) => [node.x, node.y]),
	);
	const diagnostics = {
		ticks: n > 1 ? o.ticks : 0,
		...separateCollisions(positions, input.radii),
	};
	const result: CompletedLayout = {
		fingerprint: input.fingerprint,
		positions,
		reason: n > 1 ? "iteration-budget" : "trivial",
		diagnostics,
	};
	if (!validateLayout(input, result))
		throw Error("Invalid completed layout geometry");
	return result;
}
