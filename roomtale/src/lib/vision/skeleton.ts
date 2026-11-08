import type { PoseLandmark } from "@/lib/story/types";

// BlazePose body landmarks (the face points 1–10 are left out: too dense to read from a sofa).
const NOSE = 0;
const L_SHOULDER = 11;
const R_SHOULDER = 12;

/** Limb segments as landmark index pairs. */
export const SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [27, 31], // left leg
  [24, 26], [26, 28], [28, 32], // right leg
];

export const SKELETON_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const MIN_VISIBILITY = 0.5;

export interface Segment {
  a: PoseLandmark;
  b: PoseLandmark;
}

/** The visible limb segments, plus a neck from the shoulders' midpoint to the nose. */
export function visibleSegments(pose: PoseLandmark[]): Segment[] {
  const seen = (i: number) => pose[i] && pose[i].v >= MIN_VISIBILITY;
  const segments: Segment[] = SKELETON_EDGES.filter(([a, b]) => seen(a) && seen(b)).map(([a, b]) => ({ a: pose[a], b: pose[b] }));
  if (seen(NOSE) && seen(L_SHOULDER) && seen(R_SHOULDER)) {
    const l = pose[L_SHOULDER];
    const r = pose[R_SHOULDER];
    segments.push({ a: { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, v: 1 }, b: pose[NOSE] });
  }
  return segments;
}

export function visibleJoints(pose: PoseLandmark[]): PoseLandmark[] {
  return SKELETON_JOINTS.map((i) => pose[i]).filter((p): p is PoseLandmark => Boolean(p) && p.v >= MIN_VISIBILITY);
}
