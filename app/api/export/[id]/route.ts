import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getJob } from "@/lib/store";
import { loadGraph } from "@/lib/db/analyses";
import { requireUser, UnauthorizedError } from "@/lib/db/sessions";
import {
	buildExportHtml,
	buildExportViews,
	parseExportOptions,
	type ExportOptions,
} from "@/lib/export-html";
import { buildCompareExportHtml } from "@/lib/export-compare-html";
import { buildDifferenceView, scopesEqual } from "@/lib/graph-compare";
import { compareExportFilename, scopeLabel } from "@/lib/compare-export";
import { selectGraphView, sourceFilesOf } from "@/lib/graph-view";
import {
	ExportBodyTooLargeError,
	ExportPositionsError,
	parseExportPositions,
	readExportJsonBody,
	type FrozenPositions,
} from "@/lib/export-positions";
import type { GraphData } from "@/types/graph";

export const dynamic = "force-dynamic";

type ExportRouteContext = { params: Promise<{ id: string }> };

interface ExportContext {
	id: string;
	graph: GraphData;
	options: ExportOptions;
}

type ExportLoadResult = { context: ExportContext } | { response: NextResponse };

function loadVisNetworkSource(): string {
	return readFileSync(
		join(
			process.cwd(),
			"node_modules",
			"vis-network",
			"standalone",
			"umd",
			"vis-network.min.js",
		),
		"utf8",
	);
}

async function loadExportContext(
	request: NextRequest,
	{ params }: ExportRouteContext,
): Promise<ExportLoadResult> {
	try {
		await requireUser();
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			return {
				response: NextResponse.json({ error: err.message }, { status: 401 }),
			};
		}
		throw err;
	}

	const { id } = await params;
	const job = getJob(id);

	if (job && job.status !== "done") {
		return {
			response: NextResponse.json(
				{ error: "Analysis not yet complete" },
				{ status: 409 },
			),
		};
	}

	const graph = await loadGraph(id);
	if (!graph) {
		return {
			response: NextResponse.json(
				{ error: "Graph data not found" },
				{ status: 404 },
			),
		};
	}

	return {
		context: {
			id,
			graph,
			options: parseExportOptions(request.nextUrl.searchParams, graph),
		},
	};
}

/**
 * `compare=1` 專用分支：`source` 是 A 側範圍（沿用 parseExportOptions），
 * `rightSource` 是 B 側。兩側有效範圍相同就沒有東西可比，回 400。
 */
function compareAttachment(
	{ id, graph, options }: ExportContext,
	rightSourceFiles: string[],
	body: unknown,
): NextResponse {
	const allSourceFiles = sourceFilesOf(graph);
	if (allSourceFiles.length <= 1) {
		return NextResponse.json(
			{ error: "此分析只有一個來源檔，無法比較。" },
			{ status: 400 },
		);
	}
	if (scopesEqual(options.sourceFiles, rightSourceFiles, allSourceFiles)) {
		return NextResponse.json(
			{ error: "A、B 兩側的來源檔範圍相同，無法比較。" },
			{ status: 400 },
		);
	}

	const viewA = selectGraphView(graph, { ...options, showCitations: true });
	const viewB = selectGraphView(graph, {
		...options,
		sourceFiles: rightSourceFiles.length > 0 ? rightSourceFiles : undefined,
		showCitations: true,
	});
	const difference = buildDifferenceView(viewA, viewB);
	const positions = parseExportPositions(
		body,
		difference.view.nodes.map((node) => node.id),
	);

	const html = buildCompareExportHtml(
		{
			jobId: id,
			difference,
			positions,
			aLabel: scopeLabel(options.sourceFiles, allSourceFiles),
			bLabel: scopeLabel(rightSourceFiles, allSourceFiles),
			metrics: difference.metrics,
			tab: "difference",
			mode: options.mode,
			unit: options.unit ?? "patent",
			colorMode: options.colorMode ?? "community",
			edgeWeight: options.edgeWeight ?? "jaccard",
			minSupport: options.minSupport,
			yearRange: options.yearRange,
			ipcLevel: options.ipcLevel,
			ipcFilter: options.ipcFilter,
			showCitations: options.showCitations ?? false,
		},
		loadVisNetworkSource(),
	);

	return new NextResponse(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Disposition": `attachment; filename="${compareExportFilename(id, "html", "difference")}"`,
		},
	});
}

function exportAttachment(
	{ id, graph, options }: ExportContext,
	frozenPositions?: FrozenPositions,
): NextResponse {
	const html = buildExportHtml(
		id,
		graph,
		options,
		loadVisNetworkSource(),
		frozenPositions,
	);
	const now = new Date();
	const date = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("");

	return new NextResponse(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Disposition": `attachment; filename="patent-graph-${date}.html"`,
		},
	});
}

export async function GET(): Promise<NextResponse> {
	return NextResponse.json(
		{ error: "請使用分析頁面的「離線 HTML」按鈕；此端點僅支援 POST。" },
		{ status: 405, headers: { Allow: "POST" } },
	);
}

export async function POST(
	request: NextRequest,
	context: ExportRouteContext,
): Promise<NextResponse> {
	const loaded = await loadExportContext(request, context);
	if ("response" in loaded) return loaded.response;

	let body: unknown;
	try {
		body = await readExportJsonBody(request);
	} catch (err) {
		if (err instanceof ExportBodyTooLargeError) {
			return NextResponse.json({ error: err.message }, { status: 413 });
		}
		if (err instanceof SyntaxError) {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
		}
		throw err;
	}

	try {
		if (request.nextUrl.searchParams.get("compare") === "1") {
			return compareAttachment(
				loaded.context,
				request.nextUrl.searchParams.getAll("rightSource").filter(Boolean),
				body,
			);
		}
		const view = buildExportViews(loaded.context.graph, loaded.context.options)[
			loaded.context.options.mode
		];
		const frozenPositions = parseExportPositions(
			body,
			view.nodes.map((node) => node.id),
		);
		return exportAttachment(loaded.context, frozenPositions);
	} catch (err) {
		if (err instanceof ExportPositionsError) {
			return NextResponse.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
}
