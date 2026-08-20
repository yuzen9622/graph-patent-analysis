import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FloatingTimelapse from "../components/FloatingTimelapse";
import YearFilter from "../components/Sidebar/YearFilter";
import { selectGraphView } from "../lib/graph-view";
import type { GraphData } from "../types/graph";

describe("FloatingTimelapse component", () => {
	it("renders playback buttons, current year, and node stats", () => {
		const markup = renderToStaticMarkup(
			createElement(FloatingTimelapse, {
				yearRange: [2010, 2018],
				fullYearRange: [2010, 2024],
				onYearChange: vi.fn(),
				isPlaying: false,
				onTogglePlay: vi.fn(),
				speed: 1,
				onSpeedChange: vi.fn(),
				loop: false,
				onToggleLoop: vi.fn(),
				onReset: vi.fn(),
				onStep: vi.fn(),
				currentNodesCount: 42,
				totalNodesCount: 100,
				newNodesCount: 5,
				currentEdgesCount: 88,
			}),
		);

		expect(markup).toContain("2018");
		expect(markup).toContain("縮時演進");
		expect(markup).toContain("+5 新節點");
		expect(markup).toContain("42");
		expect(markup).toContain("/100");
		expect(markup).toContain("88");
		expect(markup).toContain("播放");
		expect(markup).toContain("1x");
	});

	it("renders pause state when isPlaying is true", () => {
		const markup = renderToStaticMarkup(
			createElement(FloatingTimelapse, {
				yearRange: [2010, 2018],
				fullYearRange: [2010, 2024],
				onYearChange: vi.fn(),
				isPlaying: true,
				onTogglePlay: vi.fn(),
				speed: 2,
				onSpeedChange: vi.fn(),
				loop: true,
				onToggleLoop: vi.fn(),
				onReset: vi.fn(),
				onStep: vi.fn(),
				currentNodesCount: 42,
				totalNodesCount: 100,
			}),
		);

		expect(markup).toContain("暫停");
	});

	it("returns null if fullYearRange is invalid", () => {
		const markup = renderToStaticMarkup(
			createElement(FloatingTimelapse, {
				yearRange: [0, 0],
				fullYearRange: [0, 0],
				onYearChange: vi.fn(),
				isPlaying: false,
				onTogglePlay: vi.fn(),
				speed: 1,
				onSpeedChange: vi.fn(),
				loop: false,
				onToggleLoop: vi.fn(),
				onReset: vi.fn(),
				onStep: vi.fn(),
				currentNodesCount: 0,
				totalNodesCount: 0,
			}),
		);

		expect(markup).toBe("");
	});
});

describe("YearFilter component with playback controls", () => {
	it("renders year inputs, range slider, and playback controls", () => {
		const markup = renderToStaticMarkup(
			createElement(YearFilter, {
				value: [2012, 2020],
				fullRange: [2010, 2025],
				onChange: vi.fn(),
				isPlaying: false,
				onTogglePlay: vi.fn(),
				onStep: vi.fn(),
				onReset: vi.fn(),
			}),
		);

		expect(markup).toContain("2012");
		expect(markup).toContain("2020");
		expect(markup).toContain("縮時播放");
	});

	it("renders pause button when isPlaying is true", () => {
		const markup = renderToStaticMarkup(
			createElement(YearFilter, {
				value: [2010, 2015],
				fullRange: [2010, 2025],
				onChange: vi.fn(),
				isPlaying: true,
				onTogglePlay: vi.fn(),
			}),
		);

		expect(markup).toContain("暫停");
	});
});

describe("Temporal cumulative network evolution", () => {
	const graph: GraphData = {
		schema_version: 3,
		nodes: [
			{
				id: "patent:P1",
				type: "patent",
				label: "P1",
				year: 2015,
				color: "#111",
				size: 10,
			},
			{
				id: "patent:P2",
				type: "patent",
				label: "P2",
				year: 2018,
				color: "#111",
				size: 10,
			},
			{
				id: "patent:P3",
				type: "patent",
				label: "P3",
				year: 2022,
				color: "#111",
				size: 10,
			},
			{
				id: "concept:C1",
				type: "concept",
				label: "C1",
				color: "#111",
				size: 10,
				first_year: 2015,
			},
			{
				id: "concept:C2",
				type: "concept",
				label: "C2",
				color: "#111",
				size: 10,
				first_year: 2015,
			},
			{
				id: "concept:C3",
				type: "concept",
				label: "C3",
				color: "#111",
				size: 10,
				first_year: 2022,
			},
		],
		edges: [
			{
				id: "s1",
				from: "patent:P1",
				to: "concept:C1",
				relation: "包含",
				kind: "structural",
			},
			{
				id: "s2",
				from: "patent:P1",
				to: "concept:C2",
				relation: "包含",
				kind: "structural",
			},
			{
				id: "s3",
				from: "patent:P2",
				to: "concept:C2",
				relation: "包含",
				kind: "structural",
			},
			{
				id: "s4",
				from: "patent:P3",
				to: "concept:C3",
				relation: "包含",
				kind: "structural",
			},
			{
				id: "co12",
				from: "concept:C1",
				to: "concept:C2",
				relation: "共同投入",
				kind: "cooccurrence",
				support_count: 2,
			},
			{
				id: "co23",
				from: "concept:C2",
				to: "concept:C3",
				relation: "共同投入",
				kind: "cooccurrence",
				support_count: 1,
			},
		],
		communities: [{ id: 1, name: "Comm 1", color: "#f00", node_count: 3 }],
		stats: {
			applicant_count: 0,
			patent_count: 3,
			concept_count: 3,
			community_count: 1,
			year_range: [2015, 2022],
		},
		ai_report: "",
		generated_at: "2026-01-01T00:00:00Z",
		methodology: {
			concept_frequency_metric: "unique_patent_count",
			cooccurrence_metric: "unique_patent_support",
			concept_size_formula: "test",
			applicant_size_formula: "test",
			patent_size: 1,
			community_algorithm: "louvain",
			community_edge_weight: "support_count",
			community_resolution: 1,
			community_random_walk: false,
			layout_distance_interpretation: "visual_only",
			prompt_version: "test",
			model_provider: "test",
			model_id: "test",
			cooccurrence_data: "native",
			semantic_provenance: "complete",
		},
	};

	it("shows only 2015 nodes when yearRange is [2015, 2015]", () => {
		const view2015 = selectGraphView(graph, {
			mode: "concept",
			showSemantic: false,
			showCitations: false,
			minSupport: 1,
			yearRange: [2015, 2015],
		});

		const conceptIds = view2015.nodes.map((n) => n.id);
		expect(conceptIds).toContain("concept:C1");
		expect(conceptIds).toContain("concept:C2");
		expect(conceptIds).not.toContain("concept:C3");
		expect(view2015.edges.map((e) => e.id)).toContain("co12");
		expect(view2015.edges.map((e) => e.id)).not.toContain("co23");
	});

	it("accumulates 2022 nodes when yearRange advances to [2015, 2022]", () => {
		const view2022 = selectGraphView(graph, {
			mode: "concept",
			showSemantic: false,
			showCitations: false,
			minSupport: 1,
			yearRange: [2015, 2022],
		});

		const conceptIds = view2022.nodes.map((n) => n.id);
		expect(conceptIds).toContain("concept:C1");
		expect(conceptIds).toContain("concept:C2");
		expect(conceptIds).toContain("concept:C3");
		expect(view2022.edges.map((e) => e.id)).toContain("co12");
	});
});
