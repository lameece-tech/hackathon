"use client";

import { useLittleApp } from "@kabletv/little-react";
import { useEffect, useRef, useState } from "react";
import type { Capturer } from "@/lib/engine/engine";
import { useEngine, useEngineState } from "@/lib/engine/EngineProvider";
import { PROCESS_STEPS, type ProcessStep, type RoomTaleState } from "@/lib/engine/machine";
import { acquireCamera, CameraError } from "@/lib/vision/camera";
import { captureFrame } from "@/lib/vision/capture";
import { warmCapture } from "@/lib/vision/detectors";
import { countPresence, type Presence } from "@/lib/vision/subjects";
import type { FilmBlocker, ShotVisual, Story, Subject } from "@/lib/story/types";
import { VoiceListener } from "@/lib/voice/VoiceListener";
import { MicOrb } from "./tv/MicOrb";
import { ScanOverlay } from "./tv/ScanOverlay";
import { Wordmark } from "./tv/Wordmark";

type CameraStatus = "waiting" | "starting" | "ready" | "error";

/** Auto-exposure and white balance need a moment after the camera opens. */
const CAMERA_SETTLE_MS = 700;
const PRESENCE_INTERVAL_MS = 1500;

export interface FilmingProgress {
  ready: number;
  total: number;
  /** Every shot in film order, as far as it's been made. */
  shots?: ShotVisual[];
}

