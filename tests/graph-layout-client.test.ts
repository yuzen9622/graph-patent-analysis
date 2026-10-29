import { afterEach, describe, expect, it, vi } from "vitest";
import { startGraphLayout, type WorkerLike } from "../lib/graph-layout/client";
import { createLayoutCache } from "../lib/graph-layout/cache";
import { buildLayoutInput } from "../lib/graph-layout/input";
import type { LayoutInput } from "../lib/graph-layout/types";
import { computeGraphLayout } from "../lib/graph-layout/compute";
const input = () =>
	buildLayoutInput(
		["a", "b"].map((id) => ({
			id,
			type: "concept",
			label: "",
			color: "",
			size: 10,
		})),
		[],
	);
class WorkerStub implements WorkerLike {
	onmessage: WorkerLike["onmessage"] = null;
	onerror: WorkerLike["onerror"] = null;
	onmessageerror: WorkerLike["onmessageerror"] = null;
	terminate = vi.fn();
	request!: { input: LayoutInput; requestId: number };
	postMessage(value: unknown) {
		this.request = value as typeof this.request;
	}
	reply(
		layout: unknown = computeGraphLayout(this.request.input),
		requestId = this.request.requestId,
	) {
		this.onmessage?.({ data: { requestId, layout } } as MessageEvent);
	}
}
afterEach(() => vi.useRealTimers());
describe("layout worker lifecycle", () => {
	it("runs real compute, caches success and terminates exactly once", async () => {
		const w = new WorkerStub(),
			cache = createLayoutCache(() => undefined),
			a = input();
		const task = startGraphLayout(a, { createWorker: () => w, cache });
		w.reply();
		expect((await task.result).status).toBe("ready");
		task.cancel();
		w.reply();
		expect(w.terminate).toHaveBeenCalledTimes(1);
		expect(cache.get(a)?.source).toBe("memory");
	});
	it("ignores mismatched reply, cancellation is idempotent and late work cannot cache", async () => {
		const w = new WorkerStub(),
			cache = createLayoutCache(() => undefined),
			a = input();
		const task = startGraphLayout(a, { createWorker: () => w, cache });
		w.reply(undefined, -1);
		task.cancel();
		task.cancel();
		w.reply();
		expect(await task.result).toEqual({ status: "cancelled" });
		expect(cache.get(a)).toBeNull();
		expect(w.terminate).toHaveBeenCalledTimes(1);
	});
	it.each(["error", "messageerror", "invalid", "timeout"])(
		"fails explicitly on %s",
		async (kind) => {
			vi.useFakeTimers();
			const w = new WorkerStub();
			const task = startGraphLayout(input(), {
				createWorker: () => w,
				cache: createLayoutCache(() => undefined),
			});
			if (kind === "error") w.onerror?.({ message: "failure" } as ErrorEvent);
			if (kind === "messageerror") w.onmessageerror?.({} as MessageEvent);
			if (kind === "invalid") w.reply({ positions: new Float64Array(0) });
			if (kind === "timeout") vi.advanceTimersByTime(15000);
			expect((await task.result).status).toBe("failed");
			expect(w.terminate).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		},
	);
	it("handles constructor failures", async () => {
		const task = startGraphLayout(input(), {
			createWorker: () => {
				throw Error("constructor");
			},
			cache: createLayoutCache(() => undefined),
		});
		expect((await task.result).status).toBe("failed");
	});
	it("does not construct worker for trivial graphs or cache hits", async () => {
		const make = vi.fn(() => new WorkerStub()),
			cache = createLayoutCache(() => undefined);
		const a = buildLayoutInput([], []);
		expect(
			(await startGraphLayout(a, { createWorker: make, cache }).result).status,
		).toBe("ready");
		const b = input();
		cache.put(b, computeGraphLayout(b));
		expect(
			(await startGraphLayout(b, { createWorker: make, cache }).result).status,
		).toBe("ready");
		expect(make).not.toHaveBeenCalled();
	});
});
