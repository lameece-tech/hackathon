import { describe, expect, it, vi } from "vitest";
import { buildMockSceneStory, buildMockStory } from "@/lib/story/mockStory";
import type { Subject } from "@/lib/story/types";
import { createRoomTaleEngine, type EngineDeps } from "./engine";

const subject: Subject = {
  id: "p1",
  kind: "person",
  color: "#22D3EE",
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.7 },
  face: null,
  avatar: "data:image/jpeg;base64,AA",
  cutout: "data:image/webp;base64,AA",
  outline: null,
  cutoutBox: null,
  pose: null,
  score: 0.9,
};
const fakeFrame = {} as HTMLCanvasElement;
const FILMABLE = { story: true, scenes: true, video: "runway" };

function setup(overrides: Partial<EngineDeps> = {}) {
  const emit = vi.fn();
  const deps: EngineDeps = {
    encodeFrame: () => ({ url: "data:image/jpeg;base64,AAAA", width: 1536, height: 864 }),
    detect: vi.fn(async () => [subject]),
    analyzeScene: vi.fn(async (req) => buildMockSceneStory(req.prompt, req.subjects)),
    generateStory: vi.fn(async (req) => ({ story: buildMockStory(req.prompt, req.scene), mode: "mock" as const })),
    capabilities: vi.fn(async () => FILMABLE),
    renderScene: vi.fn(async (_story, shot: number) => `frame-${shot}`),
    animate: vi.fn(async (_story, shot: number) => `clip-${shot}`),
    score: vi.fn(async () => null),
    emit,
    now: () => 0,
    ...overrides,
  };
  return { engine: createRoomTaleEngine(deps), deps, emit };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(check: () => boolean) {
  for (let i = 0; i < 80 && !check(); i++) await settle();
}

describe("roomtale engine", () => {
  it("runs capture → detect → screenplay → filming → premiere and reports it", async () => {
    const { engine, deps, emit } = setup();
    engine.setCapturer(async () => fakeFrame);
    expect(engine.startStory("a pirate story about us", "agent")).toBe(true);
    await until(() => engine.getState().phase === "STORY_PLAYBACK");

    const s = engine.getState();
    expect(s.phase).toBe("STORY_PLAYBACK");
    expect(s.subjects).toEqual([subject]);
    expect(s.story?.characters[0].occupantId).toBe("p1");
    expect(deps.analyzeScene).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a pirate story about us", subjects: [{ id: "p1", kind: "person", box: subject.box, hasFace: false }] }),
      expect.any(AbortSignal),
    );
    expect(emit).toHaveBeenCalledWith("story_ready", expect.objectContaining({ title: s.story?.title }));
  });

  it("films every shot as a frame built from the photo, then a clip animated from it", async () => {
    const { engine, deps } = setup({ score: vi.fn(async () => "score.mp3") });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().phase === "STORY_PLAYBACK" && !engine.getState().rendering);

    const { visuals, story, score } = engine.getState();
    expect(score).toBe("score.mp3");
    story!.shots.forEach((_, i) => expect(visuals[i]).toEqual({ keyframe: `frame-${i}`, video: `clip-${i}`, pending: false }));
    expect(deps.renderScene).toHaveBeenCalledWith(expect.anything(), 0, [subject], expect.any(AbortSignal));
    expect(deps.animate).toHaveBeenCalledWith(expect.anything(), 0, "frame-0", expect.any(Array), expect.any(AbortSignal));
  });

  it("premieres only once the opening clips are in", async () => {
    let releaseClips: () => void = () => {};
    const clipsGate = new Promise<void>((r) => (releaseClips = r));
    const { engine } = setup({
      animate: vi.fn(async (_story, shot: number) => {
        await clipsGate;
        return `clip-${shot}`;
      }),
    });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().visuals[0]?.keyframe !== undefined);
    await settle();
    expect(engine.getState().phase).toBe("PROCESSING_SCENE");
    releaseClips();
    await until(() => engine.getState().phase === "STORY_PLAYBACK");
    expect(engine.getState().visuals[0]?.video).toBe("clip-0");
  });

  it("retries a shot once, then cuts it from the film", async () => {
    const renderScene = vi.fn(async (_story, shot: number) => (shot === 2 ? null : `frame-${shot}`));
    const { engine } = setup({ renderScene });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().phase === "STORY_PLAYBACK" && !engine.getState().rendering);
    expect(engine.getState().visuals[2]).toEqual({ pending: false, failed: true });
    expect(renderScene.mock.calls.filter(([, shot]) => shot === 2)).toHaveLength(2);
    expect(engine.getState().visuals[3]?.video).toBe("clip-3");
  });

  it("casts everyone, then says what's missing when the server can't film", async () => {
    const { engine, deps, emit } = setup({ capabilities: vi.fn(async () => ({ story: true, scenes: false, video: null })) });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().filmBlocked !== null);
    const s = engine.getState();
    expect(s.phase).toBe("PROCESSING_SCENE");
    expect(s.story).not.toBeNull();
    expect(s.filmBlocked).toEqual(["scenes", "video"]);
    expect(deps.renderScene).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("story_blocked", { missing: ["scenes", "video"] });
    engine.returnToMirror();
    expect(engine.getState()).toMatchObject({ phase: "IDLE_MIRROR", filmBlocked: null });
  });

  it("fails with a notice when the opening can't be filmed", async () => {
    const { engine } = setup({ renderScene: vi.fn(async () => null) });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().phase === "IDLE_MIRROR");
    expect(engine.getState().notice?.text).toMatch(/couldn't film/);
  });

  it("invents the cast without waiting when the camera is unavailable", async () => {
    const { engine, deps } = setup();
    engine.markCameraUnavailable();
    engine.startStory("a dinosaur story", "agent");
    await until(() => engine.getState().phase === "STORY_PLAYBACK");
    expect(deps.detect).not.toHaveBeenCalled();
    expect(deps.generateStory).toHaveBeenCalled();
  });

  it("drops a cancelled run's late result", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { engine } = setup({
      analyzeScene: async (req) => {
        await gate;
        return buildMockSceneStory(req.prompt, req.subjects);
      },
    });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().step === "casting");
    engine.returnToMirror();
    release();
    await settle();
    await settle();
    expect(engine.getState().phase).toBe("IDLE_MIRROR");
    expect(engine.getState().story).toBeNull();
  });

  it("surfaces a failure as a viewer-friendly notice", async () => {
    const { engine, emit } = setup({ analyzeScene: async () => Promise.reject(new Error("/api/scene-analysis 429: rate limited")) });
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().phase === "IDLE_MIRROR");
    expect(engine.getState().notice?.text).toMatch(/busy/);
    expect(emit).toHaveBeenCalledWith("story_failed", expect.anything());
  });

  it("retells with the same cast and no new photo", async () => {
    const { engine, deps } = setup();
    engine.setCapturer(async () => fakeFrame);
    engine.startStory("space", "agent");
    await until(() => engine.getState().phase === "STORY_PLAYBACK");
    const first = engine.getState().story;
    engine.tellAnother("now pirates", "agent");
    await until(() => engine.getState().phase === "STORY_PLAYBACK" && engine.getState().story !== first);
    expect(deps.detect).toHaveBeenCalledTimes(1);
    expect(deps.generateStory).toHaveBeenCalledWith(expect.objectContaining({ prompt: "now pirates", previousTitle: first?.title }), expect.any(AbortSignal));
    expect(engine.getState().subjects).toEqual([subject]);
  });
});
