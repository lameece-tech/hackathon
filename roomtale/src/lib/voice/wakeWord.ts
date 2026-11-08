// Wake phrase and story-request matching over speech-recognition transcripts. Recognizers
// rarely spell "RoomTale" right, so the common mishearings are accepted too.

const WAKE = /\b(?:(?:hey|hi|hello|okay|ok)[\s,]+)?(?:room[\s-]?(?:tale|tail|tell|tales|tails|towel|tal)|roomtale|roomtail|rumtale)\b[\s,.!?:;-]*/i;

/** "tell us a story", "make a silly story about…", "create a sci-fi story" — a request without the wake phrase. */
const STORY_REQUEST = /\b(?:tell|create|make|write|generate|start|give|read)\b[\w\s,'’-]{0,48}?\bstor(?:y|ies)\b/i;

const LEADING_FILLER = /^(?:(?:um+|uh+|er+|so|okay|ok|well|please|and)\b[\s,.]*)+/i;

export const MIN_PROMPT_WORDS = 3;

export function findWake(text: string): { start: number; end: number } | null {
  const m = WAKE.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export function isStoryRequest(text: string): boolean {
  return STORY_REQUEST.test(text);
}

export function cleanSpokenPrompt(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_FILLER, "")
    .replace(/^[,.;:!?-]+\s*/, "")
    .trim();
}

/** What follows the wake phrase in an utterance ("hey roomtale, a pirate story" → "a pirate story"). */
export function promptAfterWake(text: string): string {
  const wake = findWake(text);
  return cleanSpokenPrompt(wake ? text.slice(wake.end) : text);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export type WakeMatch = { kind: "wake" } | { kind: "request" };

/** Should this idle utterance start listening? The wake phrase, or a plain story request. */
export function matchTrigger(text: string): WakeMatch | null {
  if (findWake(text)) return { kind: "wake" };
  if (isStoryRequest(text)) return { kind: "request" };
  return null;
}
