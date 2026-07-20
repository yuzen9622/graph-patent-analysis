export interface GraphViewport {
  position: {
    x: number
    y: number
  }
  scale: number
}

export function isValidGraphViewport(
  viewport: GraphViewport | null | undefined,
): viewport is GraphViewport {
  return Boolean(
    viewport
      && Number.isFinite(viewport.position.x)
      && Number.isFinite(viewport.position.y)
      && Number.isFinite(viewport.scale)
      && viewport.scale > 0,
  )
}
