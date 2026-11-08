import { OpenAIError } from "./openai";

// Runway's API (https://docs.dev.runwayml.com): every generation returns a task id that is
// polled until it SUCCEEDED or FAILED. Server-only. Model ids change over time; override them
// with RUNWAY_VIDEO_MODEL / RUNWAY_IMAGE_MODEL from https://docs.dev.runwayml.com/guides/models.

const BASE = process.env.RUNWAY_BASE_URL ?? "https://api.dev.runwayml.com/v1";
const VERSION = process.env.RUNWAY_API_VERSION ?? "2024-11-06";

export const RUNWAY_MODELS = {
  video: process.env.RUNWAY_VIDEO_MODEL ?? process.env.RUNWAY_MODEL ?? "gen4.5",
  // Takes up to 16 reference images, referred to by their order in the prompt.
  image: process.env.RUNWAY_IMAGE_MODEL ?? "gpt_image_2",
};

const key = () => process.env.RUNWAY_API_KEY ?? process.env.RUNWAYML_API_SECRET;

export function runwayConfigured(): boolean {
  return Boolean(key());
}

const headers = () => ({ Authorization: `Bearer ${key()}`, "X-Runway-Version": VERSION, "Content-Type": "application/json" });

async function fail(res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string; issues?: unknown };
    if (body.error) message = body.issues ? `${body.error} ${JSON.stringify(body.issues)}` : body.error;
  } catch {
    // Non-JSON error body.
  }
  throw new OpenAIError(res.status, `runway: ${message}`);
}

export interface RunwayTask {
  id: string;
  status: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: string[];
  failure?: string;
  failureCode?: string;
}

export async function runwayStart(path: string, body: object, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!res.ok) await fail(res);
  return ((await res.json()) as { id: string }).id;
}

export async function runwayTask(id: string, signal?: AbortSignal): Promise<RunwayTask> {
  const res = await fetch(`${BASE}/tasks/${id}`, { headers: headers(), signal });
  if (!res.ok) await fail(res);
  return (await res.json()) as RunwayTask;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls a task to completion with gentle backoff; returns its first output URL. */
async function runwayWait(id: string, signal?: AbortSignal, timeoutMs = 110_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (let wait = 1500; Date.now() < deadline; wait = Math.min(wait * 1.5, 5000)) {
    await sleep(wait);
    const task = await runwayTask(id, signal);
    if (task.status === "SUCCEEDED" && task.output?.[0]) return task.output[0];
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      // Moderation shows up here, not as an HTTP error.
      throw new OpenAIError(422, `runway: ${task.failureCode ?? task.status}: ${task.failure ?? "generation failed"}`);
    }
  }
  throw new OpenAIError(504, "runway: image generation timed out");
}

/** Output URLs are temporary and cross-origin, so the TV gets the image itself as a data URL. */
async function download(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new OpenAIError(502, `runway: output download failed (${res.status})`);
  const type = res.headers.get("Content-Type")?.split(";")[0] || "image/png";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/** A 16:9 still, optionally from reference photos (referred to by order in the prompt). */
export async function runwayImage(prompt: string, references: string[], signal?: AbortSignal): Promise<string> {
  // Ratios and options are per model; these defaults fit gpt_image_2.
  const gptImage = RUNWAY_MODELS.image.startsWith("gpt_image");
  const id = await runwayStart(
    "/text_to_image",
    {
      model: RUNWAY_MODELS.image,
      promptText: prompt,
      ratio: process.env.RUNWAY_IMAGE_RATIO ?? (gptImage ? "1920:1088" : "1920:1080"),
      ...(gptImage ? { quality: process.env.RUNWAY_IMAGE_QUALITY ?? "medium" } : {}),
      ...(references.length ? { referenceImages: references.slice(0, 16).map((uri) => ({ uri })) } : {}),
    },
    signal,
  );
  return download(await runwayWait(id, signal), signal);
}

/** Starts a clip animated from `image` (its first frame); returns the task id to poll. */
export function runwayVideo(image: string, prompt: string, seconds: number, signal?: AbortSignal): Promise<string> {
  return runwayStart(
    "/image_to_video",
    {
      model: RUNWAY_MODELS.video,
      promptImage: image,
      promptText: prompt.slice(0, 1000),
      ratio: "1280:720",
      duration: Math.min(10, Math.max(2, Math.round(seconds))),
    },
    signal,
  );
}
