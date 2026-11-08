import { errorResponse, readJson } from "@/lib/ai/http";
import { chatJSON, MODELS, openAIConfigured } from "@/lib/ai/openai";
import { buildSceneUserText, SCENE_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { parseSceneRequest } from "@/lib/ai/validate";
import { buildMockSceneStory } from "@/lib/story/mockStory";
import { newStoryId, normalizeScene, normalizeStory, SCENE_STORY_SCHEMA } from "@/lib/story/schema";
import type { SceneAnalysisResponse } from "@/lib/story/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/scene-analysis
 * Body: SceneAnalysisRequest — the captured room photo, the viewer's spoken request, and the
 * subjects the on-device detector found (ids + boxes, no pixels beyond the photo itself).
 * Returns: SceneAnalysisResponse — who is in the room and the finished story that casts them.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseSceneRequest(await readJson(request));

    if (!openAIConfigured()) {
      return Response.json(buildMockSceneStory(input.prompt, input.subjects) satisfies SceneAnalysisResponse);
    }

    const raw = await chatJSON({
      model: MODELS.vision,
      system: SCENE_ANALYSIS_SYSTEM_PROMPT,
      user: [
        { type: "text", text: buildSceneUserText(input.prompt, input.subjects, input.imageSize) },
        { type: "image_url", image_url: { url: input.image, detail: "high" } },
      ],
      schemaName: "roomtale_scene_story",
      schema: SCENE_STORY_SCHEMA,
      temperature: 0.9,
      signal: request.signal,
    });

    const result = raw as { scene?: unknown; story?: unknown };
    const scene = normalizeScene(result.scene);
    const story = normalizeStory(result.story, new Set(scene.occupants.map((o) => o.id)), newStoryId());
    return Response.json({ scene, story, mode: "live" } satisfies SceneAnalysisResponse);
  } catch (err) {
    return errorResponse(err, "scene-analysis");
  }
}
