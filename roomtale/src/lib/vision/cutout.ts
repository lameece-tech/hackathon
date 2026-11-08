import type { PixelBox } from "./geometry";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Mask confidence → alpha: drops background haze below 0.35 and keeps a soft edge up to 0.65. */
export function maskAlpha(v: number): number {
  return clamp01((v - 0.35) / 0.3);
}

/** Bounding box of mask pixels above `threshold`, or null when the mask is empty. */
export function maskBounds(mask: ArrayLike<number>, width: number, height: number, threshold = 0.5): PixelBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 1 for mask pixels within `radius` of the silhouette's edge: the outline drawn on the capture screen. */
export function edgeMap(mask: ArrayLike<number>, width: number, height: number, threshold = 0.5, radius = 2): Uint8Array {
  const out = new Uint8Array(width * height);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] >= threshold;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - radius, y) || !inside(x + radius, y) || !inside(x, y - radius) || !inside(x, y + radius)) out[y * width + x] = 1;
    }
  }
  return out;
}

/** Nearest-neighbour resample, for masks that come back at a different size than their image. */
export function resampleMask(mask: ArrayLike<number>, w: number, h: number, toW: number, toH: number): Float32Array {
  const out = new Float32Array(toW * toH);
  for (let y = 0; y < toH; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / toH));
    for (let x = 0; x < toW; x++) out[y * toW + x] = mask[sy * w + Math.min(w - 1, Math.floor((x * w) / toW))];
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface Cutout {
  /** The person on a transparent background, trimmed to their silhouette. */
  cutout: string;
  /** Their silhouette edge in `color`, same size and placement as the cutout. */
  outline: string;
  /** Where the trimmed cutout sits in the source canvas, in its pixels. */
  bounds: PixelBox;
}

/**
 * Cuts the masked subject out of `source` (a crop the same size as the mask, or resampled to
 * it), trims to the silhouette with a little padding, and draws the matching outline.
 */
export function renderCutout(source: HTMLCanvasElement, mask: ArrayLike<number>, maskW: number, maskH: number, color: string): Cutout | null {
  const W = source.width;
  const H = source.height;
  const m = maskW === W && maskH === H ? mask : resampleMask(mask, maskW, maskH, W, H);
  const tight = maskBounds(m, W, H);
  if (!tight || tight.w < 8 || tight.h < 8) return null;

  const pad = Math.round(Math.max(tight.w, tight.h) * 0.03);
  const x0 = Math.max(0, tight.x - pad);
  const y0 = Math.max(0, tight.y - pad);
  const bounds = { x: x0, y: y0, w: Math.min(W, tight.x + tight.w + pad) - x0, h: Math.min(H, tight.y + tight.h + pad) - y0 };

  const sctx = source.getContext("2d");
  if (!sctx) return null;
  const pixels = sctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
  const edges = edgeMap(m, W, H, 0.5, Math.max(2, Math.round(Math.min(W, H) / 220)));
  const line = new ImageData(bounds.w, bounds.h);
  const [r, g, b] = hexToRgb(color);
  for (let y = 0; y < bounds.h; y++) {
    for (let x = 0; x < bounds.w; x++) {
      const si = (bounds.y + y) * W + bounds.x + x;
      const di = (y * bounds.w + x) * 4;
      pixels.data[di + 3] = Math.round(maskAlpha(m[si]) * 255);
      if (edges[si]) {
        line.data[di] = r;
        line.data[di + 1] = g;
        line.data[di + 2] = b;
        line.data[di + 3] = 255;
      }
    }
  }

  const encode = (data: ImageData) => {
    const c = document.createElement("canvas");
    c.width = data.width;
    c.height = data.height;
    c.getContext("2d")!.putImageData(data, 0, 0);
    // WebP keeps alpha at a fraction of PNG's size; browsers without WebP encoding fall back to PNG.
    return c.toDataURL("image/webp", 0.9);
  };
  return { cutout: encode(pixels), outline: encode(line), bounds };
}
