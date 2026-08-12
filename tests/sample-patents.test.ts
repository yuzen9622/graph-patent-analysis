import { describe, expect, it } from "vitest";
import { planPatentSample, samplePatents } from "@/lib/sample-patents";
import type { PatentRow } from "@/types/graph";

function patent(id: string, sourceFiles?: string[]): PatentRow {
	return {
		id,
		title: id,
		abstract: "",
		applicant: "",
		source_files: sourceFiles,
	};
}

function patentsFrom(sourceFile: string, count: number): PatentRow[] {
	return Array.from({ length: count }, (_, index) =>
		patent(`${sourceFile}-${index}`, [sourceFile]),
	);
}

describe("samplePatents", () => {
	it("samples the full per-file cap from every source file", () => {
		const patents = [
			...patentsFrom("first.xlsx", 100),
			...patentsFrom("second.xlsx", 100),
		];
		const plan = planPatentSample({
			patents,
			filenames: ["first.xlsx", "second.xlsx"],
			sampleSize: 100,
		});
		const sampled = samplePatents({
			patents,
			filenames: ["first.xlsx", "second.xlsx"],
			sampleSize: 100,
			rng: () => 0,
		});

		expect(plan.allocations).toEqual([
			{ sourceFile: "first.xlsx", available: 100, allocated: 100 },
			{ sourceFile: "second.xlsx", available: 100, allocated: 100 },
		]);
		expect(plan.target).toBe(200);
		expect(
			sampled.patents.filter((row) => row.id.startsWith("first.xlsx-")),
		).toHaveLength(100);
		expect(
			sampled.patents.filter((row) => row.id.startsWith("second.xlsx-")),
		).toHaveLength(100);
	});

	it("caps each source file at the per-file size instead of the total", () => {
		const patents = [
			...patentsFrom("first.xlsx", 100),
			...patentsFrom("second.xlsx", 100),
			...patentsFrom("third.xlsx", 100),
		];
		const sampled = samplePatents({
			patents,
			filenames: ["first.xlsx", "second.xlsx", "third.xlsx"],
			sampleSize: 30,
			rng: () => 0,
		});

		expect(sampled.allocations).toEqual([
			{ sourceFile: "first.xlsx", available: 100, allocated: 30 },
			{ sourceFile: "second.xlsx", available: 100, allocated: 30 },
			{ sourceFile: "third.xlsx", available: 100, allocated: 30 },
		]);
		expect(sampled.target).toBe(90);
		expect(sampled.patents).toHaveLength(90);
	});

	it("never hands an undersized file's unused quota to another file", () => {
		const patents = [
			...patentsFrom("short.xlsx", 10),
			...patentsFrom("long.xlsx", 90),
		];
		const sampled = samplePatents({
			patents,
			filenames: ["short.xlsx", "long.xlsx"],
			sampleSize: 50,
			rng: () => 0,
		});

		expect(sampled.allocations).toEqual([
			{ sourceFile: "short.xlsx", available: 10, allocated: 10 },
			{ sourceFile: "long.xlsx", available: 90, allocated: 50 },
		]);
		expect(sampled.target).toBe(60);
		expect(sampled.patents).toHaveLength(60);
	});

	it("reports a target equal to the summed allocations", () => {
		const plan = planPatentSample({
			patents: [
				...patentsFrom("short.xlsx", 1),
				...patentsFrom("first.xlsx", 100),
				...patentsFrom("second.xlsx", 100),
			],
			filenames: ["short.xlsx", "first.xlsx", "second.xlsx"],
			sampleSize: 11,
		});

		expect(plan.allocations).toEqual([
			{ sourceFile: "short.xlsx", available: 1, allocated: 1 },
			{ sourceFile: "first.xlsx", available: 100, allocated: 11 },
			{ sourceFile: "second.xlsx", available: 100, allocated: 11 },
		]);
		expect(plan.target).toBe(
			plan.allocations.reduce(
				(sum, allocation) => sum + allocation.allocated,
				0,
			),
		);
	});

	it("counts a duplicated patent only against its first uploaded source", () => {
		const patents = [
			...patentsFrom("first.xlsx", 5),
			...patentsFrom("second.xlsx", 5),
			patent("shared-1", ["first.xlsx", "second.xlsx"]),
			patent("shared-2", ["second.xlsx", "first.xlsx"]),
		];
		const sampled = samplePatents({
			patents,
			filenames: ["first.xlsx", "second.xlsx"],
			sampleSize: 6,
			rng: () => 0,
		});

		expect(sampled.allocations).toEqual([
			{ sourceFile: "first.xlsx", available: 7, allocated: 6 },
			{ sourceFile: "second.xlsx", available: 5, allocated: 5 },
		]);
		expect(sampled.target).toBe(11);
		expect(new Set(sampled.patents.map((row) => row.id)).size).toBe(
			sampled.patents.length,
		);
	});

	it("assigns an overlap once to its first uploaded source and orders extra sources lexically", () => {
		const patents = [
			patent("overlap", ["second.xlsx", "first.xlsx"]),
			patent("first-only", ["first.xlsx"]),
			patent("second-only", ["second.xlsx"]),
			patent("z-extra", ["z-extra.xlsx"]),
			patent("a-extra", ["a-extra.xlsx"]),
		];
		const sampled = samplePatents({
			patents,
			filenames: ["first.xlsx", "second.xlsx"],
			sampleSize: 5,
			rng: () => 0,
		});

		expect(sampled.allocations).toEqual([
			{ sourceFile: "first.xlsx", available: 2, allocated: 2 },
			{ sourceFile: "second.xlsx", available: 1, allocated: 1 },
			{ sourceFile: "a-extra.xlsx", available: 1, allocated: 1 },
			{ sourceFile: "z-extra.xlsx", available: 1, allocated: 1 },
		]);
		expect(sampled.patents.filter((row) => row.id === "overlap")).toHaveLength(
			1,
		);
		expect(new Set(sampled.patents.map((row) => row.id)).size).toBe(
			sampled.patents.length,
		);
	});

	it("returns every patent when the total is below the target", () => {
		const patents = [
			patent("first", ["first.xlsx"]),
			patent("second", ["second.xlsx"]),
			patent("unknown"),
		];
		const sampled = samplePatents({
			patents,
			filenames: ["first.xlsx", "second.xlsx"],
			sampleSize: 10,
			rng: () => 0,
		});

		expect(sampled.target).toBe(3);
		expect(sampled.patents.map((row) => row.id).sort()).toEqual([
			"first",
			"second",
			"unknown",
		]);
		expect(
			sampled.allocations.reduce(
				(sum, allocation) => sum + allocation.allocated,
				0,
			),
		).toBe(3);
	});

	it("uses one global partial shuffle for a single uploaded file", () => {
		const values = [0.99, 0.49];
		const sampled = samplePatents({
			patents: [
				patent("first", ["only.xlsx"]),
				patent("second", ["other.xlsx"]),
				patent("third"),
				patent("fourth", ["only.xlsx"]),
			],
			filenames: ["only.xlsx"],
			sampleSize: 2,
			rng: () => values.shift() ?? 0,
		});

		expect(sampled.stratified).toBe(false);
		expect(sampled.allocations).toEqual([
			{ sourceFile: "only.xlsx", available: 4, allocated: 2 },
		]);
		expect(sampled.patents.map((row) => row.id)).toEqual(["fourth", "third"]);
	});
});
