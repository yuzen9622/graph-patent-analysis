import type { CSSProperties } from "react";

/** Saved and computed graph data supplies the value for the graph-swatch utility. */
export function graphSwatch(color: string): CSSProperties {
  return { "--graph-swatch": color } as CSSProperties;
}
