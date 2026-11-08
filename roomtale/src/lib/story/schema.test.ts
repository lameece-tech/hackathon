import { describe, expect, it } from "vitest";
import { buildMockSceneStory } from "./mockStory";
import { normalizeScene, normalizeStory, SCENE_STORY_SCHEMA, WORDS_PER_SECOND } from "./schema";

type SchemaNode = { type?: unknown; properties?: Record<string, SchemaNode>; required?: string[]; additionalProperties?: unknown; items?: SchemaNode };

/** OpenAI strict mode: every object lists all its properties as required and forbids extras. */
function assertStrict(node: SchemaNode, path = "$") {
  if (node.properties) {
    expect(node.additionalProperties, `${path} additionalProperties`).toBe(false);
    expect([...(node.required ?? [])].sort(), `${path} required`).toEqual(Object.keys(node.properties).sort());
    for (const [key, child] of Object.entries(node.properties)) assertStrict(child, `${path}.${key}`);
  }
  if (node.items) assertStrict(node.items, `${path}[]`);
}

describe("story schema", () => {
  it("is valid for OpenAI strict structured outputs", () => {
    assertStrict(SCENE_STORY_SCHEMA as unknown as SchemaNode);
  });

  it("repairs ids, links, colors and shot lengths", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const story = normalizeStory(
      {
        title: "Test",
        characters: [
          { id: "c1", occupantId: "p1", name: "Ace", role: "hero", playedBy: "person in a hat", accentColor: "#ff0000" },
          { id: "c1", occupantId: "p1", name: "Dupe", role: "sidekick", playedBy: "x", accentColor: "red" },
          { id: "c3", occupantId: "ghost", name: "Ghost", role: "villain", playedBy: "nobody", accentColor: "#00ff00" },
        ],
        shots: [
          { narration: words(60), imagePrompt: "a", characterIds: ["c1", "nope", "c1"], mood: "exciting", seconds: 5 },
          { narration: words(8), imagePrompt: "b", characterIds: [], mood: "weird", seconds: 5 },
          { narration: words(20), imagePrompt: "c", characterIds: ["c3"], mood: "cozy", seconds: 5 },
          { narration: "", imagePrompt: "d", characterIds: [], mood: "cozy", seconds: 7 },
          { narration: "No picture.", imagePrompt: "", characterIds: [], mood: "cozy", seconds: 5 },
        ],
      },
      new Set(["p1"]),
      "s1",
    );
    expect(story.characters.map((c) => c.id)).toEqual(["c1", "c1x", "c3"]);
    expect(story.characters[0]).toMatchObject({ occupantId: "p1", accentColor: "#FF0000" });
    expect(story.characters[1]).toMatchObject({ occupantId: null, playedBy: "" });
    expect(story.characters[1].accentColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(story.characters[2].occupantId).toBeNull();
    // A shot with no opening frame can't be filmed.
    expect(story.shots).toHaveLength(4);
    // Every line fits its shot at speaking pace; long lines get the 10-second length.
    expect(story.shots.map((s) => s.seconds)).toEqual([10, 5, 10, 5]);
    expect(story.shots.every((s) => s.narration.split(/\s+/).filter(Boolean).length <= s.seconds * WORDS_PER_SECOND + 1)).toBe(true);
    expect(story.shots[0].characterIds).toEqual(["c1"]);
    expect(story.shots[1].characterIds.length).toBeGreaterThan(0);
    expect(story.shots[1].mood).toBe("exciting");
  });

  it("rejects a film too short to play", () => {
    expect(() => normalizeStory({ shots: [{ narration: "Only one shot.", imagePrompt: "a" }] }, new Set(), "s")).toThrow(/usable shots/);
  });

  it("dedupes occupants and defaults positions", () => {
    const scene = normalizeScene({ occupants: [{ id: "p1", kind: "person", description: "a", position: "top" }, { id: "p1" }, { id: "" }] });
    expect(scene.occupants).toEqual([{ id: "p1", kind: "person", description: "a", position: "center" }]);
  });

  it("builds a playable mock story from detected subjects", () => {
    const { scene, story } = buildMockSceneStory("a silly space story", [
      { id: "p1", kind: "person", box: { x: 0.6, y: 0.2, w: 0.2, h: 0.7 }, hasFace: true },
      { id: "p2", kind: "person", box: { x: 0.1, y: 0.2, w: 0.2, h: 0.7 }, hasFace: true },
      { id: "pet1", kind: "dog", box: { x: 0.4, y: 0.6, w: 0.2, h: 0.3 }, hasFace: false },
    ]);
    expect(story.theme).toBe("silly sci-fi");
    expect(scene.occupants.map((o) => o.position)).toEqual(["left", "center", "right"]);
    expect(story.characters.map((c) => c.occupantId)).toEqual(["p2", "p1", "pet1"]);
    const roundTrip = normalizeStory(story, new Set(scene.occupants.map((o) => o.id)), story.id);
    expect(roundTrip.shots).toHaveLength(story.shots.length);
    expect(story.shots.every((s) => !/\{[A-Z]+\}/.test(s.narration + s.imagePrompt))).toBe(true);
    expect(roundTrip.shots.map((s) => s.narration)).toEqual(story.shots.map((s) => s.narration));
  });

  it("never invents a human: a lone viewer's co-stars are creatures", () => {
    const { story } = buildMockSceneStory("a silly space story", [
      { id: "p1", kind: "person", box: { x: 0.4, y: 0.2, w: 0.2, h: 0.7 }, hasFace: true },
    ]);
    expect(story.characters.map((c) => c.occupantId)).toEqual(["p1", null, null]);
    expect(story.characters.slice(1).map((c) => c.costume)).toEqual([expect.stringMatching(/robot/), expect.stringMatching(/alien/)]);
    expect(story.shots.some((s) => /stranger|friend|engineer/i.test(s.narration + s.imagePrompt + s.motionPrompt))).toBe(false);
    expect(story.shots[2].motionPrompt).toContain("the robot sidekick stumbles");
  });
});
