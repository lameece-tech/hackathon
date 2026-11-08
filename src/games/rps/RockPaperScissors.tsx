import { useLittleEvent, useLittleTool, useLittleVisible } from "@kabletv/little-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cues } from "../../audio/cues";
import { now } from "../../engine/clock";
import { useEngineState, useFrameNow, useGameEngine } from "../../engine/GameEngineContext";
import { ROUND_PHASES } from "../../engine/machine";
import type { Outcome } from "../../engine/types";
import type { HandFrame } from "../../input/gestures";
import { InputManager, type InputSample, type InputSource, type RoundAudit } from "../../input/InputManager";
import { FORCE_SIMULATED_INPUT, useHandGestures, useSimulatedHand } from "../../input/useHandGestures";
import { Hud } from "../../ui/Hud";
import { TimingTimeline } from "../../ui/TimingTimeline";
import { GESTURE_TO_THROW, randomThrow, RPS_TIMING, scoreRound, THROW_EMOJI, type Throw } from "./logic";

interface RoundPlan {
  ai: Throw;
  startedAt: number;
  shootAt: number;
  opensAt: number;
  plannedCloseAt: number;
}

const BEAT_WORDS = ["ROCK", "PAPER", "SCISSORS", "SHOOT!"] as const;
const THROW_COLOR: Record<Throw, string> = {
  rock: "var(--color-hot)",
  paper: "var(--color-ice)",
  scissors: "var(--color-volt)",
};
const OUTCOME_COLOR: Record<Outcome, string> = {
  win: "text-go",
  lose: "text-hot",
  draw: "text-ice",
  foul: "text-stop animate-shake",
};

function toSample(source: InputSource, frame: HandFrame): InputSample<Throw> {
  return {
    source,
    value: (frame.gesture && GESTURE_TO_THROW[frame.gesture]) || null,
    confidence: frame.score,
    capturedAt: frame.capturedAt,
    receivedAt: frame.receivedAt,
  };
}

function logRound(round: RoundAudit<Throw>, plan: RoundPlan) {
  const rel = (t: number) => `${(t - round.closedAt).toFixed(1)} ms`;
  console.groupCollapsed(`[rps] reveal @ ${round.closedAt.toFixed(1)} (scheduled ${plan.plannedCloseAt.toFixed(1)}) → ${JSON.stringify(round.verdict.kind === "foul" ? round.verdict.reason : round.verdict.locked.value)}`);
  console.table(
    round.commits.map((c) => ({ value: c.value, firstSeen: rel(c.firstSeenAt), confirmed: rel(c.confirmedAt), lastSeen: rel(c.lastSeenAt) })),
  );
  console.groupEnd();
}

