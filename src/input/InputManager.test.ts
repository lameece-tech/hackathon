import { describe, expect, it } from "vitest";
import { InputManager, type InputSample, type WindowSpec } from "./InputManager";

type Throw = "rock" | "paper" | "scissors";

const FRAME_MS = 33;
const LATENCY_MS = 40;
const CLOSE = 3250;
const SPEC: WindowSpec = { opensAt: 2750, plannedCloseAt: CLOSE, settleMs: 150, watchMs: 600, early: "ignore" };

function segOf<V extends string>(from: number, to: number, value: V | null, confidence = 0.9): InputSample<V>[] {
  const out: InputSample<V>[] = [];
  for (let t = from; t <= to; t += FRAME_MS) {
    out.push({ source: "gesture", value, confidence, capturedAt: t, receivedAt: t + LATENCY_MS });
  }
  return out;
}

const seg = (from: number, to: number, value: Throw | null, confidence?: number) => segOf<Throw>(from, to, value, confidence);

/** Deliver samples in arrival order and close the window when the clock reaches the reveal, as the app does. */
function play<V extends string>(samples: InputSample<V>[], spec: WindowSpec = SPEC, closeAt = CLOSE) {
  const im = new InputManager<V>({ stableSamples: 3, minConfidence: 0.6 });
  im.arm(spec);
  for (const s of [...samples].sort((a, b) => a.receivedAt - b.receivedAt)) {
    if (im.phase === "armed" && s.receivedAt >= closeAt) im.close(closeAt);
    im.push(s);
  }
  if (im.phase === "armed") im.close(closeAt);
  return im.finalize();
}

describe("InputManager action window", () => {
  it("locks a throw shown inside the window", () => {
    const { verdict } = play<Throw>([...seg(0, 2799, null), ...seg(2800, 3900, "rock")]);
    expect(verdict).toMatchObject({ kind: "locked", locked: { value: "rock", firstSeenAt: 2800 }, leadMs: 450 });
  });

  it("counts a throw held since the countdown (fist pumping)", () => {
    const { verdict } = play<Throw>(seg(0, 3900, "rock"));
    expect(verdict).toMatchObject({ kind: "locked", locked: { value: "rock" } });
  });

  it("ignores a throw shown and dropped before the window opened", () => {
    const { verdict } = play<Throw>([...seg(0, 999, null), ...seg(1000, 1500, "paper"), ...seg(1501, 3900, null)]);
    expect(verdict).toEqual({ kind: "foul", reason: "NO_SHOW" });
  });

  it("fouls TOO_LATE when the first throw appears after the reveal frame", () => {
    const { verdict } = play<Throw>([...seg(0, 3399, null), ...seg(3400, 3900, "scissors")]);
    expect(verdict).toMatchObject({ kind: "foul", reason: "TOO_LATE", offending: { value: "scissors" } });
    if (verdict.kind === "foul") expect(verdict.deltaMs).toBeGreaterThan(0);
  });

  it("fouls SWITCHED when the hand changes after the reveal", () => {
    const { verdict } = play<Throw>([...seg(0, 2999, null), ...seg(3000, 3449, "rock"), ...seg(3450, 3900, "paper")]);
    expect(verdict).toMatchObject({
      kind: "foul",
      reason: "SWITCHED",
      locked: { value: "rock" },
      offending: { value: "paper" },
    });
  });

  it("allows changing your mind before the reveal", () => {
    const { verdict } = play<Throw>([...seg(2800, 3099, "rock"), ...seg(3100, 3900, "scissors")]);
    expect(verdict).toMatchObject({ kind: "locked", locked: { value: "scissors" } });
  });

  it("judges by capture time, so a throw first seen 20ms before the reveal locks even though it confirms after", () => {
    const { verdict } = play<Throw>([...seg(0, 3229, null), ...seg(3230, 3900, "paper")]);
    expect(verdict).toMatchObject({ kind: "locked", locked: { value: "paper", firstSeenAt: 3230 }, leadMs: 20 });
  });

  it("drops samples captured before the close that arrive after the settle period", () => {
    const stale: InputSample<Throw>[] = [3200, 3210, 3220].map((t) => ({
      source: "gesture",
      value: "rock",
      confidence: 0.9,
      capturedAt: t,
      receivedAt: CLOSE + SPEC.settleMs + 50,
    }));
    const audit = play<Throw>([...seg(0, 3199, null), ...stale]);
    expect(audit.verdict).toEqual({ kind: "foul", reason: "NO_SHOW" });
    expect(audit.log.filter((e) => e.status === "stale")).toHaveLength(3);
  });

  it("ignores two-frame flicker of another gesture after the reveal", () => {
    const { verdict } = play<Throw>([...seg(2800, 3330, "rock"), ...seg(3333, 3366, "paper"), ...seg(3399, 3900, "rock")]);
    expect(verdict).toMatchObject({ kind: "locked", locked: { value: "rock" } });
  });

  it("treats low-confidence frames as no input", () => {
    const { verdict } = play<Throw>(seg(2800, 3900, "rock", 0.3));
    expect(verdict).toEqual({ kind: "foul", reason: "NO_SHOW" });
  });

  it("fouls EARLY when the game forbids moving before the window", () => {
    const spec: WindowSpec = { ...SPEC, early: "foul" };
    const { verdict } = play<"up">([...segOf<"up">(0, 999, null), ...segOf<"up">(1000, 3900, "up")], spec);
    expect(verdict).toMatchObject({ kind: "foul", reason: "EARLY" });
  });

  it("freezes the boundary once closed", () => {
    const im = new InputManager<Throw>({ stableSamples: 3, minConfidence: 0.6 });
    im.arm(SPEC);
    expect(im.close(CLOSE)).toBe(true);
    expect(im.close(CLOSE + 500)).toBe(false);
    expect(im.finalize().closedAt).toBe(CLOSE);
  });

  it("logs and discards out-of-order samples", () => {
    const im = new InputManager<Throw>({ stableSamples: 1, minConfidence: 0.6 });
    im.arm(SPEC);
    im.push({ source: "gesture", value: "rock", confidence: 0.9, capturedAt: 3000, receivedAt: 3040 });
    im.push({ source: "gesture", value: "paper", confidence: 0.9, capturedAt: 2990, receivedAt: 3045 });
    im.close(CLOSE);
    const audit = im.finalize();
    expect(audit.log.map((e) => e.status)).toEqual(["accepted", "out_of_order"]);
    expect(audit.verdict).toMatchObject({ kind: "locked", locked: { value: "rock" } });
  });
});
