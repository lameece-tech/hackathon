import type { FilmBlocker, GenerationMode, SceneAnalysis, ShotVisual, Story, Subject } from "@/lib/story/types";

export type Phase = "IDLE_MIRROR" | "LISTENING" | "PROCESSING_SCENE" | "STORY_PLAYBACK";

/** Sub-steps of PROCESSING_SCENE, shown as a checklist while the viewer waits. */
export type ProcessStep = "capturing" | "detecting" | "casting" | "rendering";
export const PROCESS_STEPS: readonly ProcessStep[] = ["capturing", "detecting", "casting", "rendering"];

/** Who started the current action: the wake word, the remote, the TV agent, or the launch params. */
export type TriggerSource = "voice" | "button" | "agent" | "launch";

// Every legal edge. PROCESSING_SCENE is reachable from playback so "tell another one" (or a
// fresh tell_story from the agent) can replace a story mid-play.
export const TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  IDLE_MIRROR: ["LISTENING", "PROCESSING_SCENE"],
  LISTENING: ["IDLE_MIRROR", "PROCESSING_SCENE"],
  PROCESSING_SCENE: ["STORY_PLAYBACK", "IDLE_MIRROR"],
  STORY_PLAYBACK: ["IDLE_MIRROR", "PROCESSING_SCENE"],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface Notice {
  kind: "error" | "info";
  text: string;
  at: number;
}

export interface Snapshot {
  url: string;
  width: number;
  height: number;
}

export interface RoomTaleState {
  phase: Phase;
  phaseEnteredAt: number;
  source: TriggerSource | null;
  /** The live transcript while LISTENING. */
  transcript: string;
  /** The request being turned into a story. */
  prompt: string | null;
  step: ProcessStep | null;
  /** The captured frame (as sent for analysis), frozen on screen during processing. */
  snapshot: Snapshot | null;
  subjects: Subject[];
  scene: SceneAnalysis | null;
  /** Set once cast (during PROCESSING_SCENE, so the casting cards can show roles), kept through playback. */
  story: Story | null;
  mode: GenerationMode | null;
  /** Set when the server can't film (missing providers): the cast is shown, then a setup card. */
  filmBlocked: FilmBlocker[] | null;
  /** Shot index → its footage, filled in as renders and clips arrive. */
  visuals: Readonly<Record<number, ShotVisual>>;
  /** Shots are still being generated for this film. */
  rendering: boolean;
  /** Instrumental score for the film, when the TV provides one. */
  score: string | null;
  /** The shot on screen. */
  shot: number;
  paused: boolean;
  finished: boolean;
  notice: Notice | null;
}

export type RoomTaleEvent =
  | { type: "LISTEN_START"; source: TriggerSource }
  | { type: "TRANSCRIPT"; text: string }
  | { type: "PROMPT_ACCEPTED"; prompt: string; source: TriggerSource; reuseCast?: boolean }
  | { type: "PROCESS_STEP"; step: ProcessStep }
  | { type: "SNAPSHOT"; snapshot: Snapshot }
  | { type: "SUBJECTS_FOUND"; subjects: Subject[] }
  | { type: "CAST_READY"; story: Story; scene: SceneAnalysis; mode: GenerationMode }
  | { type: "FILM_BLOCKED"; blockers: FilmBlocker[] }
  | { type: "STORY_READY" }
  | { type: "PROCESS_FAILED"; message: string }
  | { type: "SHOT_VISUAL"; storyId: string; shot: number; patch: Partial<ShotVisual> }
  | { type: "RENDERING"; active: boolean }
  | { type: "SCORE"; storyId: string; url: string }
  | { type: "GOTO_SHOT"; shot: number }
  | { type: "SET_PAUSED"; paused: boolean }
  | { type: "STORY_FINISHED" }
  | { type: "RETURN_TO_MIRROR" }
  | { type: "NOTICE"; notice: Omit<Notice, "at"> | null };

export function initialState(at = 0): RoomTaleState {
  return {
    phase: "IDLE_MIRROR",
    phaseEnteredAt: at,
    source: null,
    transcript: "",
    prompt: null,
    step: null,
    snapshot: null,
    subjects: [],
    scene: null,
    story: null,
    mode: null,
    filmBlocked: null,
    visuals: {},
    rendering: false,
    score: null,
    shot: 0,
    paused: false,
    finished: false,
    notice: null,
  };
}

