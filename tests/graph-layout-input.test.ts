import { describe, expect, it } from "vitest";
import { buildLayoutInput } from "../lib/graph-layout/input";
import type { GraphNode, GraphEdge } from "../types/graph";
const nodes: GraphNode[] = ["z", "A", "a"].map((id) => ({
	id,
	type: "concept",
	label: "private label",
	color: "red",
	size: 10,
}));
const edge = (
	from: string,
	to: string,
	kind: GraphEdge["kind"] = "structural",
): GraphEdge => ({ id: from + to, from, to, kind, relation: "", weight: 1 });
describe("canonical layout input", () => {
	it("sorts code units, ignores appearance and input ordering", () => {
		const a = buildLayoutInput(nodes, [edge("z", "a")], "private scope");
		const b = buildLayoutInput(
			[...nodes]
				.reverse()
				.map((n) => ({ ...n, label: "other", color: "blue" })),
			[edge("a", "z")],
			"private scope",
		);
		expect(a.nodeIds).toEqual(["A", "a", "z"]);
		expect(a.fingerprint).toBe(b.fingerprint);
		expect(Object.isFrozen(a)).toBe(true);
	});
	it("excludes missing endpoints, self loops and visual-only edges; retains multiplicity", () => {
		const a = buildLayoutInput(nodes, [
			edge("z", "a"),
			edge("z", "a"),
			edge("A", "A"),
			edge("x", "z"),
			edge("A", "z", "semantic"),
			edge("A", "a", "institution"),
		]);
		expect([...a.edges]).toEqual([1, 2, 1, 2]);
	});
	it("invalidates exact radii, topology, scope and options version", () => {
		const a = buildLayoutInput(nodes, [], "s");
		expect(
			buildLayoutInput(
				nodes.map((n, i) => ({ ...n, size: i ? 10 : 10.00000001 })),
				[],
				"s",
			).fingerprint,
		).not.toBe(a.fingerprint);
		expect(buildLayoutInput(nodes, [edge("z", "a")], "s").fingerprint).not.toBe(
			a.fingerprint,
		);
		expect(buildLayoutInput(nodes, [], "t").fingerprint).not.toBe(
			a.fingerprint,
		);
		expect(buildLayoutInput(nodes, [], "s", "next").fingerprint).not.toBe(
			a.fingerprint,
		);
	});
	it.each([-1, Infinity, NaN])("rejects invalid radius %s", (size) => {
		expect(() => buildLayoutInput([{ ...nodes[0], size }], [])).toThrow();
	});
});
