import type { NormBox } from "@/lib/story/types";

/** A box in pixels of some image. */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const area = (b: PixelBox) => Math.max(0, b.w) * Math.max(0, b.h);
export const centerOf = (b: PixelBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function contains(b: PixelBox, p: { x: number; y: number }): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

export function intersection(a: PixelBox, b: PixelBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a: PixelBox, b: PixelBox): number {
  const inter = intersection(a, b);
  return inter === 0 ? 0 : inter / (area(a) + area(b) - inter);
}

/**
 * Two detections of one face: they overlap a lot, or one mostly sits inside the other (a
 * coarse box from a tile around a tight box from the head search, which IoU alone misses).
 */
export function sameFace(a: PixelBox, b: PixelBox): boolean {
  const inter = intersection(a, b);
  return inter > 0 && (iou(a, b) > 0.3 || inter / Math.min(area(a), area(b)) > 0.5);
}

export function clampBox(b: PixelBox, width: number, height: number): PixelBox {
  const x = Math.min(Math.max(0, b.x), width);
  const y = Math.min(Math.max(0, b.y), height);
  return { x, y, w: Math.max(0, Math.min(b.x + b.w, width) - x), h: Math.max(0, Math.min(b.y + b.h, height) - y) };
}

export function scaleBox(b: PixelBox, k: number): PixelBox {
  return { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k };
}

export function toNorm(b: PixelBox, width: number, height: number): NormBox {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return { x: r(b.x / width), y: r(b.y / height), w: r(b.w / width), h: r(b.h / height) };
}

/**
 * Where to look for a face inside a person box: the top ~45%, padded sideways for heads
 * turned or leaning. Searching this crop at full resolution is what finds faces at couch
 * distance, where they are too small for a full-frame pass.
 */
export function headSearchRegion(person: PixelBox, width: number, height: number): PixelBox {
  const padX = person.w * 0.15;
  return clampBox(
    { x: person.x - padX, y: person.y - person.h * 0.05, w: person.w + padX * 2, h: Math.max(person.h * 0.45, person.w * 0.9) },
    width,
    height,
  );
}

/** Square avatar crop around a detected face, with room for hair above and chin below. */
export function avatarCropForFace(face: PixelBox, width: number, height: number, scale = 1.9): PixelBox {
  const side = Math.min(Math.max(face.w, face.h) * scale, width, height);
  const c = centerOf(face);
  return fitSquare(c.x, c.y - face.h * 0.12, side, width, height);
}

/** Best-guess head square when the face detector found nothing (turned away, too small). */
export function estimateHead(person: PixelBox, width: number, height: number): PixelBox {
  const side = Math.min(person.w * 0.55, person.h * 0.32);
  return fitSquare(person.x + person.w / 2, person.y + side * 0.55, side, width, height);
}

/** Head square for a pet: the upper part of its box, where the head usually is. */
export function estimatePetHead(pet: PixelBox, width: number, height: number): PixelBox {
  const side = Math.min(pet.w, pet.h) * 0.8;
  return fitSquare(pet.x + pet.w / 2, pet.y + side / 2, side, width, height);
}

/** A body box for a face with no person box (someone close enough to be cut off by the frame). */
export function bodyFromFace(face: PixelBox, width: number, height: number): PixelBox {
  return clampBox({ x: face.x - face.w, y: face.y - face.h * 0.4, w: face.w * 3, h: face.h * 6 }, width, height);
}

/**
 * Overlapping square tiles covering the frame. BlazeFace short-range sees its input at
 * 128×128, so a 70px face across the room vanishes in a full-frame pass; in a tile under
 * half the frame's short side it is big enough to find.
 */
export function faceTiles(width: number, height: number, fraction = 0.45, overlap = 0.3): PixelBox[] {
  const size = Math.round(Math.min(width, height) * fraction);
  const stride = Math.max(1, Math.round(size * (1 - overlap)));
  const starts = (total: number) => {
    const out: number[] = [];
    for (let p = 0; p + size < total; p += stride) out.push(p);
    out.push(Math.max(0, total - size));
    return [...new Set(out)];
  };
  return starts(height).flatMap((y) => starts(width).map((x) => ({ x, y, w: size, h: size })));
}

/** A square of `side` centered on (cx, cy), slid (not shrunk) to stay inside the image. */
export function fitSquare(cx: number, cy: number, side: number, width: number, height: number): PixelBox {
  const s = Math.min(side, width, height);
  const x = Math.min(Math.max(0, cx - s / 2), width - s);
  const y = Math.min(Math.max(0, cy - s / 2), height - s);
  return { x, y, w: s, h: s };
}

export interface Scored<T> {
  box: PixelBox;
  score: number;
  value: T;
}

/** Greedy non-maximum suppression. */
export function suppress<T>(items: Scored<T>[], threshold = 0.5): Scored<T>[] {
  const kept: Scored<T>[] = [];
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k.box, item.box) < threshold)) kept.push(item);
  }
  return kept;
}

/**
 * Pairs faces with the people they belong to: a face goes to the person whose head region
 * holds its center, nearest that person's estimated head first. One face per person.
 * Returns person index → face index.
 */
export function assignFaces(persons: PixelBox[], faces: PixelBox[], width: number, height: number): Map<number, number> {
  const candidates: Array<{ person: number; face: number; distance: number }> = [];
  persons.forEach((p, pi) => {
    const region = headSearchRegion(p, width, height);
    const head = centerOf(estimateHead(p, width, height));
    faces.forEach((f, fi) => {
      const c = centerOf(f);
      if (contains(region, c)) candidates.push({ person: pi, face: fi, distance: Math.hypot(c.x - head.x, c.y - head.y) });
    });
  });
  const result = new Map<number, number>();
  const usedFaces = new Set<number>();
  for (const c of candidates.sort((a, b) => a.distance - b.distance)) {
    if (result.has(c.person) || usedFaces.has(c.face)) continue;
    result.set(c.person, c.face);
    usedFaces.add(c.face);
  }
  return result;
}
