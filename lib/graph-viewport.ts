export interface GraphViewport {
	position: {
		x: number;
		y: number;
	};
	scale: number;
}

/**
 * 比較模式左右同步用：兩個 viewport 在容差內視為相同。
 * 判等後就不再往外轉發，這是避免 A→B→A 無限來回的關鍵。
 */
export function graphViewportsEqual(
	a: GraphViewport | null | undefined,
	b: GraphViewport | null | undefined,
	epsilon = 1e-3,
): boolean {
	if (!isValidGraphViewport(a) || !isValidGraphViewport(b)) return false;
	return (
		Math.abs(a.position.x - b.position.x) <= epsilon &&
		Math.abs(a.position.y - b.position.y) <= epsilon &&
		Math.abs(a.scale - b.scale) <= epsilon
	);
}

export function isValidGraphViewport(
	viewport: GraphViewport | null | undefined,
): viewport is GraphViewport {
	return Boolean(
		viewport &&
			Number.isFinite(viewport.position.x) &&
			Number.isFinite(viewport.position.y) &&
			Number.isFinite(viewport.scale) &&
			viewport.scale > 0,
	);
}
