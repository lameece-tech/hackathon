/** A box in normalized frame coordinates: 0–1, origin top-left of the raw (unmirrored) frame. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SubjectKind = "person" | "dog" | "cat";

/** One BlazePose landmark in normalized frame coordinates; `v` is visibility (0–1). */
export interface PoseLandmark {
  x: number;
  y: number;
  v: number;
}

/** Someone (or some pet) the on-device detector found in the captured frame. */
export interface Subject {
  /** Stable within one capture: p1, p2… for people, pet1… for animals, left to right. */
  id: string;
  kind: SubjectKind;
  /** Their color on the capture screen (outline, skeleton, casting card). */
  color: string;
  /** Body box. */
  box: NormBox;
  /** Face box, when the face detector found one. */
  face: NormBox | null;
  /** Square JPEG data URL of the face (or estimated head): the close-up identity reference. */
  avatar: string;
  /** Full body on a transparent background, trimmed to the silhouette. Null when no mask was found. */
  cutout: string | null;
  /** The silhouette edge in `color`, same placement as the cutout. */
  outline: string | null;
  /** Where the cutout and outline sit in the frame. */
  cutoutBox: NormBox | null;
  /** The 33 BlazePose landmarks (people only). */
  pose: PoseLandmark[] | null;
  score: number;
}

/** What the scene-analysis route is told about each subject (no pixels). */
export interface SubjectHint {
  id: string;
  kind: SubjectKind;
  box: NormBox;
  hasFace: boolean;
}

export type Position = "far left" | "left" | "center" | "right" | "far right";

export interface Occupant {
  /** A detector id (p1, pet1…) or extra1… for someone the detector missed. */
  id: string;
  kind: "person" | "pet";
  /** Kind, visual-only label: "man in a red plaid shirt holding a mug". */
  description: string;
  position: Position;
}

export interface SceneAnalysis {
  setting: string;
  objects: string[];
  occupants: Occupant[];
}

export interface StoryCharacter {
  id: string;
  /** The occupant this character is played by, or null for an invented character. */
  occupantId: string | null;
  name: string;
  role: string;
  /** The real-world label of who plays them, as shown on the cast card. */
  playedBy: string;
  costume: string;
  personality: string;
  /** #RRGGBB, drawn from their real outfit. */
  accentColor: string;
}

export type ShotMood = "cozy" | "exciting" | "funny" | "mysterious" | "triumphant" | "dreamy";

export const SHOT_SECONDS = [5, 10] as const;
export type ShotSeconds = (typeof SHOT_SECONDS)[number];

/** One shot of the film: a few seconds of continuous generated footage with an optional voiceover line. */
export interface Shot {
  /** Voiceover during the shot (subtitled); "" for a purely visual beat. Sized to fit `seconds`. */
  narration: string;
  /** The shot's opening frame: the on-screen cast by name and costume, left to right, full body. */
  imagePrompt: string;
  /** What happens over the shot: where each character moves, how their expression changes, one camera move. */
  motionPrompt: string;
  /** Characters on screen, in left-to-right order. */
  characterIds: string[];
  mood: ShotMood;
  seconds: ShotSeconds;
}

/** A shot's footage as it's made: the opening frame with the family rendered in, then the clip. */
export interface ShotVisual {
  /** Opening frame built from the captured photo; the clip is animated from it. */
  keyframe?: string;
  /** The shot's footage. */
  video?: string;
  /** The opening frame or clip is still being generated. */
  pending?: boolean;
  /** Generation failed for good: the film cuts past this shot. */
  failed?: boolean;
}

/** What the server is missing before it can film, as setup steps for whoever runs it. */
export type FilmBlocker = "scenes" | "video";

export interface Story {
  id: string;
  title: string;
  logline: string;
  theme: string;
  /** One camera-and-light phrase appended to every shot so the film looks like one camera. */
  artStyle: string;
  characters: StoryCharacter[];
  shots: Shot[];
}

/** Which AI providers this server has (no secrets), so the TV knows whether it can film. */
export interface Capabilities {
  story: boolean;
  /** Shots rendered with the family from the captured photo. */
  scenes: boolean;
  /** Image-to-video provider name, or null. */
  video: string | null;
}

export type GenerationMode = "live" | "mock";

export interface SceneAnalysisRequest {
  /** data:image/jpeg;base64,… of the captured room. */
  image: string;
  imageSize: { width: number; height: number };
  prompt: string;
  subjects: SubjectHint[];
}

export interface SceneAnalysisResponse {
  scene: SceneAnalysis;
  story: Story;
  mode: GenerationMode;
}

export interface StoryRequest {
  prompt: string;
  /** The cast from an earlier scene analysis; omit to let the model invent one. */
  scene?: SceneAnalysis;
  /** The previous story's title, for sequels. */
  previousTitle?: string;
}

export interface StoryResponse {
  story: Story;
  mode: GenerationMode;
}

export interface CastReference {
  /** Story name, e.g. "Captain Plaid". */
  name: string;
  /** "a red plaid space suit with a swooshing cape". */
  costume: string;
  kind: "person" | "pet";
  /** Full-body cutout (data URL). */
  body: string | null;
  /** Face close-up (data URL). */
  face: string | null;
}

export interface ImageRequest {
  prompt: string;
  style: string;
  /** The on-screen cast, left to right, with their reference photos. */
  cast: CastReference[];
}

export interface ImageResponse {
  url: string;
  provider: string;
}

export interface VideoStartRequest {
  /** data:image/jpeg;base64,… 1280×720 first frame. */
  image: string;
  prompt: string;
  /** Clip length: the shot's length. */
  seconds: ShotSeconds;
  /** The on-screen cast's real photos, for video models that keep likeness from references. */
  cast: CastReference[];
}

export interface VideoJob {
  id: string;
  provider: string;
}

export interface VideoStatus {
  status: "pending" | "running" | "done" | "failed";
  url?: string;
  error?: string;
}
