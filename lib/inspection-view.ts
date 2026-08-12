import type { GraphViewData } from "./graph-view";

/** The graph view that supplied the current sidebar inspection selection. */
export type InspectionViewSource =
	| { kind: "main" }
	| { kind: "panel"; index: number }
	| { kind: "difference" };

export interface InspectionViewInputs {
	main: GraphViewData;
	panels?: readonly GraphViewData[] | null;
	difference?: GraphViewData | null;
}

/**
 * Safely resolve the data view that owns an inspection selection. Panel indexes
 * are zero-based and invalid indexes deliberately resolve to null.
 */
export function resolveInspectionView(
	source: InspectionViewSource | null,
	{ main, panels, difference }: InspectionViewInputs,
): GraphViewData | null {
	if (!source) return null;
	if (source.kind === "main") return main;
	if (source.kind === "difference") return difference ?? null;
	if (!Number.isInteger(source.index) || source.index < 0) return null;
	return panels?.[source.index] ?? null;
}