function enter(state: RoomTaleState, to: Phase, now: number): RoomTaleState | null {
  if (!canTransition(state.phase, to)) return null;
  return { ...state, phase: to, phaseEnteredAt: now };
}

/** Pure transition. Returns the same object when the event doesn't apply in this phase. */
export function reduce(state: RoomTaleState, event: RoomTaleEvent, now: number): RoomTaleState {
  const { phase } = state;
  switch (event.type) {
    case "LISTEN_START": {
      const next = enter(state, "LISTENING", now);
      return next ? { ...next, source: event.source, transcript: "", notice: null } : state;
    }

    case "TRANSCRIPT":
      return phase === "LISTENING" && event.text !== state.transcript ? { ...state, transcript: event.text } : state;

    case "PROMPT_ACCEPTED": {
      const prompt = event.prompt.trim();
      const next = prompt ? enter(state, "PROCESSING_SCENE", now) : null;
      if (!next) return state;
      const keep = event.reuseCast && state.scene;
      return {
        ...next,
        source: event.source,
        prompt,
        transcript: "",
        step: keep ? "casting" : "capturing",
        snapshot: keep ? state.snapshot : null,
        subjects: keep ? state.subjects : [],
        scene: keep ? state.scene : null,
        story: null,
        mode: null,
        filmBlocked: null,
        visuals: {},
        rendering: false,
        score: null,
        shot: 0,
        paused: false,
        finished: false,
        notice: null,
      };
    }

    case "PROCESS_STEP":
      return phase === "PROCESSING_SCENE" ? { ...state, step: event.step } : state;

    case "SNAPSHOT":
      return phase === "PROCESSING_SCENE" ? { ...state, snapshot: event.snapshot } : state;

    case "SUBJECTS_FOUND":
      return phase === "PROCESSING_SCENE" ? { ...state, subjects: event.subjects } : state;

    case "CAST_READY":
      if (phase !== "PROCESSING_SCENE" || event.story.shots.length === 0) return state;
      return { ...state, story: event.story, scene: event.scene, mode: event.mode, visuals: {}, score: null };

    case "FILM_BLOCKED":
      return phase === "PROCESSING_SCENE" && event.blockers.length > 0 ? { ...state, filmBlocked: event.blockers } : state;

    case "STORY_READY": {
      const next = state.story && !state.filmBlocked && phase === "PROCESSING_SCENE" ? enter(state, "STORY_PLAYBACK", now) : null;
      return next ? { ...next, step: null, shot: 0, paused: false, finished: false } : state;
    }

    case "PROCESS_FAILED": {
      const next = phase === "PROCESSING_SCENE" ? enter(state, "IDLE_MIRROR", now) : null;
      return next ? { ...next, step: null, story: null, rendering: false, notice: { kind: "error", text: event.message, at: now } } : state;
    }

    case "SHOT_VISUAL": {
      if (state.story?.id !== event.storyId) return state;
      const current = state.visuals[event.shot] ?? {};
      return { ...state, visuals: { ...state.visuals, [event.shot]: { ...current, ...event.patch } } };
    }

    case "SCORE":
      return state.story?.id === event.storyId && state.score !== event.url ? { ...state, score: event.url } : state;

    case "RENDERING":
      return state.story && state.rendering !== event.active ? { ...state, rendering: event.active } : state;

    case "GOTO_SHOT": {
      if (phase !== "STORY_PLAYBACK" || !state.story) return state;
      const shot = Math.min(Math.max(0, Math.trunc(event.shot)), state.story.shots.length - 1);
      if (shot === state.shot && !state.finished && !state.paused) return state;
      return { ...state, shot, finished: false, paused: false };
    }

    case "SET_PAUSED":
      return phase === "STORY_PLAYBACK" && !state.finished && state.paused !== event.paused ? { ...state, paused: event.paused } : state;

    case "STORY_FINISHED":
      return phase === "STORY_PLAYBACK" && !state.finished ? { ...state, finished: true, paused: false } : state;

    case "RETURN_TO_MIRROR": {
      const next = enter(state, "IDLE_MIRROR", now);
      // The story and cast stay so "tell another one" can reuse them.
      return next ? { ...next, transcript: "", step: null, paused: false, finished: false, filmBlocked: null } : state;
    }

    case "NOTICE":
      return { ...state, notice: event.notice ? { ...event.notice, at: now } : null };
  }
}
