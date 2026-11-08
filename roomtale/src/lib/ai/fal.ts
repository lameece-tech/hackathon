import type { CastReference, VideoStartRequest, VideoStatus } from "@/lib/story/types";
import { OpenAIError } from "./openai";

// fal.ai (https://fal.ai/docs/api-reference/inference-api): submit to the queue, poll the
// status, fetch the result. Server-only. Model ids are overridable with FAL_IMAGE_MODEL and
// FAL_VIDEO_MODEL; their input fields differ per model, so a swap may need the bodies below.

const QUEUE = "https://queue.fal.run";

export const FAL_MODELS = {
  // Keeps people's likeness across several reference photos.
  image: process.env.FAL_IMAGE_MODEL ?? "fal-ai/nano-banana-pro/edit",
  // Seedance 2.5 reference-to-video films from the opening frame AND the real photos of the
  // cast, so faces stay theirs. Also supported: minimax/h3-max-turbo/image-to-video (cheaper
  // and faster, but it only sees the frame, so likeness is the frame's).
  video: process.env.FAL_VIDEO_MODEL ?? "bytedance/seedance-2.5/us/reference-to-video",
};

const key = () => process.env.FAL_KEY ?? process.env.FAL_API_KEY;

export function falConfigured(): boolean {
  return Boolean(key());
}

const headers = () => ({ Authorization: `Key ${key()}`, "Content-Type": "application/json" });

/** Status and result URLs use only the owner and app of a model id. */
const appOf = (model: string) => model.split("/").slice(0, 2).join("/");

async function fail(res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { detail?: unknown; error?: string };
    const detail = typeof body.detail === "string" ? body.detail : body.detail ? JSON.stringify(body.detail) : body.error;
    if (detail) message = detail;
  } catch {
    // Non-JSON error body.
  }
  // A locked account (no credit) answers 403; surface it as an upstream failure, not "disabled".
  throw new OpenAIError(res.status === 403 ? 402 : res.status, `fal: ${message}`);
}

async function submit(model: string, input: object, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${QUEUE}/${model}`, { method: "POST", headers: headers(), body: JSON.stringify(input), signal });
  if (!res.ok) await fail(res);
  return ((await res.json()) as { request_id: string }).request_id;
}

interface QueueStatus {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  error?: string;
}

async function status(model: string, id: string, signal?: AbortSignal): Promise<QueueStatus> {
  const res = await fetch(`${QUEUE}/${appOf(model)}/requests/${id}/status`, { headers: headers(), signal });
  if (!res.ok && res.status !== 202) await fail(res);
  return (await res.json()) as QueueStatus;
}

/** The output of a COMPLETED request; a failed request answers here with its error. */
async function result<T>(model: string, id: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${QUEUE}/${appOf(model)}/requests/${id}`, { headers: headers(), signal });
  if (!res.ok) await fail(res);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(model: string, id: string, signal?: AbortSignal, timeoutMs = 110_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (let wait = 1500; Date.now() < deadline; wait = Math.min(wait * 1.4, 4000)) {
    await sleep(wait);
    if ((await status(model, id, signal)).status === "COMPLETED") return result<T>(model, id, signal);
  }
  throw new OpenAIError(504, "fal: generation timed out");
}

/** fal CDN URLs are cross-origin, so the TV gets the image itself as a data URL. */
async function download(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new OpenAIError(502, `fal: output download failed (${res.status})`);
  const type = res.headers.get("Content-Type")?.split(";")[0] || "image/jpeg";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/** A 16:9 still built from reference photos (referred to by their order in the prompt). */
export async function falImage(prompt: string, references: string[], signal?: AbortSignal): Promise<string> {
  const id = await submit(
    FAL_MODELS.image,
    // 2K: faces in a full-body wide shot are small, and 1K blurs the likeness.
    { prompt, image_urls: references, aspect_ratio: "16:9", resolution: process.env.FAL_IMAGE_RESOLUTION ?? "2K", output_format: "jpeg", num_images: 1 },
    signal,
  );
  const out = await waitFor<{ images?: Array<{ url: string }> }>(FAL_MODELS.image, id, signal);
  const url = out.images?.[0]?.url;
  if (!url) throw new OpenAIError(502, "fal: no image in the result");
  return download(url, signal);
}

/**
 * The Seedance reference prompt: @Image1 is the opening frame, then each cast member's face
 * close-up and full-body photo, named so the model ties every face to its photos.
 */
function referencePrompt(motion: string, cast: CastReference[]): { prompt: string; references: string[] } {
  const references: string[] = [];
  const at = (url: string) => `@Image${references.push(url) + 1}`;
  const lines = cast.flatMap((c) => {
    const photos = [c.face && `${at(c.face)} (face close-up)`, c.body && `${at(c.body)} (whole body)`].filter(Boolean);
    if (photos.length === 0) return [];
    return c.kind === "pet"
      ? [`${c.name}, in ${c.costume}, is the real pet in ${photos.join(" and ")}: same breed, coat and markings.`]
      : [
          `${c.name}, in ${c.costume}, is the real person in ${photos.join(" and ")}. Their face must match those photos exactly in every frame (same eyes, nose, mouth, jawline, eyebrows, hairstyle and skin tone), not a look-alike.`,
        ];
  });
  const humans = cast.filter((c) => c.kind === "person").length;
  const prompt = [
    "@Image1 is this shot's opening frame: start from that exact set, costumes, framing and light.",
    ...lines,
    humans > 0 ? "No other people appear, and nobody appears twice." : "",
    `Action: ${motion}`,
    "Hyper-realistic live-action footage, natural body movement, faces in sharp focus. No text, captions or logos.",
  ]
    .filter(Boolean)
    .join(" ");
  return { prompt, references };
}

function videoInput({ image, prompt, seconds, cast }: VideoStartRequest): object {
  const model = FAL_MODELS.video;
  const resolution = process.env.FAL_VIDEO_RESOLUTION;
  if (model.includes("seedance") && model.endsWith("reference-to-video")) {
    const ref = referencePrompt(prompt, cast);
    return {
      prompt: ref.prompt,
      image_urls: [image, ...ref.references],
      aspect_ratio: "16:9",
      resolution: resolution ?? "720p",
      duration: String(seconds),
      // The TV plays clips muted under its own narration and score.
      generate_audio: false,
    };
  }
  if (model.includes("seedance")) {
    return { prompt, image_url: image, resolution: resolution ?? "720p", duration: String(seconds), generate_audio: false };
  }
  return { prompt, image_url: image, duration: seconds, resolution: resolution ?? "768P", prompt_expansion_mode: "balanced" };
}

/** Starts a shot's clip from its opening frame (plus the cast's photos when the model takes them). */
export function falVideo(input: VideoStartRequest, signal?: AbortSignal): Promise<string> {
  return submit(FAL_MODELS.video, videoInput(input), signal);
}

export async function falVideoStatus(id: string, signal?: AbortSignal): Promise<VideoStatus> {
  const s = await status(FAL_MODELS.video, id, signal);
  if (s.status === "IN_QUEUE") return { status: "pending" };
  if (s.status === "IN_PROGRESS") return { status: "running" };
  try {
    const out = await result<{ video?: { url?: string } }>(FAL_MODELS.video, id, signal);
    return out.video?.url ? { status: "done", url: out.video.url } : { status: "failed", error: "No video in the result." };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
