export type CueName =
  | "select"
  | "ready"
  | "back"
  | "tick"
  | "riser"
  | "shoot"
  | "reveal"
  | "win"
  | "lose"
  | "draw"
  | "foul";

type Voice = { freq: number; to?: number; start: number; dur: number; type: OscillatorType; gain: number };

// Offsets in seconds relative to the cue's start.
const PATCHES: Record<CueName, Voice[]> = {
  select: [{ freq: 660, start: 0, dur: 0.08, type: "square", gain: 0.12 }],
  ready: [
    { freq: 523, start: 0, dur: 0.1, type: "triangle", gain: 0.25 },
    { freq: 784, start: 0.1, dur: 0.16, type: "triangle", gain: 0.25 },
  ],
  back: [{ freq: 440, to: 220, start: 0, dur: 0.16, type: "triangle", gain: 0.2 }],
  tick: [{ freq: 880, start: 0, dur: 0.07, type: "square", gain: 0.18 }],
  riser: [{ freq: 220, to: 1100, start: 0, dur: 0.5, type: "sawtooth", gain: 0.06 }],
  shoot: [
    { freq: 1320, start: 0, dur: 0.14, type: "square", gain: 0.28 },
    { freq: 1760, start: 0, dur: 0.14, type: "triangle", gain: 0.2 },
  ],
  reveal: [{ freq: 990, to: 660, start: 0, dur: 0.12, type: "triangle", gain: 0.25 }],
  win: [523, 659, 784, 1047].map((freq, i) => ({ freq, start: i * 0.09, dur: 0.18, type: "triangle", gain: 0.3 })),
  lose: [392, 330, 262].map((freq, i) => ({ freq, start: i * 0.14, dur: 0.22, type: "sawtooth", gain: 0.14 })),
  draw: [
    { freq: 587, start: 0, dur: 0.14, type: "triangle", gain: 0.25 },
    { freq: 587, start: 0.18, dur: 0.14, type: "triangle", gain: 0.25 },
  ],
  foul: [
    { freq: 110, start: 0, dur: 0.5, type: "sawtooth", gain: 0.3 },
    { freq: 116, start: 0, dur: 0.5, type: "square", gain: 0.18 },
  ],
};

class CuePlayer {
  private ctx: AudioContext | null = null;
  private scheduled = new Set<OscillatorNode>();

  /** Call from a user gesture (remote key, click) — browsers keep audio suspended until one. */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Play now, or at a performance.now() timestamp so the sound reaches the speaker on time. */
  play(name: CueName, atPerfMs?: number): void {
    this.unlock();
    const ctx = this.ctx!;
    const start = atPerfMs === undefined ? ctx.currentTime : this.toContextTime(ctx, atPerfMs);
    for (const v of PATCHES[name]) this.voice(ctx, v, start);
  }

  /** Drop every sound that hasn't started yet (a round was aborted). */
  cancelScheduled(): void {
    const t = this.ctx?.currentTime ?? 0;
    for (const osc of this.scheduled) {
      try {
        osc.stop(t);
      } catch {
        // already stopped
      }
    }
    this.scheduled.clear();
  }

  private toContextTime(ctx: AudioContext, perfMs: number): number {
    const stamp = ctx.getOutputTimestamp?.();
    const outputLatency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const t =
      stamp?.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0
        ? stamp.contextTime + (perfMs - stamp.performanceTime) / 1000
        : ctx.currentTime + (perfMs - performance.now()) / 1000;
    return Math.max(ctx.currentTime, t - outputLatency);
  }

  private voice(ctx: AudioContext, v: Voice, base: number): void {
    const t0 = base + v.start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.freq, t0);
    if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, t0 + v.dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(v.gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + v.dur + 0.02);
    this.scheduled.add(osc);
    osc.onended = () => this.scheduled.delete(osc);
  }
}

export const cues = new CuePlayer();
