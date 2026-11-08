import type { VideoStartRequest, VideoStatus } from "@/lib/story/types";
import { dataUrlToBlob, OpenAIError } from "./openai";
import { falConfigured, falVideo, falVideoStatus } from "./fal";
import { runwayConfigured, runwayTask, runwayVideo } from "./runway";

// Image-to-video: each shot's opening frame becomes its footage. Server-only.
// VIDEO_PROVIDER picks runway, fal or sora explicitly; otherwise Runway, then fal (FAL_KEY),
// whichever has a key. Sora uses OpenAI's Videos API with the OpenAI key. Providers moderate images of real people differently: check their
// policy for family photos before shipping either.

export type VideoProvider = "runway" | "sora" | "fal";

export function videoProvider(): VideoProvider | null {
  const chosen = process.env.VIDEO_PROVIDER;
  if (chosen === "sora") return process.env.OPENAI_API_KEY ? "sora" : null;
  if (chosen === "fal") return falConfigured() ? "fal" : null;
  if (chosen === "runway") return runwayConfigured() ? "runway" : null;
  return runwayConfigured() ? "runway" : falConfigured() ? "fal" : null;
}

async function fail(res: Response, provider: string): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string | { message?: string } };
    message = typeof body.error === "string" ? body.error : (body.error?.message ?? message);
  } catch {
    // Non-JSON error body.
  }
  throw new OpenAIError(res.status, `${provider}: ${message}`);
}

// --- Runway -------------------------------------------------------------------------------

async function runwayStatus(id: string, signal?: AbortSignal): Promise<VideoStatus> {
  const task = await runwayTask(id, signal);
  switch (task.status) {
    case "SUCCEEDED":
      return task.output?.[0] ? { status: "done", url: task.output[0] } : { status: "failed", error: "No video in the result." };
    case "FAILED":
    case "CANCELLED":
      return { status: "failed", error: `${task.failureCode ?? task.status}: ${task.failure ?? ""}`.trim() };
    case "RUNNING":
      return { status: "running" };
    default:
      return { status: "pending" };
  }
}

// --- OpenAI Sora --------------------------------------------------------------------------

const OPENAI_BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const openaiAuth = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

async function soraStart(image: string, prompt: string, seconds: number, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set("model", process.env.OPENAI_VIDEO_MODEL ?? "sora-2");
  form.set("prompt", prompt);
  form.set("seconds", seconds > 6 ? "8" : "4");
  form.set("size", "1280x720");
  // The reference frame must match `size`; the client sends exactly 1280×720.
  form.set("input_reference", dataUrlToBlob(image), "frame.jpg");
  const res = await fetch(`${OPENAI_BASE}/videos`, { method: "POST", headers: openaiAuth(), body: form, signal });
  if (!res.ok) await fail(res, "sora");
  return ((await res.json()) as { id: string }).id;
}

async function soraStatus(id: string, signal?: AbortSignal): Promise<VideoStatus> {
  const res = await fetch(`${OPENAI_BASE}/videos/${id}`, { headers: openaiAuth(), signal });
  if (!res.ok) await fail(res, "sora");
  const job = (await res.json()) as { status: string; error?: { message?: string } };
  switch (job.status) {
    case "completed":
      // The file needs our key to download, so the TV plays it through our proxy.
      return { status: "done", url: `/api/video/content?id=${encodeURIComponent(id)}` };
    case "failed":
      return { status: "failed", error: job.error?.message ?? "failed" };
    case "in_progress":
      return { status: "running" };
    default:
      return { status: "pending" };
  }
}

export async function soraContent(id: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${OPENAI_BASE}/videos/${id}/content`, { headers: openaiAuth(), signal });
  if (!res.ok) await fail(res, "sora");
  return res;
}

// --- Dispatch -----------------------------------------------------------------------------

/** Runway and Sora animate the frame alone; fal's reference models also get the cast's photos. */
export function startVideo(provider: VideoProvider, input: VideoStartRequest, signal?: AbortSignal): Promise<string> {
  if (provider === "fal") return falVideo(input, signal);
  const { image, prompt, seconds } = input;
  return provider === "runway" ? runwayVideo(image, prompt, seconds, signal) : soraStart(image, prompt, seconds, signal);
}

export function getVideoStatus(provider: VideoProvider, id: string, signal?: AbortSignal): Promise<VideoStatus> {
  if (provider === "fal") return falVideoStatus(id, signal);
  return provider === "runway" ? runwayStatus(id, signal) : soraStatus(id, signal);
}
