import type { Detection, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseLandmark, Subject, SubjectKind } from "@/lib/story/types";
import { avatarDataUrl, crop, scaleDown } from "./capture";
import { renderCutout } from "./cutout";
import { loadDeepLab, loadDetectors, loadPose } from "./detectors";
import {
  assignFaces,
  avatarCropForFace,
  bodyFromFace,
  centerOf,
  clampBox,
  estimateHead,
  faceTiles,
  estimatePetHead,
  headSearchRegion,
  sameFace,
  scaleBox,
  suppress,
  toNorm,
  type PixelBox,
  type Scored,
} from "./geometry";

const DETECT_MAX_SIDE = 1280;
const HEAD_CROP_MAX_SIDE = 512;
const MAX_SUBJECTS = 8;
const MIN_SCORE: Record<SubjectKind, number> = { person: 0.4, dog: 0.45, cat: 0.45 };
/** Smaller than this (fraction of frame height) is a poster, a photo, or someone in the hallway. */
const MIN_BODY_HEIGHT = 0.12;
const MIN_FACE_HEIGHT = 0.025;
/** Tiles multiply the chances of a false face, so they need more confidence than the head-region search. */
const MIN_TILE_FACE_SCORE = 0.65;
/** A face with no body behind it becomes a person on its own word, so it must be surer still. */
const MIN_NEW_PERSON_FACE_SCORE = 0.8;

function pixelBox(d: Detection): PixelBox | null {
  const b = d.boundingBox;
  return b && b.width > 0 && b.height > 0 ? { x: b.originX, y: b.originY, w: b.width, h: b.height } : null;
}

interface Body {
  kind: SubjectKind;
  box: PixelBox;
  score: number;
  face: PixelBox | null;
}

/**
 * Finds everyone in a captured frame and crops their avatars.
 *
 * 1. People and pets on a downscaled frame (EfficientDet-Lite0, COCO classes).
 * 2. For each person, a face search inside their head region at full resolution. BlazeFace
 *    short-range is built for faces within ~2m; cropping to the head region makes a face
 *    across the room look close to it.
 * 3. A face pass over the downscaled frame and overlapping full-resolution tiles, for anyone
 *    the body detector missed or merged: cut off by the frame edge, or a kid on a lap.
 * 4. For each of the largest eight (ordered left to right, ids p1…/pet1…): a square face
 *    crop, and a full-body cutout, outline and pose skeleton from that subject's own crop.
 */
export async function extractSubjects(frame: HTMLCanvasElement): Promise<Subject[]> {
  const { faces, bodies } = await loadDetectors();
  const W = frame.width;
  const H = frame.height;

  // Pass 1: bodies.
  const { canvas: small, scale } = scaleDown(frame, DETECT_MAX_SIDE);
  const found: Scored<SubjectKind>[] = [];
  for (const d of bodies.detect(small).detections) {
    const top = d.categories[0];
    const box = pixelBox(d);
    const kind = top?.categoryName as SubjectKind;
    if (!box || !(kind in MIN_SCORE) || top.score < MIN_SCORE[kind]) continue;
    const full = scaleBox(box, 1 / scale);
    if (full.h / H < MIN_BODY_HEIGHT) continue;
    found.push({ box: full, score: top.score, value: kind });
  }
  const list: Body[] = suppress(found, 0.6).map((s) => ({ kind: s.value, box: s.box, score: s.score, face: null }));

  // Pass 2: a face inside each person's head region, at full resolution.
  for (const body of list) {
    if (body.kind !== "person") continue;
    const region = headSearchRegion(body.box, W, H);
    if (region.w < 16 || region.h < 16) continue;
    const { canvas, scale: k } = crop(frame, region, HEAD_CROP_MAX_SIDE);
    const best = faces
      .detect(canvas)
      .detections.map((d) => ({ box: pixelBox(d), score: d.categories[0]?.score ?? 0 }))
      .filter((f): f is { box: PixelBox; score: number } => f.box !== null)
      .sort((a, b) => b.score - a.score)[0];
    if (best) {
      const b = scaleBox(best.box, 1 / k);
      body.face = { x: region.x + b.x, y: region.y + b.y, w: b.w, h: b.h };
    }
  }

  // Pass 3: faces anywhere, from the downscaled frame (close-ups) and full-resolution tiles
  // (across the room). Each new face goes to a person still missing one, or becomes a person:
  // a kid on a lap shares one body box with the grown-up holding them.
  const found3: Scored<null>[] = [];
  const collect = (source: HTMLCanvasElement | HTMLVideoElement, offset: { x: number; y: number }, k: number) => {
    for (const d of faces.detect(source).detections) {
      const box = pixelBox(d);
      const score = d.categories[0]?.score ?? 0;
      if (!box || score < MIN_TILE_FACE_SCORE) continue;
      const b = scaleBox(box, 1 / k);
      found3.push({ box: { x: offset.x + b.x, y: offset.y + b.y, w: b.w, h: b.h }, score, value: null });
    }
  };
  collect(small, { x: 0, y: 0 }, scale);
  for (const tile of faceTiles(W, H)) {
    const { canvas, scale: k } = crop(frame, tile, HEAD_CROP_MAX_SIDE);
    collect(canvas, tile, k);
  }
  const extraFaces: Scored<null>[] = [];
  for (const f of found3.sort((a, b) => b.score - a.score)) {
    if (f.box.h / H < MIN_FACE_HEIGHT) continue;
    if (extraFaces.some((e) => sameFace(e.box, f.box)) || list.some((body) => body.face && sameFace(body.face, f.box))) continue;
    extraFaces.push(f);
  }
  const faceless = list.filter((b) => b.kind === "person" && !b.face);
  const pairs = assignFaces(faceless.map((b) => b.box), extraFaces.map((f) => f.box), W, H);
  const usedFaces = new Set<number>();
  pairs.forEach((fi, pi) => {
    faceless[pi].face = extraFaces[fi].box;
    usedFaces.add(fi);
  });
  extraFaces.forEach((f, fi) => {
    if (usedFaces.has(fi) || f.score < MIN_NEW_PERSON_FACE_SCORE) return;
    list.push({ kind: "person", box: bodyFromFace(f.box, W, H), score: f.score, face: f.box });
  });

  // Keep the biggest (closest) subjects, then order left to right for stable ids.
  const kept = list
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .slice(0, MAX_SUBJECTS)
    .sort((a, b) => centerOf(a.box).x - centerOf(b.box).x);

  // Pass 4: full bodies. Pose + mask per person, DeepLab per pet, each on its own crop.
  const [pose, deeplab] = await Promise.all([loadPose().catch(() => null), loadDeepLab().catch(() => null)]);

  let people = 0;
  let pets = 0;
  return kept.map((b, i) => {
    const color = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
    const head = b.face
      ? avatarCropForFace(b.face, W, H)
      : b.kind === "person"
        ? estimateHead(b.box, W, H)
        : estimatePetHead(b.box, W, H);
    const body = fullBody(frame, b, color, pose, deeplab);
    return {
      id: b.kind === "person" ? `p${++people}` : `pet${++pets}`,
      kind: b.kind,
      color,
      box: toNorm(b.box, W, H),
      face: b.face ? toNorm(b.face, W, H) : null,
      avatar: avatarDataUrl(frame, head),
      cutout: body?.cutout ?? null,
      outline: body?.outline ?? null,
      cutoutBox: body ? toNorm(body.box, W, H) : null,
      pose: body?.pose ?? null,
      score: Math.round(b.score * 100) / 100,
    };
  });
}

