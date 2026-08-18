import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Sidebar from "../components/Sidebar";
import { ScrollArea } from "../components/ui/scroll-area";
import type { GraphNode } from "../types/graph";

const noop = () => undefined;

function renderSidebarWithAnActiveYearFilter(): string {
	const props: ComponentProps<typeof Sidebar> = {
		nodes: [],
		communities: [],
		inspectionKey: "test",
		inspectionNodes: [],
		inspectionEdges: [],
		inspectionLookupNodes: [],
		inspectionCommunities: [],
		aiReport: "",
		yearRange: [2011, 2025],
		fullYearRange: [2010, 2025],
		selectedNode: null,
		selectedEdge: null,
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
		mode: "concept",
		sharedConceptCount: null,
		colorMode: "community",
		onColorModeChange: noop,
		unit: "patent",
		onUnitChange: noop,
		applicantAvailability: "none",
		allSourceFiles: [],
		sourceFiles: [],
		onSourceFilesChange: noop,
		compareMode: false,
		sourceFilesRight: [],
		onSourceFilesRightChange: noop,
		extraPanelCount: 0,
		ipcLevel: 3,
		onIpcLevelChange: noop,
		ipcFilter: [],
		onIpcFilterChange: noop,
		ipcTree: [],
		hasIpcData: false,
		minSupport: 1,
		maxSupport: 1,
		visibleLayers: new Set(["applicant", "patent", "concept"]),
		hiddenCommunities: new Set(),
		onYearChange: noop,
		onLayerToggle: noop,
		onCommunityToggle: noop,
		onNodeFocus: noop,
		onSearchNodeSelect: noop,
		onInspectorNodeSelect: noop,
		onInspectorClose: noop,
		onMinSupportChange: noop,
		onResetFilters: noop,
		showCitations: false,
		onCitationsChange: noop,
	};

	return renderToStaticMarkup(createElement(Sidebar, props));
}

describe("Sidebar filter reset action", () => {
	it("keeps the reset action in the filter header instead of constraining its contents", () => {
		const markup = renderSidebarWithAnActiveYearFilter();
		const resetAt = markup.indexOf("重設</button>");
		const firstFilterContentAt = markup.indexOf('data-slot="accordion-content"');

		expect(resetAt).toBeGreaterThan(-1);
		expect(firstFilterContentAt).toBeGreaterThan(-1);
		expect(resetAt).toBeLessThan(firstFilterContentAt);
	});
});

describe("ScrollArea & Inspector overflow scrolling", () => {
	it("renders ScrollArea viewport with max-h-[inherit] to support bounded overflow scroll", () => {
		const markup = renderToStaticMarkup(
			createElement(
				ScrollArea,
				{ className: "max-h-[40svh]" },
				createElement("div", null, "content"),
			),
		);

		expect(markup).toContain('data-slot="scroll-area-viewport"');
		expect(markup).toContain("max-h-[inherit]");
	});

	it("renders Inspector with ScrollArea containing NodeInfo when a node is selected", () => {
		const sampleNode: GraphNode = {
			id: "concept-1",
			label: "自動化更新流程",
			type: "concept",
			color: "#59A14F",
			size: 10,
			frequency: 1,
			applicant_count: 1,
			first_year: 2017,
			median_year: 2017,
			last_year: 2017,
			q1_year: 2017,
			q3_year: 2017,
			year_counts: { 2017: 1 },
		};

		const props: ComponentProps<typeof Sidebar> = {
			nodes: [sampleNode],
			communities: [],
			inspectionKey: "test-node",
			inspectionNodes: [sampleNode],
			inspectionEdges: [],
			inspectionLookupNodes: [sampleNode],
			inspectionCommunities: [],
			aiReport: "",
			yearRange: [2010, 2025],
			fullYearRange: [2010, 2025],
			selectedNode: sampleNode,
			selectedEdge: null,
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
			mode: "concept",
			sharedConceptCount: null,
			colorMode: "community",
			onColorModeChange: noop,
			unit: "patent",
			onUnitChange: noop,
			applicantAvailability: "none",
			allSourceFiles: [],
			sourceFiles: [],
			onSourceFilesChange: noop,
			compareMode: false,
			sourceFilesRight: [],
			onSourceFilesRightChange: noop,
			extraPanelCount: 0,
			ipcLevel: 3,
			onIpcLevelChange: noop,
			ipcFilter: [],
			onIpcFilterChange: noop,
			ipcTree: [],
			hasIpcData: false,
			minSupport: 1,
			maxSupport: 1,
			visibleLayers: new Set(["applicant", "patent", "concept"]),
			hiddenCommunities: new Set(),
			onYearChange: noop,
			onLayerToggle: noop,
			onCommunityToggle: noop,
			onNodeFocus: noop,
			onSearchNodeSelect: noop,
			onInspectorNodeSelect: noop,
			onInspectorClose: noop,
			onMinSupportChange: noop,
			onResetFilters: noop,
			showCitations: false,
			onCitationsChange: noop,
		};

		const markup = renderToStaticMarkup(createElement(Sidebar, props));
		expect(markup).toContain("節點資訊");
		expect(markup).toContain("自動化更新流程");
		expect(markup).toContain("專利涵蓋");
		expect(markup).toContain("max-h-[40svh]");
		expect(markup).toContain("max-h-[inherit]");
	});
});
