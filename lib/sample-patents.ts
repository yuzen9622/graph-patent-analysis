/**
 * Client-safe random sampling for the de-duplicated PatentRow list.
 *
 * Multi-file uploads are partitioned into one mutually exclusive stratum per
 * source file before sampling. This preserves one analysis unit per patent even
 * when a merged row lists more than one source file.
 */

import type { PatentRow } from "@/types/graph";

export type SampleRng = () => number;

export interface PatentSampleOptions {
	patents: readonly PatentRow[];
	filenames?: readonly string[];
	sampleSize: number;
	/** Must return a value in [0, 1), like Math.random. */
	rng?: SampleRng;
}

export interface PatentSampleAllocation {
	/** null means that the parsed row did not name a source file. */
	sourceFile: string | null;
	/** Rows uniquely assigned to this source before sampling. */
	available: number;
	/** Rows intended to be sampled from this source. */
	allocated: number;
}

export interface PatentSamplePlan {
	target: number;
	stratified: boolean;
	allocations: PatentSampleAllocation[];
}

export interface PatentSample extends PatentSamplePlan {
	patents: PatentRow[];
}

interface SampleStratum {
	sourceFile: string | null;
	patents: PatentRow[];
	allocated: number;
}

interface InternalSamplePlan extends PatentSamplePlan {
	strata: SampleStratum[];
}

function lexicalCompare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function uploadedSources(filenames: readonly string[]): string[] {
	return Array.from(
		new Set(filenames.filter((filename) => filename.length > 0)),
	);
}

function sourceNames(patent: PatentRow): Set<string> {
	return new Set(
		(patent.source_files ?? []).filter((source) => source.length > 0),
	);
}

function normalizedSampleSize(sampleSize: number, total: number): number {
	if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0;
	return Math.min(Math.floor(sampleSize), total);
}

/**
 * Fix short strata at capacity first, then recompute the equal split among
 * those that remain. This keeps the redistributed allocation fair instead of
 * preserving an earlier odd-row advantage after a stratum fills.
 */
function allocateStrata(strata: SampleStratum[], target: number): void {
	let remaining = target;
	let active = [...strata];

	while (active.length > 0) {
		const base = Math.floor(remaining / active.length);
		const extra = remaining % active.length;
		const intended = active.map((_, index) => base + (index < extra ? 1 : 0));
		const short = active.filter(
			(stratum, index) => stratum.patents.length < intended[index],
		);

		if (short.length === 0) {
			for (const [index, stratum] of active.entries()) {
				stratum.allocated = intended[index];
			}
			return;
		}

		const shortSet = new Set(short);
		for (const stratum of short) {
			stratum.allocated = stratum.patents.length;
			remaining -= stratum.allocated;
		}
		active = active.filter((stratum) => !shortSet.has(stratum));
	}
}

function partialFisherYates<T>(
	items: readonly T[],
	count: number,
	rng: SampleRng,
): T[] {
	const shuffled = [...items];

	for (let index = 0; index < count; index += 1) {
		const swapIndex = index + Math.floor(rng() * (shuffled.length - index));
		[shuffled[index], shuffled[swapIndex]] = [
			shuffled[swapIndex],
			shuffled[index],
		];
	}

	return shuffled.slice(0, count);
}

function globalPlan(
	patents: readonly PatentRow[],
	target: number,
	sourceFile: string | null,
): InternalSamplePlan {
	const stratum: SampleStratum = {
		sourceFile,
		patents: [...patents],
		allocated: target,
	};

	return {
		target,
		stratified: false,
		allocations: [{ sourceFile, available: patents.length, allocated: target }],
		strata: [stratum],
	};
}

function stratifiedPlan(
	patents: readonly PatentRow[],
	target: number,
	filenames: string[],
): InternalSamplePlan {
	const namedSources = new Set(filenames);
	const extraSources = new Set<string>();
	const namesByPatent = patents.map((patent) => sourceNames(patent));

	for (const names of namesByPatent) {
		for (const source of names) {
			if (!namedSources.has(source)) extraSources.add(source);
		}
	}

	const orderedExtraSources = Array.from(extraSources).sort(lexicalCompare);
	const sourceOrder = [...filenames, ...orderedExtraSources];
	const assignment = namesByPatent.map(
		(names) => sourceOrder.find((source) => names.has(source)) ?? null,
	);
	const assignedExtraSources = new Set<string>();
	for (const source of assignment) {
		if (source !== null && !namedSources.has(source))
			assignedExtraSources.add(source);
	}
	const strata: SampleStratum[] = [
		...filenames.map((sourceFile) => ({
			sourceFile,
			patents: [],
			allocated: 0,
		})),
		...orderedExtraSources
			.filter((sourceFile) => assignedExtraSources.has(sourceFile))
			.map((sourceFile) => ({ sourceFile, patents: [], allocated: 0 })),
	];
	const bySource = new Map(
		strata.map((stratum) => [stratum.sourceFile, stratum]),
	);
	const unknown: PatentRow[] = [];

	for (const [index, patent] of patents.entries()) {
		const sourceFile = assignment[index];
		if (sourceFile === null) {
			unknown.push(patent);
		} else {
			bySource.get(sourceFile)?.patents.push(patent);
		}
	}

	if (unknown.length > 0)
		strata.push({ sourceFile: null, patents: unknown, allocated: 0 });

	allocateStrata(strata, target);

	return {
		target,
		stratified: true,
		allocations: strata.map(({ sourceFile, patents: rows, allocated }) => ({
			sourceFile,
			available: rows.length,
			allocated,
		})),
		strata,
	};
}

function buildSamplePlan(
	patents: readonly PatentRow[],
	sampleSize: number,
	filenames: readonly string[],
): InternalSamplePlan {
	const target = normalizedSampleSize(sampleSize, patents.length);
	const sources = uploadedSources(filenames);

	// A one-file upload (or an old/unknown caller without filenames) has no
	// cross-file balance to preserve, so one partial shuffle is the true global
	// random sample.
	if (sources.length <= 1)
		return globalPlan(patents, target, sources[0] ?? null);

	return stratifiedPlan(patents, target, sources);
}

/** Returns the auditable, deterministic per-source allocation without sampling. */
export function planPatentSample(
	options: Omit<PatentSampleOptions, "rng">,
): PatentSamplePlan {
	const { target, stratified, allocations } = buildSamplePlan(
		options.patents,
		options.sampleSize,
		options.filenames ?? [],
	);
	return { target, stratified, allocations };
}

/** Samples each allocation with a partial Fisher-Yates shuffle. */
export function samplePatents(options: PatentSampleOptions): PatentSample {
	const plan = buildSamplePlan(
		options.patents,
		options.sampleSize,
		options.filenames ?? [],
	);
	const rng = options.rng ?? Math.random;

	return {
		target: plan.target,
		stratified: plan.stratified,
		allocations: plan.allocations,
		patents: plan.strata.flatMap((stratum) =>
			partialFisherYates(stratum.patents, stratum.allocated, rng),
		),
	};
}
