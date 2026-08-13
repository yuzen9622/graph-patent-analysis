import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Sidebar from "../components/Sidebar";

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
		const firstFilterContentAt = markup.indexOf(
			'data-slot="accordion-content"',
		);

		expect(resetAt).toBeGreaterThan(-1);
		expect(firstFilterContentAt).toBeGreaterThan(-1);
		expect(resetAt).toBeLessThan(firstFilterContentAt);
	});
});
