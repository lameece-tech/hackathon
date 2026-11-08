"use client";

import "@/lib/little/setup";
import { useLittleApp } from "@kabletv/little-react";
import { useEffect, useState } from "react";
import { isHosted } from "@/lib/engine/clientDeps";
import { PROCESS_STEPS, type Snapshot } from "@/lib/engine/machine";
import { MOCK_STORY } from "@/lib/story/mockStory";
import type { ShotVisual, Subject } from "@/lib/story/types";
import { useRemote } from "@/lib/useRemote";
import { encodeFrame } from "@/lib/vision/capture";
import { extractSubjects } from "@/lib/vision/subjects";
import { ProcessingHud } from "./RoomScanner";
import { MoviePlayer } from "./movie/MoviePlayer";
import { ScanOverlay } from "./tv/ScanOverlay";
import { TvStage } from "./tv/TvStage";
import { Wordmark } from "./tv/Wordmark";

/** Pre-rendered opening frames for MOCK_STORY, standing in for the image API. */
const DEMO_FRAMES: Record<number, ShotVisual> = {
  0: { keyframe: "/demo/shot-1.jpg" },
  1: { keyframe: "/demo/shot-2.jpg" },
  2: { keyframe: "/demo/shot-3.jpg" },
  3: { keyframe: "/demo/shot-4.jpg" },
  4: { keyframe: "/demo/shot-5.jpg" },
  5: { keyframe: "/demo/shot-6.jpg" },
};

/** Real clips dropped in as public/demo/shot-N.mp4 (or .webm) turn the preview into the film. */
function useDemoFootage() {
  const [footage, setFootage] = useState<{ visuals: Record<number, ShotVisual>; filmed: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const probe = async (url: string) => ((await fetch(url, { method: "HEAD" }).catch(() => null))?.ok ? url : null);
    void Promise.all(
      MOCK_STORY.shots.map(async (_, i) => (await probe(`/demo/shot-${i + 1}.mp4`)) ?? (await probe(`/demo/shot-${i + 1}.webm`))),
    ).then((clips) => {
      if (cancelled) return;
      const visuals = Object.fromEntries(MOCK_STORY.shots.map((_, i) => [i, clips[i] ? { ...DEMO_FRAMES[i], video: clips[i]! } : DEMO_FRAMES[i]]));
      setFootage({ visuals, filmed: clips.every(Boolean) });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return footage;
}

/** The demo family photo, run through the real capture pipeline: cutouts, outlines, skeletons. */
function useDemoCast() {
  const [cast, setCast] = useState<{ snapshot: Snapshot; subjects: Subject[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const img = new Image();
      img.src = "/demo/cast.jpg";
      await img.decode();
      const frame = document.createElement("canvas");
      frame.width = img.naturalWidth;
      frame.height = img.naturalHeight;
      frame.getContext("2d")!.drawImage(img, 0, 0);
      const subjects = await extractSubjects(frame);
      if (!cancelled) setCast({ snapshot: encodeFrame(frame), subjects });
    })().catch((err) => console.error("[roomtale] demo cast failed", err));
    return () => {
      cancelled = true;
    };
  }, []);
  return cast;
}

/** The full-body capture screen on the demo photo, stepping through the checklist. */
function CaptureDemo({ snapshot, subjects }: { snapshot: Snapshot; subjects: Subject[] }) {
  const [stepIndex, setStepIndex] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setStepIndex((i) => (i >= PROCESS_STEPS.length - 1 ? 1 : i + 1)), 2500);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="absolute inset-0 overflow-hidden bg-night">
      <ScanOverlay snapshot={snapshot} subjects={subjects} scanning={stepIndex <= 1} />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(7,7,18,0.75),transparent_22%,transparent_55%,rgba(7,7,18,0.92))]" />
      <div className="tv-safe absolute inset-0 flex flex-col">
        <header className="flex items-start justify-between">
          <Wordmark />
        </header>
        <ProcessingHud
          prompt="a silly space story about all of us"
          stepIndex={stepIndex}
          subjects={subjects}
          story={stepIndex >= 3 ? MOCK_STORY : null}
          filming={{ ready: stepIndex >= 3 ? 1 : 0, total: MOCK_STORY.shots.length }}
        />
      </div>
    </section>
  );
}

/**
 * The movie player on MOCK_STORY with the real cutout pipeline on a demo family photo. Plays
 * clips from public/demo/shot-N.mp4 when present, otherwise labeled preview frames.
 * `?capture` shows the capture screen instead; `?autoplay` skips the press-OK gate (browsers
 * only allow speech after a user gesture).
 */
export default function PlayerDemo() {
  useLittleApp();
  const [hosted] = useState(isHosted);
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const cast = useDemoCast();
  const footage = useDemoFootage();
  const [started, setStarted] = useState(() => params.has("autoplay"));
  const [shot, setShot] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [run, setRun] = useState(0);

  const restart = () => {
    setShot(0);
    setFinished(false);
    setPaused(false);
    setRun((r) => r + 1);
  };

  useRemote({
    ok() {
      if (!started) setStarted(true);
      else if (finished) restart();
      else setPaused((p) => !p);
    },
    right() {
      setFinished(false);
      setPaused(false);
      setShot((p) => Math.min(MOCK_STORY.shots.length - 1, p + 1));
    },
    left() {
      setFinished(false);
      setPaused(false);
      setShot((p) => Math.max(0, p - 1));
    },
  });

  let content;
  if (!cast || !footage) {
    content = (
      <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_top,#1e1b4b,#070712_70%)]">
        <div className="flex flex-col items-center gap-8">
          <span className="h-16 w-16 animate-spin rounded-full border-[6px] border-white/15 border-t-glow" />
          <span className="text-[40px] font-bold">Casting the demo family…</span>
        </div>
      </div>
    );
  } else if (params.has("capture")) {
    content = <CaptureDemo snapshot={cast.snapshot} subjects={cast.subjects} />;
  } else if (!started) {
    content = (
      <button
        type="button"
        autoFocus
        onClick={() => setStarted(true)}
        className="tv-focus absolute inset-0 flex flex-col items-center justify-center gap-10 bg-[radial-gradient(ellipse_at_top,#1e1b4b,#070712_70%)] text-center"
      >
        <Wordmark size={72} />
        <span className="text-[56px] font-black">{MOCK_STORY.title}</span>
        <span className="rounded-full bg-glow px-14 py-6 text-[40px] font-black text-night">Press OK to play the movie</span>
        <span className="text-[28px] text-white/60">Left and right skip scenes · OK pauses</span>
      </button>
    );
  } else {
    content = (
      <main className="relative h-full w-full overflow-hidden">
        <MoviePlayer
          key={run}
          story={MOCK_STORY}
          subjects={cast.subjects}
          visuals={footage.visuals}
          preview={!footage.filmed}
          shot={shot}
          paused={paused}
          finished={finished}
          onShotChange={setShot}
          onFinished={() => setFinished(true)}
        />
      </main>
    );
  }

  return <TvStage hosted={hosted}>{content}</TvStage>;
}
