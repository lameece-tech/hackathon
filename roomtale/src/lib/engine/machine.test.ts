import { describe, expect, it } from "vitest";
import { MOCK_STORY } from "@/lib/story/mockStory";
import { canTransition, initialState, reduce, type RoomTaleEvent, type RoomTaleState } from "./machine";

const scene = { setting: "living room", objects: [], occupants: [{ id: "p1", kind: "person" as const, description: "person in a hat", position: "center" as const }] };

function run(events: RoomTaleEvent[], from = initialState()): RoomTaleState {
  return events.reduce((s, e, i) => reduce(s, e, i + 1), from);
}

const cast: RoomTaleEvent = { type: "CAST_READY", story: MOCK_STORY, scene, mode: "mock" };
const toPlayback: RoomTaleEvent[] = [{ type: "PROMPT_ACCEPTED", prompt: "a space story", source: "agent" }, cast, { type: "STORY_READY" }];

describe("roomtale machine", () => {
  it("only allows the declared edges", () => {
    expect(canTransition("IDLE_MIRROR", "STORY_PLAYBACK")).toBe(false);
    expect(canTransition("LISTENING", "STORY_PLAYBACK")).toBe(false);
    expect(canTransition("STORY_PLAYBACK", "LISTENING")).toBe(false);
    expect(canTransition("STORY_PLAYBACK", "PROCESSING_SCENE")).toBe(true);
  });

  it("walks idle → listening → processing → cast → playback", () => {
    let s = run([
      { type: "LISTEN_START", source: "voice" },
      { type: "TRANSCRIPT", text: "a silly sci-fi story" },
      { type: "PROMPT_ACCEPTED", prompt: "a silly sci-fi story", source: "voice" },
      { type: "PROCESS_STEP", step: "detecting" },
      cast,
    ]);
    // Cast while still processing: the capture screen shows the roles before scene 1 is ready.
    expect(s.phase).toBe("PROCESSING_SCENE");
    expect(s.story?.id).toBe(MOCK_STORY.id);
    s = reduce(s, { type: "STORY_READY" }, 9);
    expect(s).toMatchObject({ phase: "STORY_PLAYBACK", prompt: "a silly sci-fi story", shot: 0 });
  });

  it("holds on the cast when the server can't film, until the viewer goes back", () => {
    let s = run([{ type: "PROMPT_ACCEPTED", prompt: "pirates", source: "agent" }, cast, { type: "FILM_BLOCKED", blockers: ["video"] }]);
    expect(s.filmBlocked).toEqual(["video"]);
    expect(reduce(s, { type: "STORY_READY" }, 9)).toBe(s);
    s = reduce(s, { type: "RETURN_TO_MIRROR" }, 10);
    expect(s).toMatchObject({ phase: "IDLE_MIRROR", filmBlocked: null });
  });

  it("needs a cast before playback", () => {
    const processing = run([{ type: "PROMPT_ACCEPTED", prompt: "pirates", source: "agent" }]);
    expect(reduce(processing, { type: "STORY_READY" }, 2)).toBe(processing);
  });

  it("returns the same object for events that don't apply", () => {
    const idle = initialState();
    expect(reduce(idle, { type: "TRANSCRIPT", text: "hi" }, 1)).toBe(idle);
    expect(reduce(idle, { type: "GOTO_SHOT", shot: 2 }, 1)).toBe(idle);
    expect(reduce(idle, cast, 1)).toBe(idle);
    expect(reduce(idle, { type: "PROMPT_ACCEPTED", prompt: "   ", source: "agent" }, 1)).toBe(idle);
  });

  it("refuses a second story request while one is processing", () => {
    const processing = run([{ type: "PROMPT_ACCEPTED", prompt: "pirates", source: "agent" }]);
    expect(reduce(processing, { type: "PROMPT_ACCEPTED", prompt: "dinosaurs", source: "agent" }, 9)).toBe(processing);
  });

  it("fails back to the mirror with a notice", () => {
    const s = run([{ type: "PROMPT_ACCEPTED", prompt: "pirates", source: "agent" }, cast, { type: "PROCESS_FAILED", message: "oops" }]);
    expect(s.phase).toBe("IDLE_MIRROR");
    expect(s.story).toBeNull();
    expect(s.notice).toMatchObject({ kind: "error", text: "oops" });
  });

  it("clamps paging and clears pause and finish on navigation", () => {
    let s = run(toPlayback);
    s = reduce(s, { type: "GOTO_SHOT", shot: 99 }, 5);
    expect(s.shot).toBe(MOCK_STORY.shots.length - 1);
    s = reduce(s, { type: "STORY_FINISHED" }, 6);
    expect(s.finished).toBe(true);
    expect(reduce(s, { type: "SET_PAUSED", paused: true }, 7)).toBe(s);
    s = reduce(s, { type: "GOTO_SHOT", shot: -3 }, 8);
    expect(s).toMatchObject({ shot: 0, finished: false, paused: false });
  });

  it("merges shot footage as it arrives, and ignores a replaced film's", () => {
    let s = run([{ type: "PROMPT_ACCEPTED", prompt: "space", source: "agent" }, cast]);
    expect(reduce(s, { type: "SHOT_VISUAL", storyId: "old-story", shot: 0, patch: { keyframe: "k" } }, 5)).toBe(s);
    s = reduce(s, { type: "SHOT_VISUAL", storyId: MOCK_STORY.id, shot: 0, patch: { keyframe: "k", pending: true } }, 5);
    s = reduce(s, { type: "SHOT_VISUAL", storyId: MOCK_STORY.id, shot: 0, patch: { video: "v", pending: false } }, 6);
    expect(s.visuals[0]).toEqual({ keyframe: "k", video: "v", pending: false });
  });

  it("keeps the cast when retelling, and drops it on a fresh scan", () => {
    const withCast = run([...toPlayback, { type: "RETURN_TO_MIRROR" }]);
    expect(withCast.scene).toBe(scene);
    const retell = reduce(withCast, { type: "PROMPT_ACCEPTED", prompt: "again", source: "agent", reuseCast: true }, 9);
    expect(retell).toMatchObject({ phase: "PROCESSING_SCENE", step: "casting", story: null });
    expect(retell.scene).toBe(scene);
    const fresh = reduce(withCast, { type: "PROMPT_ACCEPTED", prompt: "again", source: "agent" }, 9);
    expect(fresh).toMatchObject({ step: "capturing", scene: null, subjects: [] });
  });
});
