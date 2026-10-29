import { computeGraphLayout } from "./compute";
import type { LayoutInput } from "./types";
// SAFETY: This module is only instantiated as a dedicated Worker, not a Window.
const worker = self as unknown as {
	onmessage:
		| ((event: MessageEvent<{ requestId: number; input: LayoutInput }>) => void)
		| null;
	postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = (
	event: MessageEvent<{ requestId: number; input: LayoutInput }>,
) => {
	const { requestId, input } = event.data;
	try {
		const layout = computeGraphLayout(input);
		worker.postMessage({ requestId, layout }, [
			layout.positions.buffer as ArrayBuffer,
		]);
	} catch (error) {
		worker.postMessage({
			requestId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
