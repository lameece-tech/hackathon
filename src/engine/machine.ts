import type { GameId, Phase, PhaseStamp, RoundResult, Score } from "./types";

// Every legal edge. A mid-round edge back to READY is an abort (app paused, camera lost).
export const TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  MENU: ["READY"],
  READY: ["COUNTDOWN", "MENU"],
  COUNTDOWN: ["ACTION_WINDOW", "RESULT", "READY", "MENU"],
  ACTION_WINDOW: ["EVALUATION", "RESULT", "READY", "MENU"],
  EVALUATION: ["RESULT", "READY", "MENU"],
  RESULT: ["COUNTDOWN", "READY", "MENU"],
};

export const ROUND_PHASES: ReadonlySet<Phase> = new Set(["COUNTDOWN", "ACTION_WINDOW", "EVALUATION"]);

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface EngineState {
  phase: Phase;
  gameId: GameId | null;
  round: number;
  phaseEnteredAt: number;
  result: RoundResult | null;
  score: Score;
  history: readonly PhaseStamp[];
}

export interface TransitionRequest {
  /** Timestamp to stamp the transition with (a rAF frame time for frame-exact phases). */
  at?: number;
  /** Required for MENU → READY. */
  gameId?: GameId;
  /** Required for → RESULT. */
  result?: RoundResult;
}

const ZERO: Score = { player: 0, ai: 0, draws: 0 };
const HISTORY_LIMIT = 32;

export function initialEngineState(at = 0): EngineState {
  return { phase: "MENU", gameId: null, round: 0, phaseEnteredAt: at, result: null, score: ZERO, history: [] };
}

function tally(score: Score, result: RoundResult): Score {
  switch (result.outcome) {
    case "win":
      return { ...score, player: score.player + 1 };
    case "draw":
      return { ...score, draws: score.draws + 1 };
    default:
      return { ...score, ai: score.ai + 1 };
  }
}

/** Pure transition. Returns null when the edge is illegal or a required payload is missing. */
export function reduceTransition(state: EngineState, to: Phase, req: TransitionRequest, now: number): EngineState | null {
  const from = state.phase;
  if (!canTransition(from, to)) return null;
  if (from === "MENU" && to === "READY" && !req.gameId) return null;
  if (to === "RESULT" && !req.result) return null;

  const at = req.at ?? now;
  const history = [...state.history.slice(-(HISTORY_LIMIT - 1)), { from, to, at }];
  const base: EngineState = { ...state, phase: to, phaseEnteredAt: at, history };

  switch (to) {
    case "MENU":
      return { ...base, gameId: null, round: 0, result: null, score: ZERO };
    case "READY":
      return from === "MENU" ? { ...base, gameId: req.gameId!, round: 0, result: null, score: ZERO } : { ...base, result: null };
    case "COUNTDOWN":
      return { ...base, round: state.round + 1, result: null };
    case "RESULT":
      return { ...base, result: req.result!, score: tally(state.score, req.result!) };
    default:
      return base;
  }
}

export interface EngineStore {
  getState(): EngineState;
  subscribe(listener: () => void): () => void;
  transition(to: Phase, req?: TransitionRequest): boolean;
}

export function createEngineStore(now: () => number = () => performance.now()): EngineStore {
  let state = initialEngineState(now());
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transition(to, req = {}) {
      const next = reduceTransition(state, to, req, now());
      if (!next) {
        console.warn(`[engine] rejected transition ${state.phase} → ${to}`);
        return false;
      }
      state = next;
      listeners.forEach((l) => l());
      return true;
    },
  };
}
