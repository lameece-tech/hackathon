"use client";

import { useRef, type CSSProperties } from "react";
import { useMicLevel } from "@/lib/voice/useMicLevel";

export type OrbState = "idle" | "listening" | "thinking";

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}

const gain = (g: number) => ({ "--ring-gain": g }) as CSSProperties;

/**
 * The listening indicator. Dim and breathing when idle; a glowing orb with rings that swell
 * with the viewer's voice when listening (`meter` reads the mic — browser only); a spinning
 * halo while thinking.
 */
export function MicOrb({ state, size = 168, meter = false }: { state: OrbState; size?: number; meter?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const listening = state === "listening";
  useMicLevel(listening && meter, ref);

  return (
    <div ref={ref} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {listening && (
        <>
          <span className="mic-ring absolute -inset-4 rounded-full bg-glow/30 blur-2xl" style={gain(1.2)} />
          <span className="mic-ring absolute -inset-8 rounded-full border-4 border-glow/50" style={gain(0.7)} />
          <span className="mic-ring absolute -inset-16 rounded-full border-2 border-aurora/40" style={gain(0.45)} />
          {!meter && <span className="absolute -inset-10 animate-ping rounded-full border-4 border-glow/40" />}
        </>
      )}
      {state === "thinking" && (
        <span
          className="absolute -inset-3 animate-spin-slow rounded-full"
          style={{ background: "conic-gradient(from 0deg, transparent, #22d3ee, #8b5cf6, transparent 70%)" }}
        />
      )}
      <div
        className={`relative grid h-full w-full place-items-center rounded-full transition-all duration-300 ${
          listening
            ? "bg-linear-to-br from-glow to-aurora text-white shadow-[0_0_90px_rgba(34,211,238,0.85)]"
            : state === "thinking"
              ? "bg-dusk text-glow"
              : "animate-breathe border-4 border-white/25 bg-white/10 text-white/80"
        }`}
      >
        <MicIcon className="h-[46%] w-[46%]" />
      </div>
    </div>
  );
}
