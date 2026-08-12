import { describe, expect, it } from "vitest";
import { resolveInspectionView } from "../lib/inspection-view";
import type { GraphViewData } from "../lib/graph-view";

function view(id: string): GraphViewData {
	return {
		nodes: [
			{ id: `node:${id}`, type: "concept", label: id, color: "#000", size: 18 },
		],
		edges: [
			{
				id: `edge:${id}`,
				from: `node:${id}`,
				to: `node:${id}`,
				relation: "test",
			},
		],
		communities: [],
		stats: {
			applicant_count: 0,
			patent_count: 0,
			concept_count: 1,
			community_count: 0,
			year_range: [2020, 2020],
		},
		maxSupport: 1,
		citationEdges: [],
	};
}

const main = view("main");
const panelA = view("panel-a");
const panelB = view("panel-b");
const difference = view("difference");
const inputs = { main, panels: [panelA, panelB], difference };

describe("resolveInspectionView", () => {
	it("resolves the main view", () => {
		expect(resolveInspectionView({ kind: "main" }, inputs)).toBe(main);
	});

	it("resolves the requested comparison panel", () => {
		expect(resolveInspectionView({ kind: "panel", index: 1 }, inputs)).toBe(
			panelB,
		);
	});

	it("resolves the difference view", () => {
		expect(resolveInspectionView({ kind: "difference" }, inputs)).toBe(
			difference,
		);
	});

	it("returns null for an invalid comparison panel", () => {
		expect(
			resolveInspectionView({ kind: "panel", index: -1 }, inputs),
		).toBeNull();
		expect(
			resolveInspectionView({ kind: "panel", index: 2 }, inputs),
		).toBeNull();
	});
});
