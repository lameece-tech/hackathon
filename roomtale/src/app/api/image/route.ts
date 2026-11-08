import { errorResponse, readJson } from "@/lib/ai/http";
import { renderScene, sceneProvider } from "@/lib/ai/scenes";
import { parseImageRequest } from "@/lib/ai/validate";
import type { ImageRequest, ImageResponse } from "@/lib/story/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Identity leads the prompt and the face close-up comes before the full-body photo: image
// models weight early text and early references most, and likeness is the whole point.
function scenePrompt(req: ImageRequest): { prompt: string; references: string[] } {
  const references: string[] = [];
  const humans = req.cast.filter((c) => c.kind !== "pet").length;
  const cast = req.cast.map((c) => {
    const photos = [
      c.face && `image ${references.push(c.face)} is a close-up of ${c.kind === "pet" ? "its" : "their"} face`,
      c.body && `image ${references.push(c.body)} shows ${c.kind === "pet" ? "its" : "their"} whole body`,
    ].filter(Boolean);
    const costume = c.costume || "their costume";
    return c.kind === "pet"
      ? `${c.name} is the real pet in the reference photos (${photos.join("; ")}). Keep its exact breed, coat, markings and size, now wearing ${costume}.`
      : `${c.name} is the real person in the reference photos (${photos.join("; ")}). Keep their exact face, facial features, hairstyle, skin tone and build so their family instantly recognizes them, now wearing ${costume}.`;
  });
  const prompt = [
    "The reference photos show the real family who star in this film. Create one hyper-realistic film still of exactly them, like a frame of real live-action footage, not an illustration or a poster.",
    ...cast,
    `${humans === 0 ? "No humans appear" : humans === 1 ? "They are the only human" : `These ${humans} are the only humans`} in the image: no other people, extras or look-alikes, and nobody appears twice. Any other character in the scene is the non-human creature it is described as.`,
    `The scene, characters listed left to right: ${req.prompt}.`,
    "Everyone is full body, head to toe with feet on the ground and nobody cropped by the frame edge, and the people fill most of the frame's height. They are caught mid-action rather than posing, faces clearly visible and in sharp focus with natural skin texture, lit by the scene's own light, camera at eye level.",
    req.style,
    "Wide 16:9 framing. No text, captions, watermarks or logos.",
  ]
    .filter(Boolean)
    .join(" ");
  return { prompt, references };
}

/**
 * POST /api/image
 * Body: ImageRequest — a shot's opening-frame prompt, the film's look, and the on-screen cast
 * with their full-body and face cutouts from the captured photo.
 * Returns: ImageResponse — that frame with the family rendered into it in costume (the video
 * model animates it next). Sends photos of people to the image provider, so it is off unless
 * ALLOW_PERSON_REFERENCES=true (403 otherwise); 501 with no provider configured.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseImageRequest(await readJson(request));
    const provider = sceneProvider();
    if (!provider) {
      return Response.json({ error: "No image provider configured." }, { status: 501 });
    }
    if (process.env.ALLOW_PERSON_REFERENCES !== "true") {
      return Response.json({ error: "Person references are disabled on this server." }, { status: 403 });
    }
    const { prompt, references } = scenePrompt(input);
    if (references.length === 0) {
      return Response.json({ error: "A shot needs at least one cast reference image." }, { status: 400 });
    }
    const { url, model } = await renderScene(provider, prompt, references, request.signal);
    return Response.json({ url, provider: model } satisfies ImageResponse);
  } catch (err) {
    return errorResponse(err, "image");
  }
}
