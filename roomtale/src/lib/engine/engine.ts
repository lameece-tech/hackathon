import type {
  Capabilities,
  FilmBlocker,
  SceneAnalysis,
  SceneAnalysisRequest,
  SceneAnalysisResponse,
  ShotVisual,
  Story,
  StoryRequest,
  StoryResponse,
  Subject,
  SubjectHint,
} from "@/lib/story/types";
import { initialState, reduce, type RoomTaleEvent, type RoomTaleState, type Snapshot, type TriggerSource } from "./machine";

export const DEFAULT_PROMPT = "a funny adventure about everyone in the room";
const MAX_PROMPT_CHARS = 500;
/** How long a story request waits for the camera to come up (launch, or a request mid-story). */
const CAMERA_WAIT_MS = 8000;
/** The film premieres once this many opening shots are ready, so playback stays ahead of filming. */
const PREMIERE_SHOTS = 1;
/**
 * …or after this long, whatever is ready (the player buffers like a stream from there).
 * Reference-video models like Seedance take ~6 minutes for a 5-second clip.
 */
const PREMIERE_WAIT_MS = 12 * 60_000;
/** Every frame at once: the provider queues them, and the clips can't start until their frame exists. */
const FRAME_CONCURRENCY = 8;
/** Clips are slow and the provider queues them, so the whole film renders at once. */
const CLIP_CONCURRENCY = 8;
/** Generation fails transiently (rate limits, a flaky upstream); one retry saves most shots. */
const ATTEMPTS = 2;
/** The end credits stay up this long before the mirror comes back. */
const END_CARD_MS = 25_000;
/** The "can't film yet" card stays up this long before the mirror comes back. */
const BLOCKED_CARD_MS = 60_000;
const NOTICE_MS = 7000;

/** Grabs one full-resolution frame from the live camera. Registered by RoomScanner. */
export type Capturer = () => Promise<HTMLCanvasElement>;

export interface EngineDeps {
  /** Encode the frame for the scene-analysis request (and the frozen on-screen snapshot). */
  encodeFrame(frame: HTMLCanvasElement): Snapshot;
  detect(frame: HTMLCanvasElement): Promise<Subject[]>;
  analyzeScene(request: SceneAnalysisRequest, signal: AbortSignal): Promise<SceneAnalysisResponse>;
  generateStory(request: StoryRequest, signal: AbortSignal): Promise<StoryResponse>;
  capabilities(signal: AbortSignal): Promise<Capabilities>;
  /** The shot's opening frame with the cast rendered in from their cutouts; null when it can't be made. */
  renderScene(story: Story, shot: number, subjects: Subject[], signal: AbortSignal): Promise<string | null>;
  /**
   * The shot's clip, animated from its opening frame (and, for reference-video models, the cast's
   * real photos so faces stay theirs); null when it can't be made. Can take minutes.
   */
  animate(story: Story, shot: number, keyframe: string, subjects: Subject[], signal: AbortSignal): Promise<string | null>;
  /** An instrumental score for the film; null when unavailable. */
  score(story: Story, signal: AbortSignal): Promise<string | null>;
  emit(name: string, data?: Record<string, unknown>): void;
  now(): number;
}

export interface RoomTaleEngine {
  getState(): RoomTaleState;
  subscribe(listener: () => void): () => void;
  setCapturer(capturer: Capturer | null): void;
  /** The camera failed or was declined: story requests stop waiting for it. */
  markCameraUnavailable(): void;
  startListening(source: TriggerSource): boolean;
  setTranscript(text: string): void;
  stopListening(): void;
  /** Photo → detection → screenplay → filming, in the background. False if refused in this phase. */
  startStory(prompt: string, source: TriggerSource): boolean;
  /** Same cast, new film, no photo. Falls back to startStory when there is no cast yet. */
  tellAnother(prompt: string, source: TriggerSource): boolean;
  goToShot(shot: number): boolean;
  next(): boolean;
  previous(): boolean;
  setPaused(paused: boolean): boolean;
  finishStory(): void;
  /** Abandon whatever is happening (listening, processing, playback) and show the mirror. */
  returnToMirror(): void;
  notify(kind: "error" | "info", text: string): void;
}

