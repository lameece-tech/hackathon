import type { Occupant, Position, SceneAnalysis, Shot, ShotMood, ShotSeconds, Story, StoryCharacter } from "./types";

// Strict structured-output schemas. OpenAI strict mode requires every property to be listed
// in `required` and `additionalProperties: false` on every object, and ignores length/count
// keywords, so limits live in the prompt and in normalizeStory() below.

const POSITIONS: Position[] = ["far left", "left", "center", "right", "far right"];
const MOODS: ShotMood[] = ["cozy", "exciting", "funny", "mysterious", "triumphant", "dreamy"];

export const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["setting", "objects", "occupants"],
  properties: {
    setting: {
      type: "string",
      description: "One phrase an illustrator could build a fantasy version of.",
    },
    objects: {
      type: "array",
      description: "Up to 6 notable props in the room the story can use.",
      items: { type: "string" },
    },
    occupants: {
      type: "array",
      description: "Every real person or pet in the photo.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "description", "position"],
        properties: {
          id: { type: "string", description: "The detector id (p1, pet1…) or extra1, extra2… for someone it missed." },
          kind: { type: "string", enum: ["person", "pet"] },
          description: { type: "string", description: "Kind, visual-only label: clothing, accessories, hair, held objects." },
          position: { type: "string", enum: POSITIONS },
        },
      },
    },
  },
} as const;

export const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "logline", "theme", "artStyle", "characters", "shots"],
  properties: {
    title: { type: "string" },
    logline: { type: "string", description: "One sentence: who, what, and the fun twist." },
    theme: { type: "string", description: "The genre and tone, e.g. \"silly sci-fi\"." },
    artStyle: { type: "string", description: "One camera-and-light phrase reused on every shot." },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "occupantId", "name", "role", "playedBy", "costume", "personality", "accentColor"],
        properties: {
          id: { type: "string", description: "c1, c2…" },
          occupantId: {
            type: ["string", "null"],
            description: "The occupant id who plays this character, or null for an invented character.",
          },
          name: { type: "string" },
          role: { type: "string", description: "hero, sidekick, lovable villain, mentor, comic relief…" },
          playedBy: { type: "string", description: "The occupant's description, or \"\" when invented." },
          costume: { type: "string", description: "A costume that riffs on what they're really wearing." },
          personality: { type: "string" },
          accentColor: { type: "string", description: "#RRGGBB from their real outfit, distinct per character." },
        },
      },
    },
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "imagePrompt", "motionPrompt", "characterIds", "mood", "seconds"],
        properties: {
          narration: { type: "string", description: "Voiceover during the shot: at most 12 words for 5 seconds, 24 for 10. \"\" for a visual beat." },
          imagePrompt: {
            type: "string",
            description: "The shot's opening frame: on-screen characters by name and costume, left to right, full body.",
          },
          motionPrompt: {
            type: "string",
            description: "Where each character moves across the frame, how their expression changes, and one camera move.",
          },
          characterIds: { type: "array", description: "On-screen characters, left to right.", items: { type: "string" } },
          mood: { type: "string", enum: MOODS },
          seconds: { type: "integer", enum: [5, 10] },
        },
      },
    },
  },
} as const;

export const SCENE_STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scene", "story"],
  properties: { scene: SCENE_SCHEMA, story: STORY_SCHEMA },
} as const;

// ---------------------------------------------------------------------------------------
// Normalization: the model's JSON is schema-shaped but not guaranteed sensible. Everything
// the UI depends on (ids that resolve, shot counts, lines that fit their shots, valid colors)
// is enforced here so the player never has to defend against it.

export const MIN_SHOTS = 3;
export const MAX_SHOTS = 14;
export const MAX_CHARACTERS = 6;
/** Narration pace: a line must finish inside its shot, or the voice drifts behind the picture. */
export const WORDS_PER_SECOND = 2.4;

export const CHARACTER_PALETTE = ["#FF6B35", "#22D3EE", "#A78BFA", "#FACC15", "#34D399", "#FB7185"];

