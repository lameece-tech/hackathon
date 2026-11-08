import type { LittleApp } from "@kabletv/little-sdk";
import type { Capabilities, CastReference, ImageRequest, ImageResponse, Story, Subject, VideoJob, VideoStartRequest, VideoStatus } from "@/lib/story/types";
import { encodeFrame } from "@/lib/vision/capture";
import { extractSubjects } from "@/lib/vision/subjects";
import type { EngineDeps } from "./engine";

/** True on a Little television (or `little dev`); false in a plain browser, where the SDK runs its inspector. */
export function isHosted(): boolean {
  return typeof window !== "undefined" && window.__little === undefined;
}

class Unavailable extends Error {}

async function postJson<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  // 501: no provider configured. 403: this server won't send photos of people.
  if (res.status === 501 || res.status === 403) throw new Unavailable(`${path} ${res.status}`);
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`${path} ${res.status}: ${detail.error ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

/** The on-screen cast for a shot, left to right, with each one's full-body and face references. */
export function castFor(story: Story, shot: number, subjects: Subject[]): CastReference[] {
  const byId = new Map(subjects.map((s) => [s.id, s]));
  return story.shots[shot].characterIds.flatMap((id): CastReference[] => {
    const character = story.characters.find((c) => c.id === id);
    const subject = character?.occupantId ? byId.get(character.occupantId) : undefined;
    if (!character || !subject) return [];
    return [{ name: character.name, costume: character.costume, kind: subject.kind === "person" ? "person" : "pet", body: subject.cutout, face: subject.avatar }];
  });
}

/** Cover-crops a keyframe to the exact 1280×720 first frame the video providers expect. */
async function videoFrame(keyframe: string): Promise<string> {
  const img = new Image();
  img.src = keyframe;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const k = Math.max(1280 / img.naturalWidth, 720 / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  canvas.getContext("2d")!.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.9);
}

const VIDEO_POLL_MS = 5000;
const VIDEO_TIMEOUT_MS = 20 * 60_000;

export function createClientDeps(app: LittleApp): EngineDeps {
  // Learned once per session: no point asking again for every shot.
  let scenesUnavailable = false;
  let videosUnavailable = false;

  return {
    encodeFrame: (frame) => encodeFrame(frame),
    detect: extractSubjects,
    analyzeScene: (request, signal) => postJson("/api/scene-analysis", request, signal),
    generateStory: (request, signal) => postJson("/api/story", request, signal),

    capabilities: async (signal) => {
      const res = await fetch("/api/capabilities", { signal });
      if (!res.ok) throw new Error(`/api/capabilities ${res.status}`);
      return (await res.json()) as Capabilities;
    },

    async renderScene(story, shot, subjects, signal) {
      const cast = castFor(story, shot, subjects);
      if (scenesUnavailable || cast.length === 0 || !cast.some((c) => c.body || c.face)) return null;
      const body: ImageRequest = { prompt: story.shots[shot].imagePrompt, style: story.artStyle, cast };
      try {
        return (await postJson<ImageResponse>("/api/image", body, signal)).url;
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        scenesUnavailable = true;
        return null;
      }
    },

    async animate(story, shot, keyframe, subjects, signal) {
      if (videosUnavailable || !keyframe.startsWith("data:image/")) return null;
      let job: VideoJob;
      try {
        const { motionPrompt, seconds } = story.shots[shot];
        const body: VideoStartRequest = { image: await videoFrame(keyframe), prompt: motionPrompt, seconds, cast: castFor(story, shot, subjects) };
        job = await postJson<VideoJob>("/api/video", body, signal);
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        videosUnavailable = true;
        return null;
      }
      const deadline = Date.now() + VIDEO_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(VIDEO_POLL_MS, signal);
        const res = await fetch(`/api/video?id=${encodeURIComponent(job.id)}&provider=${job.provider}`, { signal });
        if (!res.ok) continue;
        const status = (await res.json()) as VideoStatus;
        if (status.status === "done") return status.url ?? null;
        if (status.status === "failed") throw new Error(`clip failed: ${status.error ?? "unknown"}`);
      }
      throw new Error("clip timed out");
    },

    async score(story) {
      const music = await app.music({
        hint: `${story.theme}: ${story.logline}`,
        instruction: "An instrumental family-adventure film score: warm, playful and cinematic, gentle enough to sit under narration.",
      });
      return music.ok ? music.url : null;
    },

    emit: (name, data) => app.emit(name, data),
    now: () => performance.now(),
  };
}
