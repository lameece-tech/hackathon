import { useLittleApp } from "@kabletv/little-react";
import { useEffect, useRef, useState } from "react";
import { acquireCamera, CameraError } from "./camera";
import { loadGestureRecognizer, startGestureLoop, type HandFrame } from "./gestures";

export type CameraStatus = "off" | "starting" | "ready" | "error";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Camera + MediaPipe, feeding `onFrame` once per video frame. Attach `videoRef` to a <video>. */
export function useHandGestures({ enabled, onFrame }: { enabled: boolean; onFrame: (frame: HandFrame) => void }) {
  const app = useLittleApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onFrameRef = useLatest(onFrame);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [error, setError] = useState<CameraError | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    let stopLoop = () => {};
    const camera = acquireCamera(app);
    setStatus("starting");
    setError(null);

    Promise.all([camera.promise, loadGestureRecognizer()])
      .then(async ([handle, model]) => {
        const video = videoRef.current;
        if (cancelled || !video) return;
        video.srcObject = handle.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        if (cancelled) return;
        let first = true;
        stopLoop = startGestureLoop(video, model, (frame) => {
          if (first) {
            first = false;
            setStatus("ready");
          }
          onFrameRef.current(frame);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof CameraError ? err : new CameraError("load_failed", String(err)));
        setStatus("error");
      });

    return () => {
      cancelled = true;
      stopLoop();
      camera.release();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled, app, onFrameRef]);

  return { videoRef, status, error };
}

/** `?sim` in the URL skips the camera and plays with the keyboard stand-in below. */
export const FORCE_SIMULATED_INPUT = new URLSearchParams(window.location.search).has("sim");

const KEY_GESTURES: Record<string, string | null> = { "1": "Closed_Fist", "2": "Open_Palm", "3": "Victory", "0": null };

/**
 * Stand-in hand for screens without a camera: 1 = rock, 2 = paper, 3 = scissors, 0 = hand down.
 * Emits frames at 30 fps like the camera, so the InputManager sees the same stream shape.
 */
export function useSimulatedHand({ enabled, onFrame }: { enabled: boolean; onFrame: (frame: HandFrame) => void }) {
  const onFrameRef = useLatest(onFrame);
  useEffect(() => {
    if (!enabled) return;
    let held: string | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key in KEY_GESTURES) held = KEY_GESTURES[e.key];
    };
    const timer = window.setInterval(() => {
      const t = performance.now();
      onFrameRef.current({ gesture: held, score: held ? 0.95 : 0, capturedAt: t, receivedAt: t });
    }, 33);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, onFrameRef]);
}
