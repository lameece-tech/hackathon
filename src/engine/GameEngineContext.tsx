import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cues, type CueName } from "../audio/cues";
import { FrameScheduler, now } from "./clock";
import { createEngineStore, type EngineState, type EngineStore, type TransitionRequest } from "./machine";
import type { GameId, Outcome, Phase } from "./types";

const PHASE_CUES: Partial<Record<Phase, CueName>> = {
  MENU: "back",
  READY: "ready",
  COUNTDOWN: "tick",
  ACTION_WINDOW: "riser",
  EVALUATION: "reveal",
};
const RESULT_CUES: Record<Outcome, CueName> = { win: "win", lose: "lose", draw: "draw", foul: "foul" };

export interface TransitionOptions extends TransitionRequest {
  /** Override the phase's default cue; `null` when the game pre-scheduled its own audio. */
  cue?: CueName | null;
  /** Game-local state updates that must paint on the same frame as the phase change. */
  alongside?: () => void;
}

export interface GameEngine {
  store: EngineStore;
  scheduler: FrameScheduler;
  /**
   * Validate against the FSM, then commit synchronously (flushSync) so the DOM for the new
   * phase is in place before this frame paints. Call from event handlers, tool handlers, or
   * scheduler tasks — never during render.
   */
  transition(to: Phase, options?: TransitionOptions): boolean;
  openGame(id: GameId): boolean;
  backToMenu(): boolean;
}

function createGameEngine(): GameEngine {
  const store = createEngineStore(now);
  const scheduler = new FrameScheduler();

  const transition = (to: Phase, options: TransitionOptions = {}): boolean => {
    const { cue, alongside, ...req } = options;
    const committed = { ok: false };
    flushSync(() => {
      committed.ok = store.transition(to, req);
      if (committed.ok) alongside?.();
    });
    if (!committed.ok) return false;

    if (to === "MENU" || to === "READY") {
      scheduler.clear();
      cues.cancelScheduled();
    }
    const name = cue !== undefined ? cue : to === "RESULT" ? RESULT_CUES[req.result!.outcome] : PHASE_CUES[to];
    if (name) cues.play(name);
    return true;
  };

  return {
    store,
    scheduler,
    transition,
    openGame(id) {
      if (store.getState().phase !== "MENU") transition("MENU", { cue: null });
      return transition("READY", { gameId: id });
    },
    backToMenu() {
      return store.getState().phase !== "MENU" && transition("MENU");
    },
  };
}

const EngineContext = createContext<GameEngine | null>(null);

export function GameEngineProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(createGameEngine);
  useEffect(() => () => engine.scheduler.clear(), [engine]);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useGameEngine(): GameEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useGameEngine must be used inside <GameEngineProvider>");
  return engine;
}

export function useEngineState(): EngineState {
  const engine = useGameEngine();
  return useSyncExternalStore(engine.store.subscribe, engine.store.getState);
}

/** The current animation-frame time while `active`, for drawing timers and countdowns. */
export function useFrameNow(active: boolean): number {
  const [time, setTime] = useState(now);
  useEffect(() => {
    if (!active) return;
    let handle = requestAnimationFrame(function loop(frameTime) {
      setTime(frameTime);
      handle = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(handle);
  }, [active]);
  return time;
}
