import type { LittleApp } from "@kabletv/little-sdk";

export type NarrationEnd = "ended" | "interrupted";

export interface NarrationProgress {
  /** Fraction of the text spoken so far, 0–1. */
  fraction: number;
}

export interface Narration {
  done: Promise<NarrationEnd>;
  cancel(): void;
}

export interface Narrator {
  kind: "little" | "browser" | "timer";
  speak(text: string, onProgress?: (p: NarrationProgress) => void): Narration;
}

/** Read-aloud pace for estimating progress when the voice gives no word timings. */
const WORDS_PER_SECOND = 2.6;

function estimateMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(3500, (words / WORDS_PER_SECOND) * 1000 + 600);
}

/** Progress ticks on an estimated clock. Returns a stop function. */
function estimateProgress(text: string, onProgress?: (p: NarrationProgress) => void): () => void {
  if (!onProgress) return () => {};
  const total = estimateMs(text) - 400;
  const start = performance.now();
  const timer = setInterval(() => onProgress({ fraction: Math.min(1, (performance.now() - start) / total) }), 120);
  return () => clearInterval(timer);
}

/** Silent narration on a timer: the story still advances on screens with no voice at all. */
export function createTimerNarrator(): Narrator {
  return {
    kind: "timer",
    speak(text, onProgress) {
      let cancel = () => {};
      const done = new Promise<NarrationEnd>((resolve) => {
        const stopProgress = estimateProgress(text, onProgress);
        const timer = setTimeout(() => {
          stopProgress();
          onProgress?.({ fraction: 1 });
          resolve("ended");
        }, estimateMs(text));
        cancel = () => {
          clearTimeout(timer);
          stopProgress();
          resolve("interrupted");
        };
      });
      return { done, cancel };
    },
  };
}

/** The television's own narration voice (`voice.say`), which resolves when playback ends. */
export function createLittleNarrator(app: LittleApp, fallback: Narrator = createTimerNarrator()): Narrator {
  return {
    kind: "little",
    speak(text, onProgress) {
      let cancelled = false;
      let inner: Narration | null = null;
      const stopProgress = estimateProgress(text, onProgress);
      const done = app.voice.say(text, { interrupt: true }).then(async (result): Promise<NarrationEnd> => {
        stopProgress();
        if (cancelled) return "interrupted";
        if (!result.ok) {
          // Voice refused (busy, paused): keep the book moving silently.
          inner = fallback.speak(text, onProgress);
          return inner.done;
        }
        if (result.interrupted) return "interrupted";
        onProgress?.({ fraction: 1 });
        return "ended";
      });
      return {
        done,
        cancel() {
          cancelled = true;
          stopProgress();
          inner?.cancel();
        },
      };
    },
  };
}

const PREFERRED_VOICES = [/natural/i, /neural/i, /google us english/i, /samantha/i, /aria/i, /jenny/i, /daniel/i];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  for (const pattern of PREFERRED_VOICES) {
    const v = voices.find((voice) => pattern.test(voice.name));
    if (v) return v;
  }
  return voices.find((v) => v.lang === "en-US") ?? voices[0] ?? null;
}

/**
 * Browser speechSynthesis with word-boundary progress. If speech never starts (no voices,
 * or the autoplay policy blocks speech before the first remote press), it falls back to the
 * silent timer so the film keeps moving.
 */
export function createBrowserNarrator(fallback: Narrator = createTimerNarrator()): Narrator {
  const synth = window.speechSynthesis;
  // Voices load asynchronously in Chrome; touching the list starts the load.
  synth.getVoices();
  return {
    kind: "browser",
    speak(text, onProgress) {
      let settled = false;
      let inner: Narration | null = null;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let resolveDone: (end: NarrationEnd) => void = () => {};
      const done = new Promise<NarrationEnd>((resolve) => (resolveDone = resolve));
      const settle = (end: NarrationEnd) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolveDone(end);
      };
      const toFallback = () => {
        if (settled) return;
        synth.cancel();
        inner = fallback.speak(text, onProgress);
        void inner.done.then(settle);
      };

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      let started = false;
      utterance.onstart = () => {
        started = true;
        clearTimeout(watchdog);
      };
      utterance.onboundary = (e) => {
        if (e.name === "word" || e.name === undefined) onProgress?.({ fraction: Math.min(1, e.charIndex / text.length) });
      };
      utterance.onend = () => {
        onProgress?.({ fraction: 1 });
        settle("ended");
      };
      utterance.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") settle("interrupted");
        else toFallback();
      };

      synth.cancel();
      synth.speak(utterance);
      watchdog = setTimeout(() => {
        if (!started) toFallback();
      }, 2500);

      return {
        done,
        cancel() {
          if (settled) return;
          inner?.cancel();
          settle("interrupted");
          synth.cancel();
        },
      };
    },
  };
}

export function pickNarrator(app: LittleApp): Narrator {
  if (app.can("voice.say")) return createLittleNarrator(app);
  if (typeof window !== "undefined" && "speechSynthesis" in window) return createBrowserNarrator();
  return createTimerNarrator();
}
