// A deliberately small OpenAI client over fetch: structured chat output, image generation,
// and image edits. Server-only (reads the API key from the environment).

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const MODELS = {
  vision: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
  story: process.env.OPENAI_STORY_MODEL ?? "gpt-4o",
  imageEdit: process.env.OPENAI_IMAGE_EDIT_MODEL ?? "gpt-image-1",
};

export class OpenAIError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function openAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function request<T>(path: string, body: BodyInit, signal?: AbortSignal, json = true): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body,
    signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) message = err.error.message;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new OpenAIError(res.status, message);
  }
  return (await res.json()) as T;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "low" | "high" | "auto" } };

interface ChatCompletion {
  choices: Array<{ message: { content: string | null; refusal?: string | null }; finish_reason: string }>;
}

/** One chat completion constrained to a strict JSON schema; returns the parsed object. */
export async function chatJSON(options: {
  model: string;
  system: string;
  user: string | ContentPart[];
  schemaName: string;
  schema: object;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const completion = await request<ChatCompletion>(
    "/chat/completions",
    JSON.stringify({
      model: options.model,
      temperature: options.temperature ?? 0.9,
      max_tokens: options.maxTokens ?? 4000,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: options.schemaName, strict: true, schema: options.schema },
      },
    }),
    options.signal,
  );
  const choice = completion.choices[0];
  if (!choice) throw new OpenAIError(502, "The model returned no choices.");
  if (choice.message.refusal) throw new OpenAIError(422, `The model declined: ${choice.message.refusal}`);
  if (choice.finish_reason === "length") throw new OpenAIError(502, "The model ran out of tokens mid-story.");
  if (!choice.message.content) throw new OpenAIError(502, "The model returned an empty message.");
  return JSON.parse(choice.message.content);
}

interface ImagesResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

function toImageUrl(item: ImagesResponse["data"][number] | undefined, mime: string): string {
  if (item?.url) return item.url;
  if (item?.b64_json) return `data:${mime};base64,${item.b64_json}`;
  throw new OpenAIError(502, "The image API returned no image.");
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new OpenAIError(400, "Reference images must be base64 data URLs.");
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
}

/** A new image from reference photos of the cast (gpt-image-1 edits), so the result shows them. */
export async function editImageWithReferences(options: {
  prompt: string;
  references: string[];
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const form = new FormData();
  form.set("model", options.model ?? MODELS.imageEdit);
  form.set("prompt", options.prompt);
  form.set("size", "1536x1024");
  form.set("quality", process.env.OPENAI_IMAGE_QUALITY ?? "medium");
  form.set("output_format", "jpeg");
  // "high" makes the model hold on to faces in the references; set the env var empty to omit it.
  const fidelity = process.env.OPENAI_IMAGE_INPUT_FIDELITY ?? "high";
  if (fidelity) form.set("input_fidelity", fidelity);
  options.references.forEach((ref, i) => {
    const blob = dataUrlToBlob(ref);
    form.append("image[]", blob, `reference-${i + 1}.${blob.type.split("/")[1] ?? "png"}`);
  });
  const res = await request<ImagesResponse>("/images/edits", form, options.signal, false);
  return toImageUrl(res.data[0], "image/jpeg");
}
