import { openAIConfigured } from "@/lib/ai/openai";
import { sceneProvider } from "@/lib/ai/scenes";
import { videoProvider } from "@/lib/ai/video";
import type { Capabilities } from "@/lib/story/types";

export const dynamic = "force-dynamic";

/** GET /api/capabilities: which providers are configured, so the TV knows whether it can film. */
export function GET(): Response {
  const capabilities: Capabilities = {
    story: openAIConfigured(),
    scenes: sceneProvider() !== null && process.env.ALLOW_PERSON_REFERENCES === "true",
    video: videoProvider(),
  };
  return Response.json(capabilities, { headers: { "Cache-Control": "no-store" } });
}
