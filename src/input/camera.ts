import type { LittleApp } from "@kabletv/little-sdk";

export interface CameraHandle {
  stream: MediaStream;
  via: "little" | "browser";
  stop(): void;
}

export class CameraError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly viewerHint?: string,
  ) {
    super(message);
  }
}

const SIZE = { width: 1280, height: 720, fps: 30 } as const;

async function openCamera(app: LittleApp): Promise<CameraHandle> {
  // On the television the host owns the camera and its on-air light.
  if (app.can("media.camera")) {
    const grant = await app.media.camera({ facing: "user", ...SIZE });
    if (!grant.ok) throw new CameraError(grant.error.code, grant.error.message, grant.error.viewerHint);
    return { stream: grant.stream, via: "little", stop: grant.stop };
  }
  // A plain browser (local dev without the harness).
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("no_device", "No camera API on this screen.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: SIZE.width },
        height: { ideal: SIZE.height },
        frameRate: { ideal: SIZE.fps },
      },
    });
    return { stream, via: "browser", stop: () => stream.getTracks().forEach((t) => t.stop()) };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "Error";
    throw new CameraError(name === "NotAllowedError" ? "denied" : "no_device", String(err));
  }
}

// One camera shared by every game. Released after a grace period so switching games, or a
// StrictMode remount, doesn't flash the on-air light off and back on.
const RELEASE_GRACE_MS = 2000;
type SharedCamera = { promise: Promise<CameraHandle>; refs: number; releaseTimer?: number };
let shared: SharedCamera | null = null;

export function acquireCamera(app: LittleApp): { promise: Promise<CameraHandle>; release(): void } {
  if (!shared) {
    const entry: SharedCamera = { promise: openCamera(app), refs: 0 };
    entry.promise.catch(() => {
      if (shared === entry) shared = null;
    });
    shared = entry;
  }
  const entry = shared;
  entry.refs++;
  clearTimeout(entry.releaseTimer);
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      if (--entry.refs > 0) return;
      entry.releaseTimer = window.setTimeout(() => {
        if (entry.refs > 0) return;
        if (shared === entry) shared = null;
        entry.promise.then((h) => h.stop(), () => {});
      }, RELEASE_GRACE_MS);
    },
  };
}
