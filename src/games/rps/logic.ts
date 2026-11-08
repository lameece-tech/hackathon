import type { RoundResult } from "../../engine/types";
import type { Verdict } from "../../input/InputManager";

export type Throw = "rock" | "paper" | "scissors";

export const THROWS: readonly Throw[] = ["rock", "paper", "scissors"];

export const GESTURE_TO_THROW: Readonly<Record<string, Throw>> = {
  Closed_Fist: "rock",
  Open_Palm: "paper",
  Victory: "scissors",
};

export const THROW_EMOJI: Readonly<Record<Throw, string>> = { rock: "✊", paper: "✋", scissors: "✌️" };

const BEATS: Readonly<Record<Throw, Throw>> = { rock: "scissors", paper: "rock", scissors: "paper" };

export const RPS_TIMING = {
  /** ROCK · PAPER · SCISSORS · SHOOT!, one beat each. */
  beatMs: 1000,
  /** The 500 ms window straddles SHOOT… */
  windowLeadMs: 250,
  /** …and closes on the frame the TV's hand appears, so nothing after the reveal can count. */
  windowTrailMs: 250,
  settleMs: 150,
  /** How long after the reveal a changed hand is still a foul. */
  watchMs: 600,
} as const;

/** Drawn when the round starts, before any input exists, from the platform CSPRNG. */
export function randomThrow(): Throw {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return THROWS[n % THROWS.length];
}

const ms = (value: number) => `${Math.round(Math.abs(value))} ms`;
const upper = (t: Throw) => t.toUpperCase();

export function scoreRound(verdict: Verdict<Throw>, ai: Throw): RoundResult {
  if (verdict.kind === "foul") {
    const late = verdict.deltaMs ?? 0;
    switch (verdict.reason) {
      case "TOO_LATE":
        return {
          outcome: "foul",
          foul: "TOO_LATE",
          headline: "TOO LATE!",
          detail: `Your ${upper(verdict.offending!.value)} showed up ${ms(late)} after my reveal.`,
        };
      case "SWITCHED":
        return {
          outcome: "foul",
          foul: "SWITCHED",
          headline: "NO SWITCHING!",
          detail: `You changed ${upper(verdict.locked!.value)} to ${upper(verdict.offending!.value)} ${ms(late)} after my reveal.`,
        };
      case "EARLY":
        return { outcome: "foul", foul: "EARLY", headline: "TOO EARLY!", detail: "You threw before the window opened." };
      case "NO_SHOW":
        return { outcome: "foul", foul: "NO_SHOW", headline: "NO THROW!", detail: "I didn't see a hand. Keep it in the camera's view." };
    }
  }
  const player = verdict.locked.value;
  if (player === ai) return { outcome: "draw", headline: "DRAW!", detail: `We both threw ${upper(ai)}.` };
  if (BEATS[player] === ai) return { outcome: "win", headline: "YOU WIN!", detail: `${upper(player)} beats ${upper(ai)}.` };
  return { outcome: "lose", headline: "TV WINS!", detail: `${upper(ai)} beats ${upper(player)}.` };
}
