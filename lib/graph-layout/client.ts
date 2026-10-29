import { graphLayoutCache } from "./cache";
import { validateLayout } from "./geometry";
import type {
	LayoutInput,
	LayoutOutcome,
	LayoutCache,
	CompletedLayout,
} from "./types";
export interface WorkerLike {
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	postMessage(value: unknown): void;
	terminate(): void;
}
let requestSequence = 0;
export function startGraphLayout(
	input: LayoutInput,
	{
		createWorker = () =>
			new Worker(new URL("./layout.worker.ts", import.meta.url), {
				type: "module",
			}),
		cache = graphLayoutCache,
	}: { createWorker?: () => WorkerLike; cache?: LayoutCache } = {},
): { result: Promise<LayoutOutcome>; cancel: () => void } {
	let settled = false,
		worker: WorkerLike | undefined,
		timer: ReturnType<typeof setTimeout> | undefined;
	let resolve!: (outcome: LayoutOutcome) => void;
	const result = new Promise<LayoutOutcome>((r) => {
		resolve = r;
	});
	const settle = (outcome: LayoutOutcome) => {
		if (settled) return;
		settled = true;
		if (timer !== undefined) clearTimeout(timer);
		worker?.terminate();
		resolve(outcome);
	};
	const cancel = () => settle({ status: "cancelled" });
	const requestId = ++requestSequence;
	try {
		const hit = cache.get(input);
		if (hit) {
			settle({ status: "ready", ...hit });
			return { result, cancel };
		}
		if (input.nodeIds.length < 2) {
			const layout: CompletedLayout = {
				fingerprint: input.fingerprint,
				positions: input.initial.slice(),
				reason: "trivial",
				diagnostics: { ticks: 0, collisionPasses: 0, expansion: 1 },
			};
			if (!validateLayout(input, layout))
				throw Error("Invalid trivial geometry");
			cache.put(input, layout);
			settle({ status: "ready", layout, source: "computed" });
			return { result, cancel };
		}
		worker = createWorker();
		worker.onmessage = (event) => {
			if (settled || !event.data || event.data.requestId !== requestId) return;
			if (!validateLayout(input, event.data.layout)) {
				settle({ status: "failed", error: "Invalid worker layout" });
				return;
			}
			const layout = event.data.layout;
			cache.put(input, layout);
			settle({ status: "ready", layout, source: "computed" });
		};
		worker.onerror = (event) =>
			settle({
				status: "failed",
				error: event.message || "Layout worker error",
			});
		worker.onmessageerror = () =>
			settle({ status: "failed", error: "Layout worker message error" });
		timer = setTimeout(
			() => settle({ status: "failed", error: "Layout worker timed out" }),
			15000,
		);
		worker.postMessage({ requestId, input });
	} catch (error) {
		settle({
			status: "failed",
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return { result, cancel };
}