export const SUBJECT_COLORS = ["#22D3EE", "#A78BFA", "#FBBF24", "#F472B6", "#4ADE80", "#FB923C", "#60A5FA", "#F87171"];

const BODY_CROP_MAX_SIDE = 768;

interface FullBody {
  cutout: string;
  outline: string;
  /** Where the cutout sits, in frame pixels. */
  box: PixelBox;
  pose: PoseLandmark[] | null;
}

/**
 * Cuts one subject out of the frame. The crop is centred on them, so the single-pose model
 * locks onto them rather than whoever shares their sofa; its mask is that person alone.
 */
function fullBody(frame: HTMLCanvasElement, b: Body, color: string, pose: PoseLandmarker | null, deeplab: ImageSegmenter | null): FullBody | null {
  const W = frame.width;
  const H = frame.height;
  const padX = b.box.w * 0.12;
  const padY = b.box.h * 0.06;
  const region = clampBox({ x: b.box.x - padX, y: b.box.y - padY, w: b.box.w + padX * 2, h: b.box.h + padY * 2 }, W, H);
  if (region.w < 24 || region.h < 24) return null;
  const { canvas, scale: k } = crop(frame, region, BODY_CROP_MAX_SIDE);

  let mask: Float32Array | null = null;
  let maskW = 0;
  let maskH = 0;
  let landmarks: PoseLandmark[] | null = null;

  try {
    if (b.kind === "person" && pose) {
      const result = pose.detect(canvas);
      try {
        const lm = result.landmarks[0];
        if (lm) landmarks = lm.map((p) => ({ x: (region.x + p.x * region.w) / W, y: (region.y + p.y * region.h) / H, v: p.visibility ?? 1 }));
        const m = result.segmentationMasks?.[0];
        if (m) {
          mask = m.getAsFloat32Array().slice();
          maskW = m.width;
          maskH = m.height;
        }
      } finally {
        result.close();
      }
    } else if (b.kind !== "person" && deeplab) {
      const result = deeplab.segment(canvas);
      try {
        const target = deeplab.getLabels().indexOf(b.kind);
        const m = result.categoryMask;
        if (m && target >= 0) {
          const categories = m.getAsUint8Array();
          mask = Float32Array.from(categories, (c) => (c === target ? 1 : 0));
          maskW = m.width;
          maskH = m.height;
        }
      } finally {
        result.close();
      }
    }
  } catch (err) {
    console.warn(`[roomtale] body mask failed for a ${b.kind}`, err);
  }

  if (!mask) return null;
  const cut = renderCutout(canvas, mask, maskW, maskH, color);
  if (!cut) return null;
  return {
    cutout: cut.cutout,
    outline: cut.outline,
    box: { x: region.x + cut.bounds.x / k, y: region.y + cut.bounds.y / k, w: cut.bounds.w / k, h: cut.bounds.h / k },
    pose: landmarks,
  };
}

export interface Presence {
  people: number;
  pets: number;
}

/** A cheap headcount for the idle screen (and it warms the models before the real capture). */
export async function countPresence(video: HTMLVideoElement): Promise<Presence> {
  if (!video.videoWidth) return { people: 0, pets: 0 };
  const { bodies } = await loadDetectors();
  const { canvas } = scaleDown(video, 480);
  const result = bodies.detect(canvas);
  let people = 0;
  let pets = 0;
  for (const d of result.detections) {
    const top = d.categories[0];
    if (!top || top.score < MIN_SCORE[top.categoryName as SubjectKind]) continue;
    if (top.categoryName === "person") people++;
    else pets++;
  }
  return { people, pets };
}
