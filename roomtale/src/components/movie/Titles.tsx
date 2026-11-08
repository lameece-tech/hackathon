"use client";

import type { StoryCharacter, Subject } from "@/lib/story/types";

/** The picture area inside the 2.39:1 letterbox, on the 1920×1080 stage. */
export const PICTURE = { top: 138, height: 804 } as const;

export interface CastMember {
  character: StoryCharacter;
  subject: Subject | undefined;
}

/** Film subtitles in the lower letterbox bar. */
export function Subtitles({ text }: { text: string | null }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center justify-center px-[200px]"
      style={{ height: PICTURE.top }}
      data-little="readout"
      data-little-label="Narration"
    >
      {text && (
        <p key={text} className="animate-[fade-up_300ms_ease-out_both] text-center text-[38px] font-semibold leading-[1.25] text-white/95">
          {text}
        </p>
      )}
    </div>
  );
}

/** "RoomTale presents" → the title, over the opening shot; the cast over the second. */
export function OpeningTitles({ shot, title, cast, startedAt }: { shot: number; title: string; cast: CastMember[]; startedAt: number }) {
  if (shot === 0) {
    return (
      <div key={startedAt} className="pointer-events-none absolute inset-x-0 grid place-items-center" style={{ top: PICTURE.top, height: PICTURE.height }}>
        <div className="relative text-center">
          <p className="animate-[tag_3000ms_ease-out_both] text-[30px] font-bold uppercase tracking-[0.6em] text-white/85 [text-shadow:0_2px_20px_rgba(0,0,0,0.8)]">
            RoomTale presents
          </p>
          <h1
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-[120px] font-black tracking-tight opacity-0 [text-shadow:0_6px_40px_rgba(0,0,0,0.85)]"
            style={{ animation: "tag 5200ms ease-out 2600ms both" }}
          >
            {title}
          </h1>
        </div>
      </div>
    );
  }
  if (shot === 1) {
    const names = cast.map((m) => m.character.name);
    return (
      <div key={startedAt} className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: PICTURE.top + PICTURE.height - 190 }}>
        <p className="animate-[tag_4500ms_ease-out_both] whitespace-nowrap text-center text-[28px] font-semibold uppercase tracking-[0.22em] text-white/90 [text-shadow:0_2px_20px_rgba(0,0,0,0.9)]">
          <span className="mr-6 text-white/60">Starring</span>
          {names.join("  ·  ")}
        </p>
      </div>
    );
  }
  return null;
}

/** A character's name card the first time they're on screen, film-style, lower left. */
export function LowerThirds({ members, startedAt }: { members: CastMember[]; startedAt: number }) {
  if (members.length === 0) return null;
  return (
    <div key={startedAt} className="pointer-events-none absolute left-[110px] flex flex-col gap-4" style={{ top: PICTURE.top + PICTURE.height - 60 - members.length * 96 }}>
      {members.map((m, i) => (
        <div key={m.character.id} className="flex items-stretch gap-4 opacity-0" style={{ animation: `tag 4200ms ease-out ${800 + i * 500}ms both` }}>
          <span className="w-[6px] rounded-full" style={{ background: m.character.accentColor }} />
          <div className="[text-shadow:0_2px_16px_rgba(0,0,0,0.9)]">
            <p className="text-[40px] font-black leading-tight">{m.character.name}</p>
            {m.character.playedBy && <p className="text-[22px] font-semibold text-white/75">played by the {m.character.playedBy}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rolling end credits: the cast as their real full-body cutouts, then the crew. */
export function EndCredits({ title, cast, backdrop, scored }: { title: string; cast: CastMember[]; backdrop?: string; scored: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black" data-little="readout" data-little-label="End credits">
      {backdrop && <img src={backdrop} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />}
      <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-16 pb-[400px] text-center" style={{ animation: "credits 26s linear both" }}>
        <div className="h-[760px]" />
        <h1 className="text-[110px] font-black tracking-tight">The End</h1>
        <p className="text-[36px] font-semibold text-white/70">{title}</p>
        <p className="mt-10 text-[30px] font-bold uppercase tracking-[0.5em] text-white/60">Starring</p>
        <div className="flex flex-wrap items-end justify-center gap-16">
          {cast.map((m) => (
            <div key={m.character.id} className="flex flex-col items-center gap-3">
              {m.subject?.cutout ? (
                <img src={m.subject.cutout} alt="" className="h-[340px] w-auto" style={{ filter: `drop-shadow(0 0 30px ${m.subject.color}88)` }} />
              ) : m.subject ? (
                <img src={m.subject.avatar} alt="" className="h-[200px] w-[200px] rounded-full object-cover" />
              ) : null}
              <span className="text-[38px] font-black">{m.character.name}</span>
              {m.character.playedBy && <span className="text-[24px] text-white/65">{m.character.playedBy}</span>}
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col gap-4 text-[30px] text-white/75">
          <p>
            <span className="text-white/50">Written and directed by</span> RoomTale and you
          </p>
          <p>
            <span className="text-white/50">Filmed in</span> your living room
          </p>
          {scored && (
            <p>
              <span className="text-white/50">Original score by</span> Little
            </p>
          )}
        </div>
        <p className="mt-24 text-[40px] font-bold text-glow">Say &ldquo;tell another story&rdquo; for a sequel with the same cast</p>
      </div>
    </div>
  );
}

/** The film's progress along the bottom edge: watched, and filmed so far. */
export function ProgressLine({ played, filmed }: { played: number; filmed: number }) {
  return (
    <div className="absolute inset-x-[110px] bottom-6 h-[4px] overflow-hidden rounded-full bg-white/10">
      <div className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-700" style={{ width: `${filmed * 100}%` }} />
      <div className="absolute inset-y-0 left-0 bg-white/80 transition-[width] duration-700" style={{ width: `${played * 100}%` }} />
    </div>
  );
}
