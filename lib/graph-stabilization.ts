/** Initial hidden simulation budget; reaching it is not proof of convergence. */
export const GRAPH_STABILIZATION_ITERATIONS = 1500;
export const GRAPH_STABILIZATION_TIMEOUT_MS = 30_000;

interface StabilizationEvents {
	on(event: "stabilized", callback: () => void): void;
	off(event: "stabilized", callback: () => void): void;
}

/** Wait for actual convergence, never just stabilizationIterationsDone.
 * The caller may display a bounded, unfinished layout on timeout, but must not
 * save it as a converged layout. Dispose before destroying/replacing a network.
 */
export function waitForGraphStabilization(
	network: StabilizationEvents,
	onComplete: (converged: boolean) => void,
	timeoutMs = GRAPH_STABILIZATION_TIMEOUT_MS,
): () => void {
	let finished = false;
	const dispose = () => {
		finished = true;
		clearTimeout(timer);
		network.off("stabilized", onStabilized);
	};
	const finish = (converged: boolean) => {
		if (finished) return;
		dispose();
		onComplete(converged);
	};
	const onStabilized = () => finish(true);
	const timer = setTimeout(() => finish(false), timeoutMs);
	network.on("stabilized", onStabilized);
	return dispose;
}
