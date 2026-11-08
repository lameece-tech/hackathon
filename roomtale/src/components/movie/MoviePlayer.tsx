"use client";

import { useLittleApp } from "@kabletv/little-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { WORDS_PER_SECOND } from "@/lib/story/schema";
import type { ShotVisual, Story, Subject } from "@/lib/story/types";
import { pickNarrator, type Narrator } from "@/lib/voice/narrator";
import { ShotScreen, type ShotKind, type ShotScreenHandle } from "./ShotScreen";
import { EndCredits, LowerThirds, OpeningTitles, ProgressLine, Subtitles, type CastMember } from "./Titles";

/** A clip may slow to this rate to make room for its voiceover (gentle slow motion reads as cinematic). */
const MIN_PLAYBACK_RATE = 0.75;
/** After a clip ends, the cut waits at most this long for the voiceover to finish. */
const MAX_VOICE_HOLD_MS = 2500;
const SCORE_VOLUME = 0.3;
const SCORE_DUCKED = 0.1;

export interface MoviePlayerProps {
  story: Story;
  /** Detected subjects: their cutouts appear in the end credits. */
  subjects?: Subject[];
  /** Shot index → its footage, as it's filmed. */
  visuals?: Readonly<Record<number, ShotVisual>>;
  /** Play opening frames where clips are missing: the demo, without a video provider. */
  preview?: boolean;
  score?: string | null;
  shot: number;
  paused?: boolean;
  finished?: boolean;
  onShotChange(shot: number): void;
  onFinished(): void;
  /** Defaults to the TV's voice when granted, else the browser's speechSynthesis. */
  narrator?: Narrator;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function voiceMs(text: string): number {
  return text ? (text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND) * 1000 + 400 : 0;
}

/** A clip's length, when the file says (streamed WebM reports Infinity). */
function knownDuration(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
}

/** Resolves when the clip ends (or would have, if `ended` never fires). */
function clipEnded(video: HTMLVideoElement): Promise<void> {
  if (video.ended) return Promise.resolve();
  return new Promise((resolve) => {
    const safety = setTimeout(resolve, ((knownDuration(video) ?? 12) / (video.playbackRate || 1)) * 1000 + 3000);
    video.addEventListener(
      "ended",
      () => {
        clearTimeout(safety);
        resolve();
      },
      { once: true },
    );
  });
}

/** The next shot after `from` that will actually play: failed shots are cut from the film. */
function nextPlayable(story: Story, visuals: Readonly<Record<number, ShotVisual>>, from: number): number | null {
  for (let i = from + 1; i < story.shots.length; i++) if (!visuals[i]?.failed) return i;
  return null;
}

/**
 * The film: every shot's generated clip of the family played back to back with hard cuts, the
 * voiceover and subtitles riding on top, opening titles, name cards the first time each
 * character appears, the score ducking under the narration, and rolling end credits. A shot
 * still being filmed buffers like a stream; one that couldn't be filmed is cut. Shot changes are
 * controlled (shot/paused/finished are props) so the TV agent, the remote and the demo all
 * drive the same timeline.
 */
export function MoviePlayer({
  story,
  subjects = [],
  visuals = {},
  preview = false,
  score = null,
  shot,
  paused = false,
  finished = false,
  onShotChange,
  onFinished,
  narrator: narratorProp,
}: MoviePlayerProps) {
  const app = useLittleApp();
  const narrator = useMemo(() => narratorProp ?? pickNarrator(app), [narratorProp, app]);
  const screenRef = useRef<ShotScreenHandle>(null);
  const scoreRef = useRef<HTMLAudioElement>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const onShotChangeRef = useLatest(onShotChange);
  const onFinishedRef = useLatest(onFinished);
  // Read inside the timeline: a later shot's clip arriving must not restart the current one.
  const visualsRef = useLatest(visuals);

  const current = story.shots[Math.min(shot, story.shots.length - 1)];
  const visual = visuals[shot];
  const next = nextPlayable(story, visuals, shot);
  const failed = Boolean(visual?.failed);
  const kind: ShotKind = visual?.video ? "clip" : preview && visual?.keyframe ? "preview" : "buffer";

  const cast = useMemo<CastMember[]>(() => {
    const byId = new Map(subjects.map((s) => [s.id, s]));
    return story.characters.map((c) => ({ character: c, subject: c.occupantId ? byId.get(c.occupantId) : undefined }));
  }, [story, subjects]);
  const introduced = useMemo(() => {
    if (shot < 2) return [];
    const seen = new Set(story.shots.slice(0, shot).flatMap((s) => s.characterIds));
    return current.characterIds.flatMap((id) => (seen.has(id) ? [] : cast.filter((m) => m.character.id === id)));
  }, [shot, story, current, cast]);

  // A shot that couldn't be filmed is cut: move straight on.
  useEffect(() => {
    if (!failed || paused || finished) return;
    if (next !== null) onShotChangeRef.current(next);
    else onFinishedRef.current();
  }, [failed, next, paused, finished, onShotChangeRef, onFinishedRef]);

  // The shot's timeline: play the clip with its voiceover, then cut to the next.
  useEffect(() => {
    if (paused || finished || failed || kind === "buffer") return;
    let alive = true;
    const narrations: Array<{ cancel(): void }> = [];
    const speak = async (text: string, subtitled: boolean) => {
      if (!text || !alive) return;
      setSpeaking(true);
      if (subtitled) setSubtitle(text);
      const n = narrator.speak(text);
      narrations.push(n);
      await n.done;
      if (!alive) return;
      setSpeaking(false);
      if (subtitled) setSubtitle(null);
    };
    const video = kind === "clip" ? screenRef.current?.videoFor(shot) : null;
    setStartedAt(performance.now());

    void (async () => {
      const opening = shot === 0 ? `RoomTale presents ${story.title}.` : "";
      const voiceover = (async () => {
        await sleep(shot === 0 ? 300 : 150);
        await speak(opening, false);
        await speak(current.narration, true);
      })();

      if (video) {
        // Give the voiceover room by easing the clip into gentle slow motion if it must.
        const needed = voiceMs(opening) + voiceMs(current.narration);
        const fit = () => {
          const d = knownDuration(video);
          video.playbackRate = d && needed > d * 1000 ? Math.max(MIN_PLAYBACK_RATE, (d * 1000) / needed) : 1;
        };
        if (video.readyState >= 1) fit();
        else video.addEventListener("loadedmetadata", fit, { once: true });
        video.currentTime = 0;
        await video.play().catch(() => {});
        await clipEnded(video);
        await Promise.race([voiceover, sleep(MAX_VOICE_HOLD_MS)]);
      } else {
        await Promise.all([voiceover, sleep(current.seconds * 1000)]);
      }
      if (!alive) return;
      const after = nextPlayable(story, visualsRef.current, shot);
      if (after !== null) onShotChangeRef.current(after);
      else onFinishedRef.current();
    })();

    return () => {
      alive = false;
      narrations.forEach((n) => n.cancel());
      video?.pause();
      setSpeaking(false);
      setSubtitle(null);
    };
  }, [shot, kind, failed, paused, finished, story, current, narrator, onShotChangeRef, onFinishedRef, visualsRef]);

  // The score: under everything, ducked while the narrator speaks, silent when paused.
  useEffect(() => {
    const audio = scoreRef.current;
    if (!audio) return;
    audio.volume = speaking ? SCORE_DUCKED : SCORE_VOLUME;
    if (paused || finished) audio.pause();
    else void audio.play().catch(() => {});
  }, [speaking, paused, finished, score]);

  const playable = story.shots.map((s, i): number => (visuals[i]?.failed ? 0 : s.seconds));
  const runtime = playable.reduce((a, b) => a + b, 0) || 1;
  const played = playable.slice(0, shot).reduce((a, b) => a + b, 0);
  const filmed = story.shots.reduce((t, s, i) => t + (visuals[i]?.video ? s.seconds : 0), 0);
  const last = visuals[story.shots.length - 1];

  return (
    <section
      className="absolute inset-0 overflow-hidden bg-black"
      data-little="region"
      data-little-label={`Movie: ${story.title}`}
      data-little-data={JSON.stringify({ shot: shot + 1, shots: story.shots.length, paused, finished, buffering: kind === "buffer" })}
    >
      {score && <audio ref={scoreRef} src={score} loop autoPlay />}

      {finished ? (
        <EndCredits title={story.title} cast={cast} backdrop={last?.keyframe} scored={Boolean(score)} />
      ) : (
        <>
          <ShotScreen ref={screenRef} shot={shot} nextShot={next} kind={kind} visuals={visuals} mood={current.mood} />
          {kind !== "buffer" && <OpeningTitles shot={shot} title={story.title} cast={cast} startedAt={startedAt} />}
          {kind !== "buffer" && <LowerThirds members={introduced} startedAt={startedAt} />}
          <Subtitles text={subtitle} />
          <ProgressLine played={played / runtime} filmed={filmed / runtime} />
        </>
      )}

      {paused && !finished && (
        <div className="absolute inset-0 grid place-items-center bg-black/55">
          <div className="flex animate-pop-in flex-col items-center gap-6 text-center" data-little="readout" data-little-label="Movie paused">
            <div className="flex gap-6">
              <span className="h-32 w-11 rounded-2xl bg-white" />
              <span className="h-32 w-11 rounded-2xl bg-white" />
            </div>
            <p className="text-[52px] font-black">{story.title}</p>
            <p className="text-[30px] font-semibold text-white/70">Paused · say &ldquo;resume&rdquo; or press OK</p>
          </div>
        </div>
      )}
    </section>
  );
}
