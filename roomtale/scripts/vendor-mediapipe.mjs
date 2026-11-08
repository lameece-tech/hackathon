// Copies the MediaPipe WASM runtime and the vision models into public/mediapipe so
// the app loads them from its own origin. A failed model download is not fatal: the app
// falls back to Google's hosted copy at runtime.
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "mediapipe");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmOut = join(outDir, "wasm");

const MODELS = {
  "blaze_face_short_range.tflite":
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  "efficientdet_lite0.tflite":
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  "pose_landmarker_full.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  "deeplab_v3.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite",
};

const exists = (p) => stat(p).then(() => true, () => false);

await rm(wasmOut, { recursive: true, force: true });
await mkdir(wasmOut, { recursive: true });
for (const file of await readdir(wasmSrc)) {
  // FilesetResolver.forVisionTasks(path) without useModule loads only the non-module build.
  if (file.startsWith("vision_wasm_internal.")) await copyFile(join(wasmSrc, file), join(wasmOut, file));
}

for (const [name, url] of Object.entries(MODELS)) {
  const out = join(outDir, name);
  if (await exists(out)) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    console.log(`[vendor-mediapipe] downloaded ${name}`);
  } catch (err) {
    console.warn(`[vendor-mediapipe] ${name} download failed (${err.message}); runtime will use the hosted model`);
  }
}
