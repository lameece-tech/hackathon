"use client";

import { useEffect, type RefObject } from "react";

/**
 * Drives `--level` (0–1) on an element from the microphone's loudness, every animation
 * frame, without re-rendering React. Browser-only: on a Little TV the platform owns the
 * microphone, and holding it would stop the TV agent from hearing the viewer.
 */
export function useMicLevel(enabled: boolean, target: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(s).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let level = 0;
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          const rms = Math.sqrt(sum / samples.length);
          // Speech RMS sits around 0.02–0.2; map it onto 0–1 with fast attack and slow release.
          const target01 = Math.min(1, Math.max(0, (Math.log10(rms + 1e-4) + 2.6) / 1.9));
          level = target01 > level ? level + (target01 - level) * 0.5 : level + (target01 - level) * 0.08;
          target.current?.style.setProperty("--level", level.toFixed(3));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {
        // No mic for the meter; the orb falls back to its idle pulse.
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      target.current?.style.setProperty("--level", "0");
    };
  }, [enabled, target]);
}
