"use client";

import type { CSSProperties } from "react";
import type { Snapshot } from "@/lib/engine/machine";
import type { NormBox, Subject } from "@/lib/story/types";
import { visibleJoints, visibleSegments } from "@/lib/vision/skeleton";

export const STAGE = { width: 1920, height: 1080 } as const;

/** Where an object-cover image of size w×h lands on the stage. */
export function coverRect(w: number, h: number) {
  const k = Math.max(STAGE.width / w, STAGE.height / h);
  const width = w * k;
  const height = h * k;
  return { width, height, left: (STAGE.width - width) / 2, top: (STAGE.height - height) / 2 };
}

export const pct = (b: NormBox): CSSProperties => ({
  left: `${b.x * 100}%`,
  top: `${b.y * 100}%`,
  width: `${b.w * 100}%`,
  height: `${b.h * 100}%`,
});

function Brackets({ color }: { color: string }) {
  const corner = "absolute h-[28%] w-[28%] min-h-4 min-w-4 border-[5px]";
  return (
    <>
      <span className={`${corner} left-0 top-0 rounded-tl-xl border-b-0 border-r-0`} style={{ borderColor: color }} />
      <span className={`${corner} right-0 top-0 rounded-tr-xl border-b-0 border-l-0`} style={{ borderColor: color }} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-xl border-r-0 border-t-0`} style={{ borderColor: color }} />
      <span className={`${corner} bottom-0 right-0 rounded-br-xl border-l-0 border-t-0`} style={{ borderColor: color }} />
    </>
  );
}

/** A glowing full-body silhouette: a faint color fill masked by the cutout, and the outline on top. */
function Silhouette({ subject, delayMs }: { subject: Subject; delayMs: number }) {
  const { color, cutout, outline, cutoutBox } = subject;
  if (!cutoutBox || !outline || !cutout) return null;
  const mask = `url(${cutout})`;
  return (
    <div className="absolute animate-fade-up" style={{ ...pct(cutoutBox), animationDelay: `${delayMs}ms` }}>
      <div
        className="absolute inset-0 opacity-25"
        style={{ background: color, maskImage: mask, WebkitMaskImage: mask, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}
      />
      <img
        src={outline}
        alt=""
        className="absolute inset-0 h-full w-full"
        style={{ filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 18px ${color})` }}
      />
    </div>
  );
}

/** Every visible limb and joint, in the snapshot's own pixel space so circles stay round. */
function Skeletons({ subjects, width, height }: { subjects: Subject[]; width: number; height: number }) {
  const r = Math.max(3, width / 320);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" aria-hidden>
      {subjects.map((s, i) =>
        s.pose ? (
          <g key={s.id} className="animate-fade-up" style={{ animationDelay: `${250 + i * 140}ms`, filter: `drop-shadow(0 0 4px ${s.color})` }}>
            {visibleSegments(s.pose).map((seg, j) => (
              <line key={j} x1={seg.a.x * width} y1={seg.a.y * height} x2={seg.b.x * width} y2={seg.b.y * height} stroke={s.color} strokeWidth={r * 0.7} strokeLinecap="round" opacity={0.9} />
            ))}
            {visibleJoints(s.pose).map((p, j) => (
              <circle key={j} cx={p.x * width} cy={p.y * height} r={r} fill="white" stroke={s.color} strokeWidth={r * 0.6} />
            ))}
          </g>
        ) : null,
      )}
    </svg>
  );
}

/**
 * The frozen capture with the full-body scan: a sweeping laser over a holographic grid, then
 * each person's glowing silhouette and pose skeleton (a bracket on the face when no body mask
 * was found). Mirrored like the live view so people see themselves where they sit.
 */
export function ScanOverlay({ snapshot, subjects, scanning }: { snapshot: Snapshot; subjects: Subject[]; scanning: boolean }) {
  const rect = coverRect(snapshot.width, snapshot.height);
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute -scale-x-100" style={rect}>
        <img src={snapshot.url} alt="" className="absolute inset-0 h-full w-full object-cover brightness-[0.55] saturate-[0.8]" />
        {subjects.map((s, i) =>
          s.cutoutBox && s.outline ? (
            <Silhouette key={s.id} subject={s} delayMs={i * 140} />
          ) : (
            <div key={s.id} className="absolute animate-pop-in" style={{ ...pct(s.face ?? s.box), animationDelay: `${i * 140}ms` }}>
              <Brackets color={s.color} />
            </div>
          ),
        )}
        <Skeletons subjects={subjects} width={snapshot.width} height={snapshot.height} />
      </div>
      <div className="scan-grid absolute inset-0" />
      {scanning && <div className="scan-laser" />}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(7,7,18,0.7))]" />
    </div>
  );
}
