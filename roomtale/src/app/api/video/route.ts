import { errorResponse, readJson } from "@/lib/ai/http";
import { BadRequest, parseJobId, parseVideoStart } from "@/lib/ai/validate";
import { getVideoStatus, startVideo, videoProvider, type VideoProvider } from "@/lib/ai/video";
import type { VideoJob, VideoStatus } from "@/lib/story/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/video
 * Body: VideoStartRequest — a shot's 1280×720 opening frame, its motionPrompt, and the on-screen
 * cast's real photos (sent to the provider only with ALLOW_PERSON_REFERENCES=true, else 403).
 * Returns: VideoJob to poll, or 501 when no video provider is configured.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseVideoStart(await readJson(request));
    const provider = videoProvider();
    if (!provider) return Response.json({ error: "No video provider configured." }, { status: 501 });
    if (input.cast.length > 0 && process.env.ALLOW_PERSON_REFERENCES !== "true") {
      return Response.json({ error: "Person references are disabled on this server." }, { status: 403 });
    }
    const id = await startVideo(provider, input, request.signal);
    return Response.json({ id, provider } satisfies VideoJob);
  } catch (err) {
    return errorResponse(err, "video");
  }
}

/** GET /api/video?id=…&provider=… → VideoStatus. Clips take tens of seconds to minutes. */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const id = parseJobId(params.get("id"));
    const provider = params.get("provider") as VideoProvider;
    if (provider !== "runway" && provider !== "sora" && provider !== "fal") throw new BadRequest("provider must be runway, sora or fal.");
    const status: VideoStatus = await getVideoStatus(provider, id, request.signal);
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "video");
  }
}
