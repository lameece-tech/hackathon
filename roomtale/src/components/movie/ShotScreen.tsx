"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { ShotMood, ShotVisual } from "@/lib/story/types";
import { PICTURE } from "./Titles";

/**
 * How a shot plays: its generated clip; buffering while the clip is still being filmed; or
 * (demo only, without a video provider) its opening frame as a labeled preview.
 */
export type ShotKind = "clip" | "buffer" | "preview";

const MOOD_LIGHT: Record<ShotMood, [string, string]> = {
  cozy: ["#1a0f08", "#f59e0b"],
  exciting: ["#050916", "#38bdf8"],
  funny: ["#0f0920", "#f472b6"],
  mysterious: ["#02030a", "#6366f1"],
  triumphant: ["#140c04", "#fbbf24"],
  dreamy: ["#08081a", "#c084fc"],
};

export interface ShotScreenHandle {
  /** The video element holding a shot's clip (even shots in one, odd shots in the other). */
  videoFor(shot: number): HTMLVideoElement | null;
}

interface Props {
  shot: number;
  /** The shot after this one that will actually play (failed shots are cut), for preloading. */
  nextShot: number | null;
  kind: ShotKind;
  visuals: Readonly<Record<number, ShotVisual>>;
  mood: ShotMood;
}

/**
 * The picture inside the letterbox. Two video elements alternate: while one plays a shot, the
 * other has already loaded the next one, so the cut is instant, like an edit rather than a load.
 */
export const ShotScreen = forwardRef<ShotScreenHandle, Props>(function ShotScreen({ shot, nextShot, kind, visuals, mood }, ref) {
  const slots = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  // Which shot each slot holds. On a cut, the slot that preloaded the new shot comes to the
  // front; the other starts loading the shot after. Idempotent, so it's safe during render.
  const assignment = useRef<{ front: number; shots: Array<number | null> }>({ front: 0, shots: [shot, nextShot] });
  const a = assignment.current;
  if (a.shots[a.front] !== shot) {
    if (a.shots[1 - a.front] === shot) a.front = 1 - a.front;
    else a.shots[a.front] = shot;
  }
  a.shots[1 - a.front] = nextShot;
  const front = a.front;
  useImperativeHandle(ref, () => ({
    videoFor: (s: number) => {
      const i = assignment.current.shots.indexOf(s);
      return i >= 0 ? slots[i].current : null;
    },
  }));

  const srcFor = (slot: number) => {
    const s = a.shots[slot];
    return s === null || s === undefined ? undefined : visuals[s]?.video;
  };
  const frame = visuals[shot]?.keyframe;
  const [base, light] = MOOD_LIGHT[mood];

  return (
    <div className="absolute inset-x-0 overflow-hidden bg-black" style={{ top: PICTURE.top, height: PICTURE.height }}>
      {kind !== "clip" && (
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 70% 70% at 50% 40%, ${light}33, ${base} 75%)` }}>
          {frame && (
            <img
              key={frame}
              src={frame}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover ${kind === "buffer" ? "scale-105 blur-sm brightness-50" : "animate-kenburns-a"}`}
            />
          )}
        </div>
      )}

      {[0, 1].map((slot) => (
        <video
          key={slot}
          ref={slots[slot]}
          src={srcFor(slot)}
          muted
          playsInline
          preload="auto"
          className={`absolute inset-0 h-full w-full object-cover ${kind === "clip" && slot === front ? "opacity-100" : "opacity-0"}`}
        />
      ))}

      {kind === "buffer" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-5 rounded-full bg-black/55 px-8 py-4 backdrop-blur-md">
            <span className="h-9 w-9 animate-spin rounded-full border-[4px] border-white/20 border-t-white" />
            <span className="text-[30px] font-semibold text-white/90">Filming the next scene…</span>
          </div>
        </div>
      )}
      {kind === "preview" && (
        <span className="absolute right-10 top-8 rounded-full bg-black/55 px-5 py-2 text-[20px] font-semibold text-white/80 backdrop-blur-md">
          Preview frame · clips film with a video provider
        </span>
      )}

      <div className="film-grain pointer-events-none absolute inset-0" />
    </div>
  );
});
