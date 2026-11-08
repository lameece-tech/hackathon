import { FAL_MODELS, falConfigured, falImage } from "./fal";
import { editImageWithReferences, MODELS, openAIConfigured } from "./openai";
import { RUNWAY_MODELS, runwayConfigured, runwayImage } from "./runway";

// Who builds the family into each shot's opening frame from their photo cutouts. Server-only.

export type SceneProvider = "openai" | "fal" | "runway";

const configured = (): Record<SceneProvider, boolean> => ({ openai: openAIConfigured(), fal: falConfigured(), runway: runwayConfigured() });

/** SCENE_PROVIDER picks one explicitly; otherwise the first configured of OpenAI, fal, Runway. */
export function sceneProvider(): SceneProvider | null {
  const ok = configured();
  const chosen = process.env.SCENE_PROVIDER as SceneProvider | undefined;
  if (chosen && chosen in ok) return ok[chosen] ? chosen : null;
  return (["openai", "fal", "runway"] as const).find((p) => ok[p]) ?? null;
}

/** Renders the frame; references are referred to by their order in the prompt. */
export async function renderScene(provider: SceneProvider, prompt: string, references: string[], signal?: AbortSignal): Promise<{ url: string; model: string }> {
  switch (provider) {
    case "fal":
      return { url: await falImage(prompt, references, signal), model: `fal/${FAL_MODELS.image}` };
    case "runway":
      return { url: await runwayImage(prompt, references, signal), model: `runway/${RUNWAY_MODELS.image}` };
    case "openai":
      return { url: await editImageWithReferences({ prompt, references, signal }), model: MODELS.imageEdit };
  }
}
