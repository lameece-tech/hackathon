import type { FoulReason } from "../engine/types";

export type InputSource = "gesture" | "voice" | "motion" | "simulated";

/** One recognizer output. All timestamps are performance.now() milliseconds. */
export interface InputSample<V extends string> {
  source: InputSource;
  /** What the recognizer saw, or null for nothing (no hand, silence, stillness). */
  value: V | null;
  confidence: number;
  /** When the sensor captured it: the camera frame's capture time, or the speech onset. */
  capturedAt: number;
  /** When the recognizer produced it. Always >= capturedAt. */
  receivedAt: number;
}

/** Per-recognizer tuning: what counts as a deliberate input rather than flicker. */
export interface RecognitionTuning {
  /** Consecutive samples of the same value before it counts. */
  stableSamples: number;
  /** Samples below this confidence are treated as "nothing". */
  minConfidence: number;
}

/** Per-round timing. */
export interface WindowSpec {
  opensAt: number;
  /** The scheduled reveal. The authoritative close is whatever frame time `close()` receives. */
  plannedCloseAt: number;
  /** After close, how long samples captured before the close may still arrive (recognizer latency). */
  settleMs: number;
  /** After close, how long to watch for late or switched input. */
  watchMs: number;
  /** "foul" when anything shown before the window opens loses (Quick Draw); "ignore" otherwise. */
  early: "ignore" | "foul";
}

/** A value held for `stableSamples` consecutive samples. */
export interface Commit<V extends string> {
  value: V;
  source: InputSource;
  /** Capture time of the run's first sample: when the player actually showed it. */
  firstSeenAt: number;
  /** Capture time of the sample that made the run stable. */
  confirmedAt: number;
  lastSeenAt: number;
  peakConfidence: number;
}

export type Verdict<V extends string> =
  | { kind: "locked"; locked: Commit<V>; /** How long before the close the locked input first appeared. */ leadMs: number }
  | { kind: "foul"; reason: FoulReason; locked?: Commit<V>; offending?: Commit<V>; /** offending.firstSeenAt − close. */ deltaMs?: number };

export type LogStatus = "accepted" | "stale" | "out_of_order";

export interface LogEntry<V extends string> extends InputSample<V> {
  status: LogStatus;
}

export interface RoundAudit<V extends string> {
  spec: WindowSpec;
  /** The frame time the reveal painted on: the hard boundary every input is judged against. */
  closedAt: number;
  verdict: Verdict<V>;
  commits: readonly Commit<V>[];
  log: readonly LogEntry<V>[];
}

type Status = "idle" | "armed" | "closed" | "final";

interface Run<V extends string> {
  value: V | null;
  source: InputSource;
  first: number;
  last: number;
  count: number;
  peak: number;
  commit: Commit<V> | null;
}

const LOG_LIMIT = 900;

/**
 * Pure verdict over a round's commits. The rules:
 *  - The locked input is the latest commit first seen at or before the close that was still
 *    showing once the window opened. Holding a throw from earlier counts; showing one and
 *    dropping it before the window does not.
 *  - Nothing locked, but something first seen after the close → TOO_LATE. Nothing at all → NO_SHOW.
 *  - Locked, then a different value first seen after the close → SWITCHED.
 *  - With early: "foul", anything first seen before the window opened → EARLY.
 * Judging by first-seen capture time (not by when the recognizer confirmed it) means pipeline
 * latency never makes an honest player late, and nothing first seen after the reveal frame
 * can ever be the locked input.
 */
export function judgeWindow<V extends string>(commits: readonly Commit<V>[], spec: WindowSpec, closedAt: number): Verdict<V> {
  if (spec.early === "foul") {
    const early = commits.find((c) => c.firstSeenAt < spec.opensAt);
    if (early) return { kind: "foul", reason: "EARLY", offending: early, deltaMs: early.firstSeenAt - spec.opensAt };
  }

  const locked = commits.filter((c) => c.firstSeenAt <= closedAt && c.lastSeenAt >= spec.opensAt).at(-1);
  const late = commits.filter((c) => c.firstSeenAt > closedAt && c.firstSeenAt <= closedAt + spec.watchMs);

  if (!locked) {
    const first = late[0];
    return first
      ? { kind: "foul", reason: "TOO_LATE", offending: first, deltaMs: first.firstSeenAt - closedAt }
      : { kind: "foul", reason: "NO_SHOW" };
  }
  const switched = late.find((c) => c.value !== locked.value);
  if (switched) {
    return { kind: "foul", reason: "SWITCHED", locked, offending: switched, deltaMs: switched.firstSeenAt - closedAt };
  }
  return { kind: "locked", locked, leadMs: closedAt - locked.firstSeenAt };
}

