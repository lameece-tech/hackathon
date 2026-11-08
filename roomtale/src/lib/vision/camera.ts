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

// 1080p keeps the mirror smooth on every webcam; faces at couch distance are still ~50px,
// which the two-stage detector handles. Raise to 3840×2160 on cameras that do 4K at 30fps.
const PROFILE = { width: 1920, height: 1080, fps: 30 } as const;

async function openCamera(app: LittleApp): Promise<CameraHandle> {
  // On the television the host owns the camera and its on-air light.
  if (app.can("media.camera")) {
    const grant = await app.media.camera({ facing: "user", ...PROFILE });
    if (!grant.ok) throw new CameraError(grant.error.code, grant.error.message, grant.error.viewerHint);
    return { stream: grant.stream, via: "little", stop: grant.stop };
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("no_device", "No camera API on this screen.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: PROFILE.width },
        height: { ideal: PROFILE.height },
        frameRate: { ideal: PROFILE.fps },
      },
    });
    return { stream, via: "browser", stop: () => stream.getTracks().forEach((t) => t.stop()) };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "Error";
    throw new CameraError(name === "NotAllowedError" ? "declined" : "no_device", String(err));
  }
}

// Released after a grace period so a StrictMode remount, or a quick hop from playback back
// to the mirror, doesn't flash the on-air light off and on.
const RELEASE_GRACE_MS = 2500;
type Shared = { promise: Promise<CameraHandle>; refs: number; releaseTimer?: ReturnType<typeof setTimeout> };
let shared: Shared | null = null;

export function acquireCamera(app: LittleApp): { promise: Promise<CameraHandle>; release(): void } {
  if (!shared) {
    const entry: Shared = { promise: openCamera(app), refs: 0 };
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
      entry.releaseTimer = setTimeout(() => {
        if (entry.refs > 0) return;
        if (shared === entry) shared = null;
        entry.promise.then((h) => h.stop(), () => {});
      }, RELEASE_GRACE_MS);
    },
  };
}
