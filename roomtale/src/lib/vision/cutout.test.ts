import { describe, expect, it } from "vitest";
import { edgeMap, maskAlpha, maskBounds, resampleMask } from "./cutout";

/** A w×h mask with a filled rectangle. */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Float32Array {
  const m = new Float32Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
}

describe("cutout masks", () => {
  it("turns confidence into a soft alpha", () => {
    expect(maskAlpha(0.2)).toBe(0);
    expect(maskAlpha(0.5)).toBeCloseTo(0.5);
    expect(maskAlpha(0.9)).toBe(1);
  });

  it("finds the silhouette's bounds", () => {
    expect(maskBounds(rect(20, 10, 4, 2, 9, 8), 20, 10)).toEqual({ x: 4, y: 2, w: 5, h: 6 });
    expect(maskBounds(new Float32Array(100), 10, 10)).toBeNull();
  });

  it("marks only the rim of the silhouette", () => {
    const w = 20;
    const edges = edgeMap(rect(w, 20, 5, 5, 15, 15), w, 20, 0.5, 2);
    expect(edges[5 * w + 10]).toBe(1); // top rim
    expect(edges[10 * w + 5]).toBe(1); // left rim
    expect(edges[10 * w + 10]).toBe(0); // deep inside
    expect(edges[2 * w + 2]).toBe(0); // outside
  });

  it("resamples a mask to its image's size", () => {
    const small = rect(4, 4, 2, 0, 4, 4);
    const big = resampleMask(small, 4, 4, 8, 8);
    expect(big[0]).toBe(0);
    expect(big[7]).toBe(1);
    expect(big.length).toBe(64);
  });
});
