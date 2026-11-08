import { normalizeScene } from "@/lib/story/schema";
import type {
  CastReference,
  ImageRequest,
  NormBox,
  SceneAnalysisRequest,
  StoryRequest,
  SubjectHint,
  SubjectKind,
  VideoStartRequest,
} from "@/lib/story/types";

export class BadRequest extends Error {}

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const MAX_IMAGE_CHARS = 12_000_000;
const MAX_PROMPT_CHARS = 600;
const MAX_SUBJECTS = 12;
const KINDS: SubjectKind[] = ["person", "dog", "cat"];

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const unit = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN);

function prompt(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new BadRequest("prompt is required.");
  return v.trim().slice(0, MAX_PROMPT_CHARS);
}

function imageDataUrl(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(v)) {
    throw new BadRequest(`${field} must be a base64 JPEG, PNG or WebP data URL under ${MAX_IMAGE_CHARS / 1e6}MB.`);
  }
  return v;
}

function box(v: unknown): NormBox | null {
  if (!isObj(v)) return null;
  const b = { x: unit(v.x), y: unit(v.y), w: unit(v.w), h: unit(v.h) };
  return Object.values(b).some(Number.isNaN) || b.w === 0 || b.h === 0 ? null : b;
}

export function parseSceneRequest(body: unknown): SceneAnalysisRequest {
  if (!isObj(body)) throw new BadRequest("Expected a JSON object.");
  const size = isObj(body.imageSize) ? body.imageSize : {};
  const width = Number(size.width);
  const height = Number(size.height);
  if (!(width > 0 && height > 0)) throw new BadRequest("imageSize.width and imageSize.height are required.");

  const subjects: SubjectHint[] = [];
  for (const s of Array.isArray(body.subjects) ? body.subjects.slice(0, MAX_SUBJECTS) : []) {
    if (!isObj(s) || typeof s.id !== "string" || !/^[a-z]+\d{1,2}$/.test(s.id)) continue;
    const b = box(s.box);
    if (!b || !KINDS.includes(s.kind as SubjectKind)) continue;
    subjects.push({ id: s.id, kind: s.kind as SubjectKind, box: b, hasFace: s.hasFace === true });
  }

  return {
    image: imageDataUrl(body.image, "image"),
    imageSize: { width: Math.round(width), height: Math.round(height) },
    prompt: prompt(body.prompt),
    subjects,
  };
}

export function parseStoryRequest(body: unknown): StoryRequest {
  if (!isObj(body)) throw new BadRequest("Expected a JSON object.");
  return {
    prompt: prompt(body.prompt),
    scene: isObj(body.scene) ? normalizeScene(body.scene) : undefined,
    previousTitle: typeof body.previousTitle === "string" ? body.previousTitle.slice(0, 120) : undefined,
  };
}

/** At most this many on-stage characters (two reference images each) per scene. */
const MAX_CAST = 4;

function parseCast(v: unknown): CastReference[] {
  const cast: CastReference[] = [];
  if (!Array.isArray(v)) return cast;
  for (const c of v.slice(0, MAX_CAST)) {
    if (!isObj(c)) continue;
    cast.push({
      name: String(c.name ?? "").slice(0, 60),
      costume: String(c.costume ?? "").slice(0, 160),
      kind: c.kind === "pet" ? "pet" : "person",
      body: c.body == null ? null : imageDataUrl(c.body, "cast[].body"),
      face: c.face == null ? null : imageDataUrl(c.face, "cast[].face"),
    });
  }
  return cast;
}

export function parseImageRequest(body: unknown): ImageRequest {
  if (!isObj(body)) throw new BadRequest("Expected a JSON object.");
  return {
    prompt: prompt(body.prompt),
    style: typeof body.style === "string" ? body.style.slice(0, 240) : "",
    cast: parseCast(body.cast),
  };
}

export function parseVideoStart(body: unknown): VideoStartRequest {
  if (!isObj(body)) throw new BadRequest("Expected a JSON object.");
  return {
    image: imageDataUrl(body.image, "image"),
    prompt: prompt(body.prompt),
    seconds: body.seconds === 10 ? 10 : 5,
    cast: parseCast(body.cast),
  };
}

export function parseJobId(v: string | null): string {
  if (!v || !/^[\w-]{1,128}$/.test(v)) throw new BadRequest("A valid job id is required.");
  return v;
}
