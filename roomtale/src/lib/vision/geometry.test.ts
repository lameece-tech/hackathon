import { describe, expect, it } from "vitest";
import { assignFaces, avatarCropForFace, estimateHead, faceTiles, fitSquare, headSearchRegion, iou, sameFace, suppress, toNorm } from "./geometry";

const W = 1920;
const H = 1080;

describe("geometry", () => {
  it("computes IoU", () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 })).toBe(0);
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(50 / 150);
  });

  it("keeps squares inside the frame without shrinking them", () => {
    const sq = fitSquare(10, 10, 200, W, H);
    expect(sq).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    const edge = fitSquare(W - 5, H - 5, 300, W, H);
    expect(edge.x + edge.w).toBe(W);
    expect(edge.y + edge.h).toBe(H);
  });

  it("puts the avatar crop around the face with headroom", () => {
    const face = { x: 900, y: 300, w: 100, h: 120 };
    const crop = avatarCropForFace(face, W, H);
    expect(crop.w).toBe(crop.h);
    expect(crop.w).toBeCloseTo(120 * 1.9);
    expect(crop.y + crop.h / 2).toBeLessThan(face.y + face.h / 2);
  });

  it("searches the top of a person box for the face", () => {
    const person = { x: 800, y: 200, w: 300, h: 800 };
    const region = headSearchRegion(person, W, H);
    expect(region.y).toBeLessThanOrEqual(person.y);
    expect(region.y + region.h).toBeLessThan(person.y + person.h * 0.6);
    expect(region.x).toBeLessThan(person.x);
  });

  it("estimates a head square inside the person box", () => {
    const person = { x: 800, y: 200, w: 300, h: 800 };
    const head = estimateHead(person, W, H);
    expect(head.w).toBe(head.h);
    expect(head.x).toBeGreaterThanOrEqual(person.x);
    expect(head.y).toBeGreaterThanOrEqual(person.y);
  });

  it("assigns each face to the person it sits on, one each", () => {
    const left = { x: 100, y: 200, w: 300, h: 800 };
    const right = { x: 1200, y: 250, w: 300, h: 780 };
    const faces = [
      { x: 1300, y: 290, w: 90, h: 110 }, // right person's face
      { x: 200, y: 240, w: 90, h: 110 }, // left person's face
      { x: 210, y: 600, w: 80, h: 80 }, // a face on a T-shirt, lower on the left person
    ];
    const pairs = assignFaces([left, right], faces, W, H);
    expect(pairs.get(0)).toBe(1);
    expect(pairs.get(1)).toBe(0);
    expect(pairs.size).toBe(2);
  });

  it("suppresses overlapping detections by score", () => {
    const kept = suppress([
      { box: { x: 0, y: 0, w: 100, h: 100 }, score: 0.6, value: "a" },
      { box: { x: 5, y: 5, w: 100, h: 100 }, score: 0.9, value: "b" },
      { box: { x: 500, y: 0, w: 100, h: 100 }, score: 0.5, value: "c" },
    ]);
    expect(kept.map((k) => k.value)).toEqual(["b", "c"]);
  });

  it("treats a coarse box around a tight face box as the same face", () => {
    const tight = { x: 100, y: 100, w: 60, h: 70 };
    expect(sameFace(tight, { x: 70, y: 60, w: 160, h: 170 })).toBe(true);
    expect(sameFace(tight, { x: 105, y: 102, w: 58, h: 70 })).toBe(true);
    expect(sameFace(tight, { x: 300, y: 100, w: 60, h: 70 })).toBe(false);
  });

  it("tiles the whole frame with overlapping squares", () => {
    const tiles = faceTiles(W, H);
    const size = Math.round(H * 0.45);
    expect(tiles.every((t) => t.w === size && t.h === size && t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H)).toBe(true);
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBe(W);
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBe(H);
    // Every point is covered, so no face falls in a gap between tiles.
    for (const p of [{ x: 0, y: 0 }, { x: 960, y: 540 }, { x: W - 1, y: H - 1 }, { x: 700, y: 1000 }]) {
      expect(tiles.some((t) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h)).toBe(true);
    }
  });

  it("normalizes to 0–1 frame coordinates", () => {
    expect(toNorm({ x: 960, y: 540, w: 192, h: 108 }, W, H)).toEqual({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
  });
});