export function cleanPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_CHARS);
}

/** Filming needs both halves: the family rendered into each shot from the photo, and a model to animate it. */
export function filmBlockers(caps: Capabilities): FilmBlocker[] {
  return [...(caps.scenes ? [] : (["scenes"] as const)), ...(caps.video ? [] : (["video"] as const))];
}

function toHint(s: Subject): SubjectHint {
  return { id: s.id, kind: s.kind, box: s.box, hasFace: s.face !== null };
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function viewerMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/429|rate/i.test(text)) return "The movie studio is busy. Try again in a moment.";
  if (/network|fetch/i.test(text)) return "Couldn't reach the movie studio. Check the connection and try again.";
  if (/filmed/i.test(text)) return "The studio couldn't film those opening scenes. Let's try again!";
  return "That movie got lost on the way. Let's try again!";
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs at most `max` of the queued jobs at once, in the order they were queued. */
function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    while (active < max && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  };
  return <T>(job: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        job()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
}

const NO_CAPABILITIES: Capabilities = { story: false, scenes: false, video: null };

export function createRoomTaleEngine(deps: EngineDeps): RoomTaleEngine {
  let state = initialState(deps.now());
  const listeners = new Set<() => void>();

  let capturer: Capturer | null = null;
  let cameraUnavailable = false;
  let capturerWaiters: Array<(c: Capturer | null) => void> = [];

  // Each story request is a run; anything that resolves for an older run is dropped.
  let run = 0;
  let controller: AbortController | null = null;
  let endCardTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(event: RoomTaleEvent): boolean {
    const next = reduce(state, event, deps.now());
    if (next === state) return false;
    const noticeChanged = next.notice !== state.notice;
    state = next;
    if (noticeChanged && state.notice) {
      const shown = state.notice;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        if (state.notice === shown) dispatch({ type: "NOTICE", notice: null });
      }, NOTICE_MS);
    }
    listeners.forEach((l) => l());
    return true;
  }

  function beginRun(): { id: number; signal: AbortSignal } {
    controller?.abort();
    controller = new AbortController();
    clearTimeout(endCardTimer);
    return { id: ++run, signal: controller.signal };
  }

  function cancelRun() {
    controller?.abort();
    controller = null;
    run++;
  }

  const isLive = (id: number) => id === run;

  function flushWaiters(c: Capturer | null) {
    const waiters = capturerWaiters;
    capturerWaiters = [];
    waiters.forEach((w) => w(c));
  }

  function waitForCapturer(ms: number): Promise<Capturer | null> {
    if (capturer) return Promise.resolve(capturer);
    if (cameraUnavailable) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = (c: Capturer | null) => {
        clearTimeout(timer);
        resolve(c);
      };
      const timer = setTimeout(() => {
        capturerWaiters = capturerWaiters.filter((w) => w !== waiter);
        resolve(null);
      }, ms);
      capturerWaiters.push(waiter);
    });
  }

  function warn(what: string) {
    return (err: unknown) => {
      if (!isAbort(err)) console.warn(`[roomtale] ${what} failed`, err);
      return null;
    };
  }

  async function attempt<T>(what: string, make: () => Promise<T | null>): Promise<T | null> {
    for (let i = 0; i < ATTEMPTS; i++) {
      const result = await make().catch(warn(`${what} (attempt ${i + 1})`));
      if (result) return result;
    }
    return null;
  }

  /**
   * Films every shot, in order: its opening frame (the family rendered in from the captured
   * photo), then its clip. Frames render a couple at a time; each clip starts as soon as its
   * frame lands. A shot that still fails after a retry is marked failed and cut from the film.
   * `premiere` resolves once the opening shots are settled either way.
   */
  function filmAll(id: number, signal: AbortSignal, story: Story, subjects: Subject[]): { premiere: Promise<void> } {
    const patch = (shot: number, p: Partial<ShotVisual>) => {
      if (isLive(id)) dispatch({ type: "SHOT_VISUAL", storyId: story.id, shot, patch: p });
    };
    const frameSlot = limiter(FRAME_CONCURRENCY);
    const clipSlot = limiter(CLIP_CONCURRENCY);
    const settled = story.shots.map(() => {
      let resolve: () => void = () => {};
      const done = new Promise<void>((r) => (resolve = r));
      return { done, resolve };
    });

    const filmShot = async (shot: number) => {
      patch(shot, { pending: true });
      const keyframe = await attempt(`frame ${shot + 1}`, () => deps.renderScene(story, shot, subjects, signal));
      if (!isLive(id)) return settled[shot].resolve();
      if (!keyframe) {
        patch(shot, { pending: false, failed: true });
        return settled[shot].resolve();
      }
      patch(shot, { keyframe });
      // The clip runs in its own slot so the next shots' frames keep rendering meanwhile.
      void clipSlot(async () => {
        const video = isLive(id) ? await attempt(`clip ${shot + 1}`, () => deps.animate(story, shot, keyframe, subjects, signal)) : null;
        patch(shot, video ? { video, pending: false } : { pending: false, failed: true });
      }).finally(() => settled[shot].resolve());
    };

    dispatch({ type: "RENDERING", active: true });
    story.shots.forEach((_, shot) => void frameSlot(() => (isLive(id) ? filmShot(shot) : Promise.resolve())));
    void Promise.all(settled.map((s) => s.done)).finally(() => {
      if (isLive(id)) dispatch({ type: "RENDERING", active: false });
    });
    const opening = settled.slice(0, Math.min(PREMIERE_SHOTS, settled.length)).map((s) => s.done);
    return { premiere: Promise.all(opening).then(() => {}) };
  }

  async function present(id: number, signal: AbortSignal, story: Story, scene: SceneAnalysis, mode: StoryResponse["mode"], caps: Promise<Capabilities>) {
    const blockers = filmBlockers(await caps);
    if (!isLive(id)) return;
    // The cast is on screen (casting cards with roles) while the opening shots film.
    dispatch({ type: "CAST_READY", story, scene, mode });
    dispatch({ type: "PROCESS_STEP", step: "rendering" });

    if (blockers.length > 0) {
      dispatch({ type: "FILM_BLOCKED", blockers });
      deps.emit("story_blocked", { missing: blockers });
      clearTimeout(endCardTimer);
      endCardTimer = setTimeout(() => {
        if (isLive(id) && state.filmBlocked) dispatch({ type: "RETURN_TO_MIRROR" });
      }, BLOCKED_CARD_MS);
      return;
    }

    void deps
      .score(story, signal)
      .then((url) => url && isLive(id) && dispatch({ type: "SCORE", storyId: story.id, url }))
      .catch(warn("score"));
    const { premiere } = filmAll(id, signal, story, state.subjects);
    await Promise.race([premiere, delay(PREMIERE_WAIT_MS)]);
    if (!isLive(id)) return;
    const opening = story.shots.slice(0, PREMIERE_SHOTS).map((_, i) => state.visuals[i]);
    if (opening.every((v) => v?.failed)) throw new Error("The opening shots couldn't be filmed.");
    dispatch({ type: "STORY_READY" });
    deps.emit("story_ready", {
      title: story.title,
      shots: story.shots.length,
      cast: story.characters.map((c) => c.name),
      mode,
    });
  }

  function fail(id: number, err: unknown) {
    if (!isLive(id) || isAbort(err)) return;
    console.error("[roomtale] story pipeline failed", err);
    dispatch({ type: "PROCESS_FAILED", message: viewerMessage(err) });
    deps.emit("story_failed", { reason: err instanceof Error ? err.message : String(err) });
  }

  function startStory(rawPrompt: string, source: TriggerSource): boolean {
    const prompt = cleanPrompt(rawPrompt) || DEFAULT_PROMPT;
    if (!dispatch({ type: "PROMPT_ACCEPTED", prompt, source })) return false;
    const { id, signal } = beginRun();
    const caps = deps.capabilities(signal).catch(() => NO_CAPABILITIES);
    void (async () => {
      try {
        const capture = await waitForCapturer(CAMERA_WAIT_MS);
        if (!isLive(id)) return;

        if (!capture) {
          dispatch({ type: "NOTICE", notice: { kind: "info", text: "No camera, so I'll invent the cast this time." } });
          dispatch({ type: "PROCESS_STEP", step: "casting" });
          const res = await deps.generateStory({ prompt }, signal);
          if (isLive(id)) await present(id, signal, res.story, { setting: "", objects: [], occupants: [] }, res.mode, caps);
          return;
        }

        const frame = await capture();
        if (!isLive(id)) return;
        const snapshot = deps.encodeFrame(frame);
        dispatch({ type: "SNAPSHOT", snapshot });

        dispatch({ type: "PROCESS_STEP", step: "detecting" });
        const subjects = await deps.detect(frame).catch((err) => {
          // The vision model still sees the photo, so a detector failure only costs the cutouts.
          console.warn("[roomtale] on-device detection failed", err);
          return [] as Subject[];
        });
        if (!isLive(id)) return;
        dispatch({ type: "SUBJECTS_FOUND", subjects });

        dispatch({ type: "PROCESS_STEP", step: "casting" });
        const res = await deps.analyzeScene(
          { image: snapshot.url, imageSize: { width: snapshot.width, height: snapshot.height }, prompt, subjects: subjects.map(toHint) },
          signal,
        );
        if (isLive(id)) await present(id, signal, res.story, res.scene, res.mode, caps);
      } catch (err) {
        fail(id, err);
      }
    })();
    return true;
  }

  function tellAnother(rawPrompt: string, source: TriggerSource): boolean {
    const { scene, story } = state;
    if (!scene || scene.occupants.length === 0) return startStory(rawPrompt, source);
    const prompt = cleanPrompt(rawPrompt) || DEFAULT_PROMPT;
    if (!dispatch({ type: "PROMPT_ACCEPTED", prompt, source, reuseCast: true })) return false;
    const { id, signal } = beginRun();
    const caps = deps.capabilities(signal).catch(() => NO_CAPABILITIES);
    void (async () => {
      try {
        const res = await deps.generateStory({ prompt, scene, previousTitle: story?.title }, signal);
        if (isLive(id)) await present(id, signal, res.story, scene, res.mode, caps);
      } catch (err) {
        fail(id, err);
      }
    })();
    return true;
  }

  function goToShot(shot: number): boolean {
    return dispatch({ type: "GOTO_SHOT", shot });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCapturer(next) {
      capturer = next;
      if (next) {
        cameraUnavailable = false;
        flushWaiters(next);
      }
    },
    markCameraUnavailable() {
      cameraUnavailable = true;
      flushWaiters(null);
    },
    startListening: (source) => dispatch({ type: "LISTEN_START", source }),
    setTranscript: (text) => void dispatch({ type: "TRANSCRIPT", text }),
    stopListening() {
      if (state.phase === "LISTENING") dispatch({ type: "RETURN_TO_MIRROR" });
    },
    startStory,
    tellAnother,
    goToShot,
    next: () => (state.story && state.shot < state.story.shots.length - 1 ? goToShot(state.shot + 1) : false),
    previous: () => goToShot(state.shot - 1),
    setPaused: (paused) => dispatch({ type: "SET_PAUSED", paused }),
    finishStory() {
      if (!dispatch({ type: "STORY_FINISHED" })) return;
      const story = state.story;
      deps.emit("story_finished", { title: story?.title });
      clearTimeout(endCardTimer);
      endCardTimer = setTimeout(() => {
        if (state.finished && state.story === story) dispatch({ type: "RETURN_TO_MIRROR" });
      }, END_CARD_MS);
    },
    returnToMirror() {
      if (state.phase === "PROCESSING_SCENE") cancelRun();
      clearTimeout(endCardTimer);
      dispatch({ type: "RETURN_TO_MIRROR" });
    },
    notify: (kind, text) => void dispatch({ type: "NOTICE", notice: { kind, text } }),
  };
}
