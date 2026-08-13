import { describe, expect, it } from "vitest";
import { getHistoryHref } from "../lib/analysis-history";

describe("getHistoryHref", () => {
	it("正在分析的項目直接連到可同步進度的 query URL", () => {
		expect(getHistoryHref({ id: "job A/1", status: "analyzing" })).toBe(
			"/?jobId=job%20A%2F1",
		);
	});

	it.each(["completed", "error"] as const)(
		"%s 項目連到分析結果的 query URL",
		(status) => {
			expect(getHistoryHref({ id: "job A/1", status })).toBe(
				"/analysis?id=job%20A%2F1",
			);
		},
	);
});
