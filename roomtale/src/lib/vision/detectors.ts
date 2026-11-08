import { FaceDetector, FilesetResolver, ImageSegmenter, ObjectDetector, PoseLandmarker } from "@mediapipe/tasks-vision";

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const MEDIAPIPE_VERSION = "1.2.2";
const local = (path: string) => new URL(path, document.baseURI).href;
const HOSTED = "https://storage.googleapis.com/mediapipe-models";

const WASM = [local("mediapipe/wasm"), `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`];
const MODELS = {
  face: [local("mediapipe/blaze_face_short_range.tflite"), `${HOSTED}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`],
  bodies: [local("mediapipe/efficientdet_lite0.tflite"), `${HOSTED}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`],
  pose: [local("mediapipe/pose_landmarker_full.task"), `${HOSTED}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`],
  deeplab: [local("mediapipe/deeplab_v3.tflite"), `${HOSTED}/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite`],
};

export const BODY_CATEGORIES = ["person", "dog", "cat"] as const;

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

let fileset: Promise<WasmFileset> | null = null;
function loadFileset(): Promise<WasmFileset> {
  fileset ??= firstOk(WASM.map((path) => () => FilesetResolver.forVisionTasks(path)));
  fileset.catch(() => {
    fileset = null;
  });
  return fileset;
}

/** One lazily created task per model, tried local-then-hosted and GPU-then-CPU, retried after a failure. */
function lazyTask<T>(models: string[], create: (fs: WasmFileset, modelAssetPath: string, delegate: "GPU" | "CPU") => Promise<T>) {
  let task: Promise<T> | null = null;
  return (): Promise<T> => {
    task ??= loadFileset().then((fs) =>
      firstOk(models.flatMap((path) => (["GPU", "CPU"] as const).map((delegate) => () => create(fs, path, delegate)))),
    );
    task.catch(() => {
      task = null;
    });
    return task;
  };
}

const loadFaces = lazyTask(MODELS.face, (fs, modelAssetPath, delegate) =>
  FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 }),
);

const loadBodies = lazyTask(MODELS.bodies, (fs, modelAssetPath, delegate) =>
  ObjectDetector.createFromOptions(fs, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: "IMAGE",
    scoreThreshold: 0.35,
    maxResults: 12,
    categoryAllowlist: [...BODY_CATEGORIES],
  }),
);

/** Pose landmarks plus a body mask, run on one person's crop at a time. */
export const loadPose = lazyTask(MODELS.pose, (fs, modelAssetPath, delegate) =>
  PoseLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: "IMAGE",
    numPoses: 1,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    outputSegmentationMasks: true,
  }),
);

/** PASCAL VOC classes (dog, cat, person…): silhouettes for pets, which the pose model can't do. */
export const loadDeepLab = lazyTask(MODELS.deeplab, (fs, modelAssetPath, delegate) =>
  ImageSegmenter.createFromOptions(fs, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: "IMAGE",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  }),
);

export interface Detectors {
  faces: FaceDetector;
  bodies: ObjectDetector;
}

/** The detection pair; the idle presence check calls this early so the capture starts warm. */
export async function loadDetectors(): Promise<Detectors> {
  const [faces, bodies] = await Promise.all([loadFaces(), loadBodies()]);
  return { faces, bodies };
}

/** Warms everything the capture pipeline needs, without waiting on it. */
export function warmCapture() {
  void loadDetectors().catch(() => {});
  void loadPose().catch(() => {});
  void loadDeepLab().catch(() => {});
}
