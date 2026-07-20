import { describe, expect, it } from "vitest";
import { isValidGraphViewport } from "../lib/graph-viewport";

describe("isValidGraphViewport", () => {
  it("接受有限座標與正縮放比例", () => {
    expect(
      isValidGraphViewport({ position: { x: -120.5, y: 80 }, scale: 0.35 }),
    ).toBe(true);
  });

  it.each([
    null,
    { position: { x: Number.NaN, y: 0 }, scale: 1 },
    { position: { x: 0, y: Number.POSITIVE_INFINITY }, scale: 1 },
    { position: { x: 0, y: 0 }, scale: Number.NaN },
    { position: { x: 0, y: 0 }, scale: 0 },
    { position: { x: 0, y: 0 }, scale: -1 },
  ])("拒絕無效或首次載入 viewport：%j", (viewport) => {
    expect(isValidGraphViewport(viewport)).toBe(false);
  });
});