const HEX = /^#[0-9a-f]{6}$/i;

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function clampWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  const cut = words.slice(0, max).join(" ");
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > cut.length * 0.5 ? cut.slice(0, lastStop + 1) : `${cut}…`;
}

export function normalizeScene(raw: unknown): SceneAnalysis {
  const scene = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const occupants: Occupant[] = [];
  for (const item of arr(scene.occupants)) {
    if (!isObj(item)) continue;
    const id = str(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    occupants.push({
      id,
      kind: item.kind === "pet" ? "pet" : "person",
      description: str(item.description, "someone in the room"),
      position: POSITIONS.includes(item.position as Position) ? (item.position as Position) : "center",
    });
  }
  return {
    setting: str(scene.setting, "a cozy living room"),
    objects: arr(scene.objects).map((o) => str(o)).filter(Boolean).slice(0, 6),
    occupants,
  };
}

/**
 * Repairs a model-produced screenplay: unique character ids, occupant links that resolve,
 * valid colors, shot counts, voiceover that fits each shot, and characterIds that exist.
 */
export function normalizeStory(raw: unknown, occupantIds: ReadonlySet<string>, id: string): Story {
  const story = isObj(raw) ? raw : {};

  const characters: StoryCharacter[] = [];
  const usedIds = new Set<string>();
  const usedOccupants = new Set<string>();
  for (const item of arr(story.characters)) {
    if (!isObj(item) || characters.length >= MAX_CHARACTERS) continue;
    let cid = str(item.id) || `c${characters.length + 1}`;
    while (usedIds.has(cid)) cid = `${cid}x`;
    usedIds.add(cid);
    const occ = str(item.occupantId);
    const occupantId = occ && occupantIds.has(occ) && !usedOccupants.has(occ) ? occ : null;
    if (occupantId) usedOccupants.add(occupantId);
    const color = str(item.accentColor);
    characters.push({
      id: cid,
      occupantId,
      name: str(item.name, `Hero ${characters.length + 1}`),
      role: str(item.role, "hero"),
      playedBy: occupantId ? str(item.playedBy) : "",
      costume: str(item.costume),
      personality: str(item.personality),
      accentColor: HEX.test(color) ? color.toUpperCase() : CHARACTER_PALETTE[characters.length % CHARACTER_PALETTE.length],
    });
  }

  const shots: Shot[] = [];
  for (const item of arr(story.shots)) {
    if (!isObj(item) || shots.length >= MAX_SHOTS) continue;
    const imagePrompt = str(item.imagePrompt);
    if (!imagePrompt) continue;
    const onScreen = arr(item.characterIds)
      .map((c) => str(c))
      .filter((c, i, all) => usedIds.has(c) && all.indexOf(c) === i)
      .slice(0, 4);
    let narration = str(item.narration);
    // A line too long for 5 seconds gets 10; one too long for 10 is trimmed to fit.
    const seconds: ShotSeconds = item.seconds === 10 || narration.split(/\s+/).length > 5 * WORDS_PER_SECOND ? 10 : 5;
    narration = clampWords(narration, Math.floor(seconds * WORDS_PER_SECOND));
    shots.push({
      narration,
      imagePrompt,
      motionPrompt: str(item.motionPrompt, "Slow push-in as everyone moves through the scene, reacting to each other with big expressions."),
      characterIds: onScreen.length > 0 ? onScreen : characters.slice(0, 3).map((c) => c.id),
      mood: MOODS.includes(item.mood as ShotMood) ? (item.mood as ShotMood) : "exciting",
      seconds,
    });
  }
  if (shots.length < MIN_SHOTS) throw new Error(`Film has ${shots.length} usable shots; need at least ${MIN_SHOTS}.`);

  return {
    id,
    title: str(story.title, "A RoomTale"),
    logline: str(story.logline),
    theme: str(story.theme, "adventure"),
    artStyle: str(story.artStyle, "hyper-realistic live-action footage, natural light matched to the set, 35mm lens at eye level, everyone in sharp focus"),
    characters,
    shots,
  };
}

/** Film length in seconds. */
export function runtimeSeconds(story: Story): number {
  return story.shots.reduce((sum, s) => sum + s.seconds, 0);
}

export function newStoryId(): string {
  return `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
