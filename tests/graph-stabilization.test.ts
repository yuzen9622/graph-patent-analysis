import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForGraphStabilization } from "@/lib/graph-stabilization";

function networkEvents() {
	const listeners = new Map<string, Set<() => void>>();
	return {
		on(event: string, callback: () => void) {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event)!.add(callback);
		},
		off(event: string, callback: () => void) {
			listeners.get(event)?.delete(callback);
		},
		emit(event: string) {
			for (const callback of listeners.get(event) ?? []) callback();
		},
	};
}

afterEach(() => vi.useRealTimers());

describe("graph stabilization lifecycle", () => {
	it("does not freeze or cache a layout when the iteration budget runs out", () => {
		vi.useFakeTimers();
		const network = networkEvents();
		const finish = vi.fn();
		waitForGraphStabilization(network, finish);
		network.emit("stabilizationIterationsDone");
		expect(finish).not.toHaveBeenCalled();
		network.emit("stabilized");
		expect(finish).toHaveBeenCalledExactlyOnceWith(true);
		vi.runAllTimers();
		expect(finish).toHaveBeenCalledTimes(1);
	});

	it("reports timeout as unfinished and ignores a later stop-generated event", () => {
		vi.useFakeTimers();
		const network = networkEvents();
		const finish = vi.fn();
		waitForGraphStabilization(network, finish, 1000);
		vi.advanceTimersByTime(1000);
		expect(finish).toHaveBeenCalledExactlyOnceWith(false);
		network.emit("stabilized");
		expect(finish).toHaveBeenCalledTimes(1);
	});

	it("cancels stale callbacks when switching graphs or unmounting", () => {
		vi.useFakeTimers();
		const network = networkEvents();
		const finish = vi.fn();
		const dispose = waitForGraphStabilization(network, finish);
		dispose();
		network.emit("stabilized");
		vi.runAllTimers();
		expect(finish).not.toHaveBeenCalled();
	});
});
