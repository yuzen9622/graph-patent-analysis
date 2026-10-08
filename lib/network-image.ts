import type { Network } from "vis-network";

export const IMAGE_EXPORT_SCALE = 4;

/** Bound allocations for large displays while retaining the current viewport. */
export function imageExportScale(width: number, height: number): number {
	return Math.min(
		IMAGE_EXPORT_SCALE,
		4096 / Math.max(width, height),
		Math.sqrt(8_000_000 / (width * height)),
	);
}

/**
 * Redraw at export resolution instead of enlarging the screen bitmap.
 * vis-network 10's public redraw() calls setSize(), which resets pixelRatio to
 * the display DPR. Keep this private API adapter isolated and restore in finally.
 * CSS size, camera, node positions, selection and hidden elements stay unchanged.
 */
export function captureNetworkImage(network: Network): string | null {
	const internal = network as unknown as {
		canvas?: {
			pixelRatio: number;
			frame: { canvas: HTMLCanvasElement };
		};
		renderer?: { _redraw: () => void };
	};
	const canvas = internal.canvas;
	const renderer = internal.renderer;
	const source = canvas?.frame.canvas;
	if (!canvas || !renderer || !source) return null;
	const width = source.clientWidth;
	const height = source.clientHeight;
	if (width <= 0 || height <= 0) return null;

	const original = { width: source.width, height: source.height, ratio: canvas.pixelRatio };
	const scale = imageExportScale(width, height);
	const output = document.createElement("canvas");
	output.width = Math.floor(width * scale);
	output.height = Math.floor(height * scale);
	const ctx = output.getContext("2d");
	if (!ctx) return null;

	try {
		canvas.pixelRatio = scale;
		source.width = output.width;
		source.height = output.height;
		renderer._redraw();
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, output.width, output.height);
		ctx.drawImage(source, 0, 0);
		const dataUrl = output.toDataURL("image/png");
		if (dataUrl === "data:,") throw new Error("無法建立匯出圖片");
		return dataUrl;
	} finally {
		canvas.pixelRatio = original.ratio;
		source.width = original.width;
		source.height = original.height;
		renderer._redraw();
	}
}