/** Checklist lines, worded for while a step is active and once it's done. */
function stepLabel(step: ProcessStep, done: boolean, found: number, filming: FilmingProgress): string {
  switch (step) {
    case "capturing":
      return done ? "Room captured" : "Capturing the room";
    case "detecting":
      return done ? `${found} ${found === 1 ? "storyteller" : "storytellers"} found` : "Finding everyone";
    case "casting":
      return done ? "Cast ready" : "Casting characters";
    case "rendering": {
      if (done) return "Ready for the premiere";
      if (!filming.total) return "Rolling cameras";
      return `Filming scenes · ${filming.ready} of ${filming.total}`;
    }
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function presenceLabel(p: Presence | null): string | null {
  if (!p || p.people + p.pets === 0) return null;
  const parts = [];
  if (p.people) parts.push(`${p.people} ${p.people === 1 ? "storyteller" : "storytellers"}`);
  if (p.pets) parts.push(`${p.pets} ${p.pets === 1 ? "pet" : "pets"}`);
  return `${parts.join(" + ")} in view`;
}

/**
 * The room-facing half of RoomTale: the live mirrored camera, the voice front door (wake
 * phrase → prompt, browser only; on a Little TV the platform agent hears the viewer), and the
 * off-screen canvas capture the engine calls when a story starts. Shown in IDLE_MIRROR,
 * LISTENING and PROCESSING_SCENE.
 */
export function RoomScanner({ hosted, cameraAllowed }: { hosted: boolean; cameraAllowed: boolean }) {
  const app = useLittleApp();
  const engine = useEngine();
  const state = useEngineState();
  const { phase, step, snapshot, subjects, transcript, prompt } = state;

  const videoRef = useRef<HTMLVideoElement>(null);
  const readyAtRef = useRef(0);
  const [camera, setCamera] = useState<CameraStatus>("waiting");
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [voiceReady, setVoiceReady] = useState(() => !hosted && VoiceListener.supported());

  // --- Live camera --------------------------------------------------------------------
  useEffect(() => {
    if (!cameraAllowed) return;
    let cancelled = false;
    const cam = acquireCamera(app);
    setCamera("starting");
    cam.promise
      .then(async (handle) => {
        const video = videoRef.current;
        if (cancelled || !video) return;
        video.srcObject = handle.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        if (cancelled) return;
        readyAtRef.current = performance.now();
        setCamera("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraError(err instanceof CameraError ? err : new CameraError("no_device", String(err)));
        setCamera("error");
        engine.markCameraUnavailable();
      });
    return () => {
      cancelled = true;
      cam.release();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [app, engine, cameraAllowed]);

  // --- Capture: the engine calls this when a story starts --------------------------------
  useEffect(() => {
    if (camera !== "ready") return;
    const capture: Capturer = async () => {
      const video = videoRef.current;
      if (!video) throw new Error("The camera view is gone.");
      const wait = readyAtRef.current + CAMERA_SETTLE_MS - performance.now();
      if (wait > 0) await delay(wait);
      setFlashKey((k) => k + 1);
      return captureFrame(video);
    };
    engine.setCapturer(capture);
    return () => engine.setCapturer(null);
  }, [camera, engine]);

  // --- Headcount on the idle screen; meanwhile the full-body models load for the capture ---
  useEffect(() => {
    if (camera !== "ready" || (phase !== "IDLE_MIRROR" && phase !== "LISTENING")) return;
    warmCapture();
    let cancelled = false;
    const tick = async () => {
      const video = videoRef.current;
      if (!video || cancelled) return;
      const next = await countPresence(video).catch(() => null);
      if (!cancelled && next) setPresence(next);
    };
    void tick();
    const timer = setInterval(tick, PRESENCE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [camera, phase]);

  // --- Voice (browser): wake phrase while idle, prompt capture while listening ----------
  const listenerRef = useRef<VoiceListener | null>(null);
  useEffect(() => {
    if (hosted || !VoiceListener.supported()) return;
    const listener = new VoiceListener({
      onWake: () => engine.startListening("voice"),
      onTranscript: (text) => engine.setTranscript(text),
      onPrompt: (text) => void engine.startStory(text, engine.getState().source ?? "voice"),
      onNoSpeech: () => engine.stopListening(),
      onError: (code) => {
        if (code === "network") return;
        setVoiceReady(false);
        engine.stopListening();
        engine.notify(
          "error",
          code === "not-allowed" ? "The microphone is blocked. Press OK to start a story instead." : "Voice isn't available here. Press OK to start a story.",
        );
      },
    });
    listenerRef.current = listener;
    return () => {
      listener.dispose();
      listenerRef.current = null;
    };
  }, [hosted, engine]);

  useEffect(() => {
    listenerRef.current?.setMode(phase === "IDLE_MIRROR" ? "wake" : phase === "LISTENING" ? "prompt" : "off");
  }, [phase]);

  const listening = phase === "LISTENING";
  const processing = phase === "PROCESSING_SCENE";
  const presenceText = presenceLabel(presence);
  const stepIndex = step ? PROCESS_STEPS.indexOf(step) : -1;

  return (
    <section
      className="absolute inset-0 overflow-hidden bg-night"
      data-little="region"
      data-little-label="Live room camera"
    >
      {/* Live mirror. The capture reads this element's frames unmirrored. */}
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full -scale-x-100 object-cover transition-[filter,opacity] duration-700 ${
          camera === "ready" ? "opacity-100" : "opacity-0"
        } ${listening ? "brightness-[0.55] saturate-[0.8]" : "brightness-90"}`}
        muted
        playsInline
      />
      {camera !== "ready" && (
        <div className="starfield absolute inset-0 animate-drift bg-[radial-gradient(ellipse_at_top,#1e1b4b,#070712_70%)]" />
      )}

      {processing && snapshot && <ScanOverlay snapshot={snapshot} subjects={subjects} scanning={step === "capturing" || step === "detecting"} />}
      {flashKey > 0 && <div key={flashKey} className="pointer-events-none absolute inset-0 animate-flash bg-white" />}

      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(7,7,18,0.75),transparent_22%,transparent_55%,rgba(7,7,18,0.92))]" />

      {listening && <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_40px_rgba(34,211,238,0.45)]" />}

      <div className="tv-safe absolute inset-0 flex flex-col">
        <header className="flex items-start justify-between">
          <Wordmark />
          <div
            className="flex items-center gap-4"
            data-little="readout"
            data-little-label="RoomTale status"
            data-little-data={JSON.stringify({ phase, step, people: presence?.people ?? null, pets: presence?.pets ?? null, camera })}
          >
            {presenceText && !processing && (
              <span className="glass animate-fade-up rounded-full px-7 py-3 text-[28px] font-bold">{presenceText}</span>
            )}
            <span className="glass flex items-center gap-3 rounded-full px-6 py-3 text-[26px] font-semibold">
              <span className={`h-4 w-4 rounded-full ${camera === "ready" ? "bg-blush shadow-[0_0_14px_#fb7185]" : "bg-white/30"}`} />
              {camera === "ready" ? "Camera on" : camera === "error" ? "Camera off" : "Camera starting"}
            </span>
          </div>
        </header>

        {processing ? (
          <ProcessingHud prompt={prompt} stepIndex={stepIndex} subjects={subjects} story={state.story} filming={filmingProgress(state)} blockers={state.filmBlocked} />
        ) : (
          <div className="mt-auto flex flex-col items-center gap-10 text-center">
            {listening ? (
              <ListeningPanel transcript={transcript} hosted={hosted} />
            ) : (
              <IdlePanel hosted={hosted} voiceReady={voiceReady} cameraError={cameraError} />
            )}
            <MicOrb state={listening ? "listening" : "idle"} meter={!hosted} />
          </div>
        )}
      </div>
    </section>
  );
}

function IdlePanel({ hosted, voiceReady, cameraError }: { hosted: boolean; voiceReady: boolean; cameraError: CameraError | null }) {
  return (
    <div className="flex animate-fade-up flex-col items-center gap-6">
      <h1 className="text-[96px] font-black leading-none tracking-tight text-shadow-tv">Who&apos;s in tonight&apos;s story?</h1>
      {cameraError ? (
        <p className="max-w-[1300px] text-[40px] font-semibold text-white/80 text-shadow-tv">
          {cameraError.viewerHint ?? "The camera is off, so I'll invent the characters."} Ask for a story anyway!
        </p>
      ) : (
        <p className="text-[44px] font-semibold text-white/85 text-shadow-tv">
          {hosted ? (
            <>
              Say <span className="text-glow">&ldquo;Tell a story about everyone here&rdquo;</span>
            </>
          ) : voiceReady ? (
            <>
              Say <span className="text-glow">&ldquo;Hey RoomTale, tell a silly space story about us&rdquo;</span>
            </>
          ) : (
            <>Press OK for a surprise story starring everyone here</>
          )}
        </p>
      )}
      {!hosted && voiceReady && <p className="text-[30px] font-medium text-white/55">or press OK on the remote</p>}
    </div>
  );
}

function ListeningPanel({ transcript, hosted }: { transcript: string; hosted: boolean }) {
  return (
    <div className="flex w-[1500px] flex-col items-center gap-6" data-little="readout" data-little-label="What the viewer is asking for">
      <p className="text-[34px] font-bold uppercase tracking-[0.3em] text-glow text-shadow-tv">Listening</p>
      <p className="min-h-[180px] text-[68px] font-bold leading-tight text-shadow-tv">
        {transcript ? <>&ldquo;{transcript}&rdquo;</> : <span className="text-white/50">What kind of story should I tell?</span>}
        <span className="ml-2 inline-block h-[0.9em] w-[6px] translate-y-[0.12em] animate-caret bg-glow" />
      </p>
      <p className="text-[30px] font-medium text-white/60">{hosted ? "Little is listening" : "Pause when you're done, or press OK"}</p>
    </div>
  );
}

function filmingProgress(state: RoomTaleState): FilmingProgress {
  const total = state.story?.shots.length ?? 0;
  return {
    ready: Object.values(state.visuals).filter((v) => v.video).length,
    total,
    shots: Array.from({ length: total }, (_, i) => state.visuals[i] ?? {}),
  };
}

function useElapsed(): string {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The film's shots as they're made: each frame appears once it's shot and gets a check once its
 * clip is filmed. Clips take minutes, so without this the checklist looks frozen.
 */
function FilmStrip({ shots }: { shots: ShotVisual[] }) {
  const elapsed = useElapsed();
  const framed = shots.filter((s) => s.keyframe).length;
  const filmed = shots.filter((s) => s.video).length;
  return (
    <li
      className="flex flex-col gap-3"
      data-little="readout"
      data-little-label="Filming progress"
      data-little-data={JSON.stringify({ scenesShot: framed, clipsFilmed: filmed, total: shots.length, elapsed })}
    >
      <div className="grid grid-cols-7 gap-1.5">
        {shots.map((s, i) => (
          <div
            key={i}
            className={`relative aspect-video overflow-hidden rounded-lg border-2 ${s.video ? "border-mint" : s.failed ? "border-ember/60" : "border-white/15"}`}
          >
            {s.keyframe ? (
              <img src={s.keyframe} alt="" className={`h-full w-full object-cover ${s.failed ? "opacity-30" : ""}`} />
            ) : (
              <div className="h-full w-full animate-pulse bg-white/10" />
            )}
            {s.video ? (
              <span className="absolute bottom-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full bg-mint text-night">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            ) : (
              s.keyframe && !s.failed && <span className="absolute inset-0 animate-pulse bg-glow/15" />
            )}
          </div>
        ))}
      </div>
      <p className="text-[22px] font-semibold text-white/70">
        {framed} of {shots.length} scenes shot · {filmed} filmed · {elapsed}
      </p>
      <p className="text-[20px] text-white/50">The movie starts as soon as the first clip is ready.</p>
    </li>
  );
}

const SETUP_STEPS: Record<FilmBlocker, { what: string; how: string }> = {
  scenes: { what: "Build everyone into each shot from the photo", how: "OPENAI_API_KEY and ALLOW_PERSON_REFERENCES=true" },
  video: { what: "Animate them into moving footage", how: "RUNWAY_API_KEY (or VIDEO_PROVIDER=sora)" },
};

/** The cast is ready but this server can't film: say exactly what to configure. */
function CantFilmCard({ blockers }: { blockers: FilmBlocker[] }) {
  return (
    <div className="glass absolute right-0 top-[120px] flex w-[720px] animate-pop-in flex-col gap-6 rounded-[36px] border-ember/50 px-11 py-10" data-little="readout" data-little-label="Can't film yet">
      <p className="text-[38px] font-black leading-tight">Your cast is ready, but this server can&apos;t film yet</p>
      <ul className="flex flex-col gap-5">
        {blockers.map((b) => (
          <li key={b} className="flex flex-col gap-1">
            <span className="text-[28px] font-bold text-white/90">{SETUP_STEPS[b].what}</span>
            <span className="font-mono text-[24px] text-ember">{SETUP_STEPS[b].how}</span>
          </li>
        ))}
      </ul>
      <p className="text-[24px] text-white/60">Add them to roomtale/.env.local, restart the dev server, then ask again. Press Back to return.</p>
    </div>
  );
}

function castLabel(subject: Subject, index: number, story: Story | null): { name: string; role: string } {
  const character = story?.characters.find((c) => c.occupantId === subject.id);
  if (character) return { name: character.name, role: character.role };
  return { name: subject.kind === "person" ? `Storyteller ${index + 1}` : subject.kind === "dog" ? "Dog" : "Cat", role: "Casting…" };
}

/** One person's casting card: their full-body cutout on their color, then their role once cast. */
function CastingCard({ subject, index, order, story, width }: { subject: Subject; index: number; order: number; story: Story | null; width: number }) {
  const { name, role } = castLabel(subject, index, story);
  const cast = role !== "Casting…";
  return (
    <div
      className="relative flex shrink-0 animate-fade-up flex-col items-center justify-end overflow-hidden rounded-[28px] border-2 pb-4"
      style={{
        width,
        height: 330,
        animationDelay: `${300 + order * 150}ms`,
        borderColor: `${subject.color}cc`,
        background: `linear-gradient(180deg, ${subject.color}26 0%, ${subject.color}59 100%), rgba(7,7,18,0.55)`,
        boxShadow: `0 0 40px ${subject.color}55, inset 0 0 60px ${subject.color}22`,
      }}
      data-little="item"
      data-little-id={subject.id}
      data-little-label={cast ? `${name}, the ${role}` : name}
    >
      {subject.cutout ? (
        <img src={subject.cutout} alt="" className="absolute inset-x-3 bottom-[72px] top-4 m-auto h-[calc(100%-92px)] w-[calc(100%-24px)] object-contain object-bottom drop-shadow-[0_10px_20px_rgba(0,0,0,0.6)]" />
      ) : (
        <img src={subject.avatar} alt="" className="absolute top-8 h-[180px] w-[180px] rounded-full border-4 object-cover" style={{ borderColor: subject.color }} />
      )}
      <span key={name} className="relative animate-fade-up px-3 text-center text-[30px] font-black leading-tight text-shadow-tv">
        {name}
      </span>
      <span className="relative text-[18px] font-bold uppercase tracking-[0.2em] text-white/70">{role}</span>
    </div>
  );
}

export function ProcessingHud({
  prompt,
  stepIndex,
  subjects,
  story,
  filming,
  blockers = null,
}: {
  prompt: string | null;
  stepIndex: number;
  subjects: Subject[];
  story: Story | null;
  filming: FilmingProgress;
  blockers?: FilmBlocker[] | null;
}) {
  // Right to left in camera order = left to right in the mirrored view, so each card sits under its person.
  const shown = subjects
    .slice(0, 6)
    .map((s, index) => ({ s, index }))
    .reverse();
  const cardWidth = shown.length > 5 ? 250 : 290;
  return (
    <div className="relative flex flex-1 flex-col">
      {prompt && (
        <p className="mx-auto -mt-[72px] max-w-[1200px] animate-fade-up text-center text-[44px] font-semibold italic leading-tight text-shadow-tv">
          &ldquo;{prompt}&rdquo;
        </p>
      )}

      {blockers ? (
        <CantFilmCard blockers={blockers} />
      ) : (
      <ol className="glass absolute right-0 top-[120px] flex w-[600px] flex-col gap-5 rounded-[36px] px-10 py-9">
        {PROCESS_STEPS.map((s, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <li key={s} className={`flex items-center gap-5 text-[32px] font-bold ${done ? "text-white" : active ? "text-white" : "text-white/35"}`}>
              <span className="grid h-12 w-12 shrink-0 place-items-center">
                {done ? (
                  <span className="grid h-11 w-11 place-items-center rounded-full border-[3px] border-mint text-mint">
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                ) : active ? (
                  <span className="h-10 w-10 animate-spin rounded-full border-[4px] border-white/15 border-t-glow" />
                ) : (
                  <span className="h-3 w-3 rounded-full bg-current" />
                )}
              </span>
              <span className={active ? "italic" : undefined}>{stepLabel(s, done, subjects.length, filming)}</span>
            </li>
          );
        })}
        {PROCESS_STEPS[stepIndex] === "rendering" && filming.shots && filming.shots.length > 0 && <FilmStrip shots={filming.shots} />}
      </ol>
      )}

      <div className="mt-auto flex justify-center gap-6" data-little="region" data-little-label="Casting">
        {shown.map(({ s, index }, order) => (
          <CastingCard key={s.id} subject={s} index={index} order={order} story={story} width={cardWidth} />
        ))}
      </div>
    </div>
  );
}
