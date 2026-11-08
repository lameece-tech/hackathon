import { OpenAIError } from "./openai";
import { BadRequest } from "./validate";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequest("Body must be JSON.");
  }
}

export function errorResponse(err: unknown, route: string): Response {
  if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof OpenAIError) {
    console.error(`[${route}] OpenAI ${err.status}: ${err.message}`);
    // Rate limits pass through so the client can back off; everything else is our upstream failing.
    const status = err.status === 429 ? 429 : err.status === 422 ? 422 : 502;
    return Response.json({ error: err.message }, { status });
  }
  if (err instanceof Error && err.name === "AbortError") {
    return Response.json({ error: "The request was cancelled." }, { status: 499 });
  }
  console.error(`[${route}]`, err);
  return Response.json({ error: "Something went wrong making the story." }, { status: 500 });
}
