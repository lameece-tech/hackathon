import { describe, expect, it } from "vitest";
import { initialEngineState, reduceTransition, type EngineState } from "./machine";
import type { RoundResult } from "./types";

const win: RoundResult = { outcome: "win", headline: "YOU WIN!", detail: "" };
const foul: RoundResult = { outcome: "foul", foul: "TOO_LATE", headline: "TOO LATE!", detail: "" };

function step(state: EngineState, ...args: Parameters<typeof reduceTransition> extends [unknown, ...infer R] ? R : never) {
  const next = reduceTransition(state, ...args);
  if (!next) throw new Error(`illegal ${state.phase} → ${args[0]}`);
  return next;
}

describe("engine state machine", () => {
  it("rejects edges that skip phases", () => {
    const s = initialEngineState();
    expect(reduceTransition(s, "COUNTDOWN", {}, 0)).toBeNull();
    expect(reduceTransition(s, "RESULT", { result: win }, 0)).toBeNull();
  });

  it("requires a game to leave the menu and a result to reach RESULT", () => {
    const s = initialEngineState();
    expect(reduceTransition(s, "READY", {}, 0)).toBeNull();
    const ready = step(s, "READY", { gameId: "rps" }, 0);
    const counting = step(ready, "COUNTDOWN", {}, 1);
    const open = step(counting, "ACTION_WINDOW", {}, 2);
    expect(reduceTransition(open, "RESULT", {}, 3)).toBeNull();
  });

  it("runs a full round, tallies fouls for the house, and resets on MENU", () => {
    let s = step(initialEngineState(), "READY", { gameId: "rps" }, 0);
    s = step(s, "COUNTDOWN", {}, 10);
    s = step(s, "ACTION_WINDOW", { at: 2510 }, 0);
    s = step(s, "EVALUATION", { at: 3010 }, 0);
    expect(s.phaseEnteredAt).toBe(3010);
    s = step(s, "RESULT", { result: win }, 3700);
    s = step(s, "COUNTDOWN", {}, 5000);
    s = step(s, "ACTION_WINDOW", {}, 7500);
    s = step(s, "RESULT", { result: foul }, 8000);
    expect(s).toMatchObject({ round: 2, score: { player: 1, ai: 1, draws: 0 } });
    expect(s.history.map((h) => h.to)).toContain("EVALUATION");
    s = step(s, "MENU", {}, 9000);
    expect(s).toMatchObject({ gameId: null, round: 0, score: { player: 0, ai: 0, draws: 0 } });
  });
});