export default function RockPaperScissors() {
  const engine = useGameEngine();
  const { phase, result, round: roundNumber } = useEngineState();
  const visible = useLittleVisible();
  const emit = useLittleEvent();

  const [input] = useState(() => new InputManager<Throw>({ stableSamples: 3, minConfidence: 0.6 }));
  const subscribe = useCallback((onChange: () => void) => input.subscribe(onChange), [input]);
  const live = useSyncExternalStore(subscribe, () => input.liveValue);

  const [plan, setPlan] = useState<RoundPlan | null>(null);
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  const [audit, setAudit] = useState<RoundAudit<Throw> | null>(null);

  const onCameraFrame = useCallback((f: HandFrame) => input.push(toSample("gesture", f)), [input]);
  const onSimulatedFrame = useCallback((f: HandFrame) => input.push(toSample("simulated", f)), [input]);
  const camera = useHandGestures({ enabled: visible && !FORCE_SIMULATED_INPUT, onFrame: onCameraFrame });
  const simulated = FORCE_SIMULATED_INPUT || camera.status === "error";
  useSimulatedHand({ enabled: simulated, onFrame: onSimulatedFrame });

  const inputReady = camera.status === "ready" || simulated;
  const inputReadyRef = useRef(inputReady);
  useEffect(() => {
    inputReadyRef.current = inputReady;
  }, [inputReady]);

  /** Returns why the round couldn't start, or null when it did. */
  const startRound = useCallback((): string | null => {
    const current = engine.store.getState().phase;
    if (current !== "READY" && current !== "RESULT") return "A round is already running.";
    if (!inputReadyRef.current) return "The camera is still starting.";

    const { beatMs, windowLeadMs, windowTrailMs, settleMs, watchMs } = RPS_TIMING;
    const startedAt = now();
    const shootAt = startedAt + 3 * beatMs;
    const next: RoundPlan = {
      ai: randomThrow(),
      startedAt,
      shootAt,
      opensAt: shootAt - windowLeadMs,
      plannedCloseAt: shootAt + windowTrailMs,
    };

    input.arm({ opensAt: next.opensAt, plannedCloseAt: next.plannedCloseAt, settleMs, watchMs, early: "ignore" });
    const started = engine.transition("COUNTDOWN", {
      at: startedAt,
      cue: null,
      alongside: () => {
        setPlan(next);
        setRevealedAt(null);
        setAudit(null);
      },
    });
    if (!started) {
      input.reset();
      return "Couldn't start the round.";
    }

    for (let beat = 0; beat < 3; beat++) cues.play("tick", startedAt + beat * beatMs);
    cues.play("riser", next.opensAt);
    cues.play("shoot", shootAt);
    cues.play("reveal", next.plannedCloseAt);

    engine.scheduler.at(next.opensAt, (frameTime) => {
      engine.transition("ACTION_WINDOW", { at: frameTime, cue: null });
    });
    engine.scheduler.at(next.plannedCloseAt, (frameTime) => {
      // Close before the reveal commits: the TV's hand paints on this frame, so this frame
      // time is the last instant a throw can have been made without seeing it.
      input.close(frameTime);
      engine.transition("EVALUATION", { at: frameTime, cue: null, alongside: () => setRevealedAt(frameTime) });

      engine.scheduler.at(input.finalizeAt, () => {
        const round = input.finalize();
        const outcome = scoreRound(round.verdict, next.ai);
        engine.transition("RESULT", { result: outcome, alongside: () => setAudit(round) });
        const v = round.verdict;
        emit("round_result", {
          outcome: outcome.outcome,
          foul: outcome.foul ?? null,
          player: v.locked?.value ?? null,
          tv: next.ai,
          msBeforeReveal: v.kind === "locked" ? Math.round(v.leadMs) : null,
          msAfterReveal: v.kind === "foul" && v.deltaMs !== undefined ? Math.round(v.deltaMs) : null,
        });
        if (import.meta.env.DEV) logRound(round, next);
      });
    });
    return null;
  }, [engine, input, emit]);

  useLittleTool("start_round", () => {
    const problem = startRound();
    return problem ? { ok: false, detail: problem } : undefined;
  });

  // Off screen mid-round: the timeline can't be trusted, so abandon it.
  useEffect(() => {
    if (visible) return;
    queueMicrotask(() => {
      if (!ROUND_PHASES.has(engine.store.getState().phase)) return;
      input.reset();
      engine.transition("READY", { cue: null });
    });
  }, [visible, engine, input]);

  useEffect(
    () => () => {
      engine.scheduler.clear();
      cues.cancelScheduled();
    },
    [engine],
  );

  const inRound = ROUND_PHASES.has(phase);
  const t = useFrameNow(inRound);
  const beat = plan ? Math.min(3, Math.max(0, Math.floor((t - plan.startedAt) / RPS_TIMING.beatMs))) : 0;
  const revealed = (phase === "EVALUATION" || phase === "RESULT") && plan && revealedAt !== null;
  const verdict = phase === "RESULT" ? audit?.verdict : undefined;
  const yourThrow = verdict ? (verdict.locked?.value ?? null) : live;

  return (
    <div className="flex h-full flex-col gap-8 px-24 py-14">
      <Hud title="ROCK · PAPER · SCISSORS" />

      <section className="flex items-center justify-center gap-12">
        <Panel label="YOU" glow={phase === "ACTION_WINDOW"}>
          <video
            ref={camera.videoRef}
            className={`absolute inset-0 h-full w-full -scale-x-100 object-cover ${simulated ? "hidden" : ""}`}
          />
          {simulated && <span className="text-[220px] leading-none">{live ? THROW_EMOJI[live] : "🫥"}</span>}
          {camera.status === "starting" && <Overlay>STARTING CAMERA…</Overlay>}
          <span
            className="absolute bottom-6 right-8 rounded-full bg-black/70 px-8 py-3 text-5xl font-black"
            data-little="readout"
            data-little-label="Your hand"
            data-little-data={JSON.stringify({ seen: yourThrow })}
          >
            {verdict ? (verdict.locked ? "LOCKED " : "") : ""}
            {yourThrow ? `${THROW_EMOJI[yourThrow]} ${yourThrow.toUpperCase()}` : "NO HAND"}
          </span>
        </Panel>

        <div className="text-7xl font-black text-white/40">VS</div>

        <Panel label="TV" glow={phase === "EVALUATION"}>
          <span
            data-little="readout"
            data-little-label="TV's throw"
            data-little-data={JSON.stringify({ throw: revealed ? plan.ai : null })}
          >
            {revealed ? (
              <span key={revealedAt} className="inline-block animate-reveal text-[240px] leading-none">
                {THROW_EMOJI[plan.ai]}
              </span>
            ) : inRound ? (
              <span key={beat} className="inline-block animate-pump text-[240px] leading-none">
                ✊
              </span>
            ) : (
              <span className="text-[180px] leading-none opacity-40">📺</span>
            )}
          </span>
        </Panel>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center text-center">
        {phase === "READY" && (
          <>
            <p className="text-8xl font-black">SHOW ME YOUR HAND</p>
            <p className="mt-6 text-4xl font-bold text-white/60">
              {simulated
                ? `${camera.error ? `No camera (${camera.error.code}). ` : ""}Keys 1 ✊ · 2 ✋ · 3 ✌️ · 0 hand down`
                : "Throw ✊ ✋ or ✌️ on SHOOT. Changing after the reveal is a foul."}
            </p>
          </>
        )}
        {(phase === "COUNTDOWN" || phase === "ACTION_WINDOW") && (
          <p key={beat} className={`animate-pop text-[200px] font-black leading-none ${beat === 3 ? "text-volt" : ""}`}>
            {BEAT_WORDS[beat]}
          </p>
        )}
        {phase === "EVALUATION" && <p className="animate-pop text-[150px] font-black leading-none text-ice">HOLD IT…</p>}
        {phase === "RESULT" && result && (
          <div data-little="readout" data-little-label="Round result" data-little-data={JSON.stringify(result)}>
            <p className={`text-[160px] font-black leading-none ${OUTCOME_COLOR[result.outcome]}`}>{result.headline}</p>
            <p className="mt-4 text-5xl font-bold text-white/80">{result.detail}</p>
          </div>
        )}
      </section>

      <footer className="flex h-[120px] items-center gap-12">
        {phase === "READY" &&
          (inputReady ? (
            <Button action="start_round" label="Start" onPress={startRound} wide>
              START · PRESS OK OR SAY “START”
            </Button>
          ) : (
            <p className="mx-auto text-4xl font-bold text-white/50">
              {camera.status === "error" ? "Camera unavailable" : "Warming up the camera…"}
            </p>
          ))}
        {inRound && plan && <RoundBar plan={plan} now={revealedAt ?? t} />}
        {phase === "RESULT" && (
          <>
            <div className="flex-1">
              {audit && <TimingTimeline audit={audit} colorOf={(v) => THROW_COLOR[v]} />}
              {audit?.verdict.kind === "locked" && (
                <p className="text-2xl font-bold text-white/60">
                  Locked {Math.round(audit.verdict.leadMs)} ms before the reveal · round {roundNumber}
                </p>
              )}
            </div>
            <Button action="start_round" label="Play again" onPress={startRound}>
              PLAY AGAIN
            </Button>
            <Button action="back_to_menu" label="Menu" onPress={() => engine.backToMenu()} quiet>
              MENU
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}

function Panel({ label, glow, children }: { label: string; glow: boolean; children: ReactNode }) {
  return (
    <div
      className={`relative flex h-[416px] w-[740px] items-center justify-center overflow-hidden rounded-[40px] border-8 bg-panel transition-[border-color,box-shadow] duration-150 ${
        glow ? "border-volt shadow-[0_0_90px_var(--color-volt)]" : "border-white/10"
      }`}
    >
      {children}
      <span className="absolute left-8 top-6 rounded-full bg-black/60 px-6 py-2 text-3xl font-black tracking-widest">{label}</span>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-5xl font-black">{children}</div>;
}

function Button({
  action,
  label,
  onPress,
  children,
  wide,
  quiet,
}: {
  action: string;
  label: string;
  onPress: () => unknown;
  children: ReactNode;
  wide?: boolean;
  quiet?: boolean;
}) {
  return (
    <button
      autoFocus={!quiet}
      onClick={() => void onPress()}
      data-little="control"
      data-little-action={action}
      data-little-label={label}
      className={`tv-button ${wide ? "mx-auto px-20" : ""} ${quiet ? "bg-white/10 text-white" : "bg-hot text-white"}`}
    >
      {children}
    </button>
  );
}

/** The whole round on one bar: beats, the lock-in window, and a playhead that stops on the reveal frame. */
function RoundBar({ plan, now }: { plan: RoundPlan; now: number }) {
  const span = plan.plannedCloseAt - plan.startedAt;
  const frac = (t: number) => Math.min(Math.max((t - plan.startedAt) / span, 0), 1);
  const pct = (t: number) => `${frac(t) * 100}%`;
  const inWindow = now >= plan.opensAt;
  return (
    <div className="relative mx-auto h-[72px] w-[1500px]">
      <div className="absolute inset-x-0 top-6 h-10 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${inWindow ? "bg-volt" : "bg-white/50"}`} style={{ width: pct(now) }} />
      </div>
      <div
        className="absolute top-4 h-14 rounded-xl ring-4 ring-volt"
        style={{ left: pct(plan.opensAt), width: `${((plan.plannedCloseAt - plan.opensAt) / span) * 100}%` }}
      />
      {BEAT_WORDS.map((word, i) => (
        <span
          key={word}
          className="absolute -top-3 -translate-x-1/2 text-xl font-black tracking-widest text-white/60"
          style={{ left: pct(plan.startedAt + i * RPS_TIMING.beatMs) }}
        >
          {word}
        </span>
      ))}
    </div>
  );
}
