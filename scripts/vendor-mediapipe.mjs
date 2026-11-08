// Copies the MediaPipe WASM runtime and gesture model into public/mediapipe so the app
// loads them relative to its own origin (a published Little app lives under a CDN prefix).
// If the model download fails, the app falls back to Google's hosted copy at runtime.
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "mediapipe");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmOut = join(outDir, "wasm");
const modelOut = join(outDir, "gesture_recognizer.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const exists = (p) => stat(p).then(() => true, () => false);

await rm(wasmOut, { recursive: true, force: true });
await mkdir(wasmOut, { recursive: true });
for (const file of await readdir(wasmSrc)) {
  // FilesetResolver.forVisionTasks(path) without useModule loads only the non-module build.
  if (file.startsWith("vision_wasm_internal.")) await copyFile(join(wasmSrc, file), join(wasmOut, file));
}

if (!(await exists(modelOut))) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(modelOut, Buffer.from(await res.arrayBuffer()));
    console.log("[vendor-mediapipe] downloaded gesture_recognizer.task");
  } catch (err) {
    console.warn(`[vendor-mediapipe] model download failed (${err.message}); runtime will use the hosted model`);
  }
}
