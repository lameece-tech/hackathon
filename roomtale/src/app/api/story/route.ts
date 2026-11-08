import { errorResponse, readJson } from "@/lib/ai/http";
import { chatJSON, MODELS, openAIConfigured } from "@/lib/ai/openai";
import { buildStoryUserText, STORY_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { parseStoryRequest } from "@/lib/ai/validate";
import { buildMockStory } from "@/lib/story/mockStory";
import { newStoryId, normalizeStory, STORY_SCHEMA } from "@/lib/story/schema";
import type { StoryResponse } from "@/lib/story/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/story
 * Body: StoryRequest — a spoken request plus, optionally, the cast from an earlier scene
 * analysis. Text-only, so "tell another one" skips the photo and the vision model.
 * Returns: StoryResponse — { story: { title, characters, shots[] }, mode }.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseStoryRequest(await readJson(request));

    if (!openAIConfigured()) {
      return Response.json({ story: buildMockStory(input.prompt, input.scene), mode: "mock" } satisfies StoryResponse);
    }

    const raw = await chatJSON({
      model: MODELS.story,
      system: STORY_SYSTEM_PROMPT,
      user: buildStoryUserText(input.prompt, input.scene, input.previousTitle),
      schemaName: "roomtale_story",
      schema: STORY_SCHEMA,
      temperature: 1,
      signal: request.signal,
    });

    const occupantIds = new Set(input.scene?.occupants.map((o) => o.id) ?? []);
    const story = normalizeStory(raw, occupantIds, newStoryId());
    return Response.json({ story, mode: "live" } satisfies StoryResponse);
  } catch (err) {
    return errorResponse(err, "story");
  }
}
