import { FilesetResolver, GestureRecognizer, type NormalizedLandmark } from "@mediapipe/tasks-vision";

/** One processed camera frame. */
export interface HandFrame {
  /** MediaPipe canned gesture ("Closed_Fist", "Open_Palm", "Victory", …) or null. */
  gesture: string | null;
  score: number;
  /** When the camera captured the frame (performance.now() ms). */
  capturedAt: number;
  /** When recognition finished. */
  receivedAt: number;
  landmarks?: NormalizedLandmark[];
}

const MEDIAPIPE_VERSION = "1.2.2";
const asset = (path: string) => new URL(path, document.baseURI).href;
const WASM = [asset("mediapipe/wasm"), `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`];
const MODEL = [
  asset("mediapipe/gesture_recognizer.task"),
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
];

async function firstOk<T>(attempts: Array<() => Promise<T>>): Promise<T> {
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

let recognizer: Promise<GestureRecognizer> | null = null;

/** Loads once and is reused by every round and game. */
export function loadGestureRecognizer(): Promise<GestureRecognizer> {
  recognizer ??= (async () => {
    const fileset = await firstOk(WASM.map((path) => () => FilesetResolver.forVisionTasks(path)));
    const attempts = MODEL.flatMap((modelAssetPath) =>
      (["GPU", "CPU"] as const).map(
        (delegate) => () =>
          GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
      ),
    );
    return firstOk(attempts);
  })();
  recognizer.catch(() => {
    recognizer = null;
  });
  return recognizer;
}

/**
 * Runs recognition on every new video frame and reports it with the frame's capture time.
 * requestVideoFrameCallback gives the camera's own capture timestamp, so the anti-cheat
 * compares the moment the hand was actually in front of the lens, not when the model
 * got around to it.
 */
export function startGestureLoop(
  video: HTMLVideoElement,
  model: GestureRecognizer,
  onFrame: (frame: HandFrame) => void,
): () => void {
  let stopped = false;
  let lastTimestamp = -1;

  const process = (fallbackTime: number, captureTime?: number) => {
    if (video.readyState < 2) return;
    const capturedAt = Math.min(captureTime ?? fallbackTime, performance.now());
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(lastTimestamp + 1, Math.round(capturedAt));
    lastTimestamp = ts;
    const result = model.recognizeForVideo(video, ts);
    const top = result.gestures[0]?.[0];
    onFrame({
      gesture: top && top.categoryName !== "None" ? top.categoryName : null,
      score: top?.score ?? 0,
      capturedAt,
      receivedAt: performance.now(),
      landmarks: result.landmarks[0],
    });
  };

  if (typeof video.requestVideoFrameCallback === "function") {
    let handle = 0;
    const onVideoFrame: VideoFrameRequestCallback = (now, meta) => {
      if (stopped) return;
      process(now, meta.captureTime);
      handle = video.requestVideoFrameCallback(onVideoFrame);
    };
    handle = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback(handle);
    };
  }

  let handle = 0;
  let lastVideoTime = -1;
  const onAnimationFrame = (now: number) => {
    if (stopped) return;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      process(now);
    }
    handle = requestAnimationFrame(onAnimationFrame);
  };
  handle = requestAnimationFrame(onAnimationFrame);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}
