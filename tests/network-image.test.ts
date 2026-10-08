import { afterEach, describe, expect, it, vi } from "vitest";
import type { Network } from "vis-network";
import { captureNetworkImage, imageExportScale } from "../lib/network-image";

afterEach(() => vi.unstubAllGlobals());

describe("high-resolution network export", () => {
	it("uses 4x pixels and caps large allocations", () => {
		expect(imageExportScale(800, 500)).toBe(4);
		for (const [w, h] of [[2000, 2000], [5000, 300], [300, 5000]]) {
			const scale = imageExportScale(w, h);
			expect(Math.max(w, h) * scale).toBeLessThanOrEqual(4096);
			expect(w * h * scale ** 2).toBeLessThanOrEqual(8_000_001);
		}
	});

	it.each([false, true])("restores display backing size and DPR (encoding failure: %s)", (fail) => {
		const source = { width: 1600, height: 1000, clientWidth: 800, clientHeight: 500 };
		const canvas = { pixelRatio: 2, frame: { canvas: source } };
		const draws: number[][] = [];
		const renderer = { _redraw: () => draws.push([source.width, source.height, canvas.pixelRatio]) };
		const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
		const output = {
			width: 0, height: 0, getContext: () => ctx,
			toDataURL: () => { if (fail) throw new Error("encoding failed"); return "data:image/png;base64,test"; },
		};
		vi.stubGlobal("document", { createElement: () => output });
		const capture = () => captureNetworkImage({ canvas, renderer } as unknown as Network);
		if (fail) expect(capture).toThrow("encoding failed");
		else expect(capture()).toBe("data:image/png;base64,test");
		expect(draws).toEqual([[3200, 2000, 4], [1600, 1000, 2]]);
		expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0);
		expect(source.width).toBe(1600);
		expect(source.height).toBe(1000);
		expect(canvas.pixelRatio).toBe(2);
	});
});
