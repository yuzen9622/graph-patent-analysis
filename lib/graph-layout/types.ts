export const LAYOUT_VERSION = "compatible-bh-v1";
export const LAYOUT_OPTIONS = Object.freeze({
	ticks: 1500,
	largeGraph: 120,
	strengthLarge: -80,
	strengthSmall: -150,
	theta: 0.9,
	distanceMin: 1,
	central: 0.003,
	spring: 0.04,
	restLarge: 150,
	restSmall: 250,
	damping: 0.5,
	dt: 0.5,
	maxVelocity: 50,
	collisionPasses: 32,
	collisionGap: 2,
	maxCoordinate: 1e7,
});
export interface LayoutInput {
	readonly nodeIds: readonly string[];
	readonly radii: Float64Array;
	readonly initial: Float64Array;
	readonly edges: Uint32Array;
	readonly fingerprint: string;
}
export interface CompletedLayout {
	fingerprint: string;
	positions: Float64Array;
	reason: "iteration-budget" | "trivial";
	diagnostics: { ticks: number; collisionPasses: number; expansion: number };
}
export type LayoutSource = "computed" | "memory" | "storage";
export type LayoutOutcome =
	| { status: "ready"; layout: CompletedLayout; source: LayoutSource }
	| { status: "cancelled" }
	| { status: "failed"; error: string };
export interface LayoutCache {
	get(
		input: LayoutInput,
	): { layout: CompletedLayout; source: "memory" | "storage" } | null;
	put(input: LayoutInput, layout: CompletedLayout): void;
}
