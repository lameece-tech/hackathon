import { errorResponse } from "@/lib/ai/http";
import { parseJobId } from "@/lib/ai/validate";
import { soraContent } from "@/lib/ai/video";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/video/content?id=… streams a finished Sora clip, whose download needs our key. */
export async function GET(request: Request): Promise<Response> {
  try {
    const id = parseJobId(new URL(request.url).searchParams.get("id"));
    const upstream = await soraContent(id, request.signal);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "video/mp4",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err, "video-content");
  }
}
