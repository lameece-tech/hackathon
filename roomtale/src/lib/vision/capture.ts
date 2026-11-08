import type { Snapshot } from "@/lib/engine/machine";
import type { PixelBox } from "./geometry";

type Drawable = HTMLVideoElement | HTMLCanvasElement;

const sizeOf = (src: Drawable) =>
  src instanceof HTMLVideoElement ? { width: src.videoWidth, height: src.videoHeight } : { width: src.width, height: src.height };

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  // Never attached to the document: an off-screen canvas the viewer never sees.
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("2D canvas is unavailable on this screen.");
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

/** The current video frame at the camera's full native resolution, unmirrored. */
export function captureFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const { width, height } = sizeOf(video);
  if (!width || !height) throw new Error("The camera hasn't delivered a frame yet.");
  const [canvas, ctx] = makeCanvas(width, height);
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

/** A copy no larger than `maxSide` on its long edge (returns the source when already small). */
export function scaleDown(src: Drawable, maxSide: number): { canvas: Drawable; scale: number } {
  const { width, height } = sizeOf(src);
  const k = Math.min(1, maxSide / Math.max(width, height));
  if (k === 1) return { canvas: src, scale: 1 };
  const [canvas, ctx] = makeCanvas(width * k, height * k);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return { canvas, scale: k };
}

/** Crops `box` (source pixels) into a new canvas of at most `maxSide`. Returns the scale applied. */
export function crop(src: HTMLCanvasElement, box: PixelBox, maxSide: number): { canvas: HTMLCanvasElement; scale: number } {
  const k = Math.min(1, maxSide / Math.max(box.w, box.h));
  const [canvas, ctx] = makeCanvas(box.w * k, box.h * k);
  ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  return { canvas, scale: k };
}

/** A square avatar JPEG of `box`, resampled to `size`×`size`. */
export function avatarDataUrl(src: HTMLCanvasElement, box: PixelBox, size = 320): string {
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** The frame as sent to the vision model. GPT-4o rescales high-detail images to a 768px short side, so more is wasted upload. */
export function encodeFrame(frame: HTMLCanvasElement, maxSide = 1536, quality = 0.85): Snapshot {
  const { canvas } = scaleDown(frame, maxSide);
  const c = canvas as HTMLCanvasElement;
  return { url: c.toDataURL("image/jpeg", quality), width: c.width, height: c.height };
}
