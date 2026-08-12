import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { GraphData } from "@/types/graph";

const mocks = vi.hoisted(() => ({
	getJob: vi.fn(),
	loadGraph: vi.fn(),
	requireUser: vi.fn(),
	readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
	readFileSync: mocks.readFileSync,
}));

vi.mock("@/lib/store", () => ({
	getJob: mocks.getJob,
}));

vi.mock("@/lib/db/analyses", () => ({
	loadGraph: mocks.loadGraph,
}));

vi.mock("@/lib/db/sessions", () => {
	class UnauthorizedError extends Error {}
	return {
		UnauthorizedError,
		requireUser: mocks.requireUser,
	};
});

import { GET, POST } from "@/app/api/export/[id]/route";

const graph: GraphData = {
	schema_version: 2,
	nodes: [
		{
			id: "concept:alpha",
			type: "concept",
			label: "Alpha",
			color: "#000000",
			size: 16,
			frequency: 1,
			community_id: 0,
		},
	],
	edges: [],
	communities: [{ id: 0, name: "群", color: "#000000", node_count: 1 }],
	stats: {
		applicant_count: 0,
		patent_count: 0,
		concept_count: 1,
		community_count: 1,
		year_range: [2020, 2022],
	},
	ai_report: "",
	generated_at: "2026-01-01T00:00:00.000Z",
	methodology: {
		concept_frequency_metric: "unique_patent_count",
		cooccurrence_metric: "unique_patent_support",
		concept_size_formula: "x",
		applicant_size_formula: "x",
		patent_size: 18,
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

// 兩個來源檔⁃兩篇專利，才能讓 A⁃B 的有效範圍不同。
const compareGraph: GraphData = {
	...graph,
	nodes: [
		{
			id: "concept:alpha",
			type: "concept",
			label: "Alpha",
			color: "#000000",
			size: 16,
			frequency: 1,
			community_id: 0,
			source_patents: ["p1"],
		},
		{
			id: "concept:beta",
			type: "concept",
			label: "Beta",
			color: "#000000",
			size: 16,
			frequency: 1,
			community_id: 0,
			source_patents: ["p2"],
		},
		{
			id: "patent:p1",
			type: "patent",
			label: "P1",
			color: "#000000",
			size: 18,
			year: 2021,
			source_files: ["a.xlsx"],
		},
		{
			id: "patent:p2",
			type: "patent",
			label: "P2",
			color: "#000000",
			size: 18,
			year: 2021,
			source_files: ["b.xlsx"],
		},
	],
	stats: {
		applicant_count: 0,
		patent_count: 2,
		concept_count: 2,
		community_count: 1,
		year_range: [2020, 2022],
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireUser.mockResolvedValue({ id: "user-id" });
	mocks.getJob.mockReturnValue(undefined);
	mocks.loadGraph.mockResolvedValue(graph);
	mocks.readFileSync.mockReturnValue("window.vis = {};");
});

describe("export route", () => {
	it("returns the POST-only guidance without authenticating or loading graph state", async () => {
		const response = await GET();

		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("POST");
		await expect(response.json()).resolves.toEqual({
			error: "請使用分析頁面的「離線 HTML」按鈕；此端點僅支援 POST。",
		});
		expect(mocks.requireUser).not.toHaveBeenCalled();
		expect(mocks.getJob).not.toHaveBeenCalled();
		expect(mocks.loadGraph).not.toHaveBeenCalled();
		expect(mocks.readFileSync).not.toHaveBeenCalled();
	});

	it("rejects a comparison whose A/B effective scopes are identical", async () => {
		mocks.loadGraph.mockResolvedValue(compareGraph);

		const response = await POST(
			new NextRequest(
				"http://localhost/api/export/job-id?mode=concept&compare=1&source=a.xlsx&rightSource=a.xlsx",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ positions: {} }),
				},
			),
			{ params: Promise.resolve({ id: "job-id" }) },
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "A、B 兩側的來源檔範圍相同，無法比較。",
		});
	});

	it("treats an empty rightSource as every source file when detecting identical scopes", async () => {
		mocks.loadGraph.mockResolvedValue(compareGraph);

		const response = await POST(
			new NextRequest(
				"http://localhost/api/export/job-id?mode=concept&compare=1&source=a.xlsx&source=b.xlsx",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ positions: {} }),
				},
			),
			{ params: Promise.resolve({ id: "job-id" }) },
		);

		expect(response.status).toBe(400);
	});

	it("rejects a comparison on a single-source analysis", async () => {
		const response = await POST(
			new NextRequest(
				"http://localhost/api/export/job-id?mode=concept&compare=1&source=a.xlsx",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ positions: {} }),
				},
			),
			{ params: Promise.resolve({ id: "job-id" }) },
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "此分析只有一個來源檔，無法比較。",
		});
	});

	it("rejects comparison positions that do not match the union node set", async () => {
		mocks.loadGraph.mockResolvedValue(compareGraph);

		const response = await POST(
			new NextRequest(
				"http://localhost/api/export/job-id?mode=context&compare=1&source=a.xlsx&rightSource=b.xlsx",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ positions: { "patent:p1": { x: 1, y: 2 } } }),
				},
			),
			{ params: Promise.resolve({ id: "job-id" }) },
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Position IDs do not match graph",
		});
	});

	it("returns the comparison attachment for differing A/B scopes", async () => {
		mocks.loadGraph.mockResolvedValue(compareGraph);

		const response = await POST(
			new NextRequest(
				"http://localhost/api/export/job-id?mode=context&compare=1&source=a.xlsx&rightSource=b.xlsx",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						positions: {
							"patent:p1": { x: 1, y: 2 },
							"patent:p2": { x: -3, y: 4 },
						},
					}),
				},
			),
			{ params: Promise.resolve({ id: "job-id" }) },
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(response.headers.get("Content-Disposition")).toMatch(
			/^attachment; filename="patent-graph-compare-diff-job-id-\d{8}\.html"$/,
		);
		const html = await response.text();
		expect(html).toContain("專利知識圖譜 A/B 比較");
		expect(html).toContain("A（左）：a.xlsx");
		expect(html).toContain("B（右）：b.xlsx");
		expect(html).toContain(
			'"nodeMembership":{"patent:p1":"a","patent:p2":"b"}',
		);
		expect(html).toContain('"x":1,"y":2');
		expect(html).toContain('data-membership="shared"');
		expect(mocks.requireUser).toHaveBeenCalledTimes(1);
	});

	it("keeps the canonical POST attachment contract", async () => {
		const response = await POST(
			new NextRequest("http://localhost/api/export/job-id?mode=concept", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					positions: { "concept:alpha": { x: 12.5, y: -4 } },
				}),
			}),
			{ params: Promise.resolve({ id: "job-id" }) },
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(response.headers.get("Content-Disposition")).toMatch(
			/^attachment; filename="patent-graph-\d{8}\.html"$/,
		);
		const html = await response.text();
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain('"frozenLayouts":{"concept"');
		expect(html).toContain('"x":12.5,"y":-4');
		expect(html).toContain("citation-toggle");
		expect(mocks.requireUser).toHaveBeenCalledTimes(1);
		expect(mocks.getJob).toHaveBeenCalledWith("job-id");
		expect(mocks.loadGraph).toHaveBeenCalledWith("job-id");
	});
});