/**
 * Owns the action window for one input stream. Recognizers push samples continuously; a
 * game arms a window, closes it on the reveal frame, and finalizes once the settle/watch
 * period has passed. After `close()` the boundary is frozen: no later call can move it,
 * and samples captured before it but delivered too late to be trusted are logged as stale.
 */
export class InputManager<V extends string> {
  private status: Status = "idle";
  private spec: WindowSpec | null = null;
  private closedAt = Number.NaN;
  private run: Run<V> | null = null;
  private lastCapturedAt = -Infinity;
  private commits: Commit<V>[] = [];
  private log: LogEntry<V>[] = [];
  private audit: RoundAudit<V> | null = null;
  private live: V | null = null;
  private listeners = new Set<(value: V | null) => void>();

  constructor(private readonly tuning: RecognitionTuning) {}

  /** The stable value right now, for "I see ✊" feedback. Not an input decision. */
  get liveValue(): V | null {
    return this.live;
  }

  get phase(): Status {
    return this.status;
  }

  /** When `finalize()` may be called: close + the longer of settle and watch. */
  get finalizeAt(): number {
    if (!this.spec || Number.isNaN(this.closedAt)) return Number.NaN;
    return this.closedAt + Math.max(this.spec.settleMs, this.spec.watchMs);
  }

  subscribe(listener: (value: V | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  arm(spec: WindowSpec): void {
    this.spec = { ...spec };
    this.status = "armed";
    this.closedAt = Number.NaN;
    this.commits = [];
    this.log = [];
    this.audit = null;
    // A throw already being held (fist pumping through the countdown) carries into the round.
    if (this.run?.commit) {
      this.run.commit = { ...this.run.commit };
      this.commits.push(this.run.commit);
    }
  }

  /** Freeze the boundary at the reveal frame's timestamp. Returns false if not armed. */
  close(frameTime: number): boolean {
    if (this.status !== "armed" || !this.spec) return false;
    this.closedAt = Math.max(frameTime, this.spec.opensAt);
    this.status = "closed";
    return true;
  }

  /** Abandon the round (abort); live tracking continues. */
  reset(): void {
    this.status = "idle";
    this.spec = null;
    this.closedAt = Number.NaN;
    this.commits = [];
    this.log = [];
    this.audit = null;
  }

  push(sample: InputSample<V>): void {
    if (sample.capturedAt < this.lastCapturedAt) {
      this.record(sample, "out_of_order");
      return;
    }
    if (this.status === "closed") {
      const spec = this.spec!;
      if (sample.capturedAt <= this.closedAt && sample.receivedAt > this.closedAt + spec.settleMs) {
        this.record(sample, "stale");
        return;
      }
    }
    this.lastCapturedAt = sample.capturedAt;
    this.track(sample);
    this.record(sample, "accepted");
  }

  finalize(): RoundAudit<V> {
    if (this.status === "final" && this.audit) return this.audit;
    if (this.status !== "closed" || !this.spec) throw new Error("InputManager.finalize() called before close()");
    const commits = this.commits.map((c) => Object.freeze({ ...c }));
    const verdict = judgeWindow(commits, this.spec, this.closedAt);
    this.audit = Object.freeze({
      spec: Object.freeze({ ...this.spec }),
      closedAt: this.closedAt,
      verdict,
      commits: Object.freeze(commits),
      log: Object.freeze([...this.log]),
    });
    this.status = "final";
    return this.audit;
  }

  private get recording(): boolean {
    return this.status === "armed" || this.status === "closed";
  }

  private record(sample: InputSample<V>, status: LogStatus): void {
    if (!this.recording || this.log.length >= LOG_LIMIT) return;
    this.log.push({ ...sample, status });
  }

  private track(sample: InputSample<V>): void {
    const { stableSamples, minConfidence } = this.tuning;
    const value = sample.value !== null && sample.confidence >= minConfidence ? sample.value : null;
    let run = this.run;
    if (run && run.value === value) {
      run.count++;
      run.last = sample.capturedAt;
      run.peak = Math.max(run.peak, sample.confidence);
    } else {
      run = this.run = {
        value,
        source: sample.source,
        first: sample.capturedAt,
        last: sample.capturedAt,
        count: 1,
        peak: sample.confidence,
        commit: null,
      };
    }

    const stable = run.count >= stableSamples;
    if (stable && run.value !== null) {
      if (!run.commit) {
        run.commit = {
          value: run.value,
          source: run.source,
          firstSeenAt: run.first,
          confirmedAt: sample.capturedAt,
          lastSeenAt: sample.capturedAt,
          peakConfidence: run.peak,
        };
        if (this.recording) this.commits.push(run.commit);
      } else {
        run.commit.lastSeenAt = sample.capturedAt;
        run.commit.peakConfidence = run.peak;
      }
    }

    if (stable && run.value !== this.live) {
      this.live = run.value;
      this.listeners.forEach((l) => l(this.live));
    }
  }
}
