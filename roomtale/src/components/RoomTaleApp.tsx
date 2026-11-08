"use client";

import "@/lib/little/setup";
import { useLittleActiveTools, useLittleApp, useLittleEnter, useLittleTool, useLittleVisible } from "@kabletv/little-react";
import { useEffect, useMemo, useState } from "react";
import { createClientDeps, isHosted } from "@/lib/engine/clientDeps";
import { createRoomTaleEngine, DEFAULT_PROMPT } from "@/lib/engine/engine";
import { EngineProvider, useEngine, useEngineState } from "@/lib/engine/EngineProvider";
import type { RoomTaleState } from "@/lib/engine/machine";
import { useRemote } from "@/lib/useRemote";
import { extractSubjects } from "@/lib/vision/subjects";
import { pickNarrator } from "@/lib/voice/narrator";
import { VoiceListener } from "@/lib/voice/VoiceListener";
import { RoomScanner } from "./RoomScanner";
import { MoviePlayer } from "./movie/MoviePlayer";
import { NoticeBanner } from "./tv/NoticeBanner";
import { TvStage } from "./tv/TvStage";

/** After a spoken line with no story request, the listening screen gives way to the mirror. */
const HOST_LISTEN_TIMEOUT_MS = 4500;

const VOICE_HINTS = ["RoomTale", "story", "movie", "bedtime story", "sci-fi", "space", "pirates", "dinosaurs", "fairy tale", "superheroes", "the same cast", "sequel", "skip this scene"];

function activeTools(state: RoomTaleState): string[] {
  const hasCast = Boolean(state.scene?.occupants.length);
  switch (state.phase) {
    case "IDLE_MIRROR":
      return hasCast ? ["tell_story", "tell_another_story"] : ["tell_story"];
    case "LISTENING":
      return ["tell_story", "end_movie"];
    case "PROCESSING_SCENE":
      return ["end_movie"];
    case "STORY_PLAYBACK":
      return [
        "tell_story",
        ...(hasCast ? ["tell_another_story"] : []),
        "skip_scene",
        "previous_scene",
        state.paused ? "resume_movie" : "pause_movie",
        "end_movie",
      ];
  }
}

export default function RoomTaleApp() {
  const app = useLittleApp();
  const [engine] = useState(() => createRoomTaleEngine(createClientDeps(app)));

  // Dev console handle: `await __roomtale.extractSubjects(canvas)` runs the vision pipeline on any image.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    Object.assign(window, { __roomtale: { engine, extractSubjects } });
  }, [engine]);

  return (
    <EngineProvider engine={engine}>
      <Shell />
    </EngineProvider>
  );
}

function Shell() {
  const app = useLittleApp();
  const engine = useEngine();
  const state = useEngineState();
  const [hosted] = useState(isHosted);
  // On a television, capabilities (camera, voice) are settled only once the host enters us.
  const [granted, setGranted] = useState<string[] | null>(hosted ? null : []);

  useLittleEnter<{ prompt?: string }>(({ params, granted: grants }) => {
    setGranted(grants);
    if (typeof params.prompt === "string" && params.prompt.trim()) engine.startStory(params.prompt, "launch");
  });

  // --- Tools: how the TV agent drives RoomTale -------------------------------------------
  useLittleTool<{ prompt?: string }>("tell_story", ({ prompt }) => {
    if (engine.getState().phase === "PROCESSING_SCENE") {
      return { ok: false, detail: "A movie is already being filmed and will premiere shortly." };
    }
    if (!engine.startStory(prompt ?? DEFAULT_PROMPT, "agent")) return { ok: false, detail: "RoomTale can't start a movie right now." };
    return { say: "Everyone look at the TV! I'm casting you in the movie." };
  });

  useLittleTool<{ prompt?: string }>("tell_another_story", ({ prompt }) => {
    if (engine.getState().phase === "PROCESSING_SCENE") {
      return { ok: false, detail: "A movie is already being filmed and will premiere shortly." };
    }
    if (!engine.tellAnother(prompt ?? DEFAULT_PROMPT, "agent")) return { ok: false, detail: "RoomTale can't start a movie right now." };
    return { say: "Same cast, brand new movie. Rolling cameras!" };
  });

  // Playback tools return spoke: true: the film carries on with its own voiceover, so the agent stays quiet.
  useLittleTool("skip_scene", () => {
    const s = engine.getState();
    if (s.phase !== "STORY_PLAYBACK") return { ok: false, detail: "No movie is playing." };
    if (!engine.next()) return { ok: false, detail: "This is already the last scene." };
    return { spoke: true };
  });

  useLittleTool("previous_scene", () => {
    const s = engine.getState();
    if (s.phase !== "STORY_PLAYBACK") return { ok: false, detail: "No movie is playing." };
    if (s.shot === 0) engine.goToShot(0);
    else if (!engine.previous()) return { ok: false, detail: "Couldn't go back." };
    return { spoke: true };
  });

  useLittleTool("pause_movie", () => {
    if (!engine.setPaused(true)) return { ok: false, detail: "No movie is playing, or it's already paused." };
    return { say: "Paused." };
  });

  useLittleTool("resume_movie", () => {
    if (!engine.setPaused(false)) return { ok: false, detail: "The movie isn't paused." };
    return { spoke: true };
  });

  useLittleTool("end_movie", () => {
    if (engine.getState().phase === "IDLE_MIRROR") return { ok: false, detail: "No movie is playing." };
    engine.returnToMirror();
  });

  useLittleActiveTools(activeTools(state));

  // --- Voice on a television: the platform hears the viewer; we only mirror the words -----
  const canSenseSpeech = hosted && Boolean(granted?.includes("sense.speech"));
  useEffect(() => {
    if (!canSenseSpeech) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const off = app.sense.speech(({ text, final }) => {
      if (!text.trim()) return;
      if (engine.getState().phase === "IDLE_MIRROR") engine.startListening("voice");
      if (engine.getState().phase !== "LISTENING") return;
      engine.setTranscript(text);
      clearTimeout(settle);
      if (final) settle = setTimeout(() => engine.stopListening(), HOST_LISTEN_TIMEOUT_MS);
    });
    return () => {
      off();
      clearTimeout(settle);
    };
  }, [canSenseSpeech, app, engine]);

  useEffect(() => {
    if (!granted?.includes("voice.config")) return;
    void app.voice.config({
      hints: VOICE_HINTS,
      context: "Viewers ask RoomTale for a movie starring the people in the room, often naming a theme like space, pirates or dinosaurs, and control playback with skip, back, pause and resume.",
    });
  }, [granted, app]);

  // --- Off screen: stop talking, stop listening ----------------------------------------
  const visible = useLittleVisible();
  useEffect(() => {
    if (visible) return;
    engine.setPaused(true);
    engine.stopListening();
  }, [visible, engine]);

  // --- The remote --------------------------------------------------------------------
  const browserVoice = !hosted && VoiceListener.supported();
  useRemote({
    ok() {
      const s = engine.getState();
      if (s.phase === "IDLE_MIRROR") {
        if (browserVoice) engine.startListening("button");
        else engine.startStory(DEFAULT_PROMPT, "button");
      } else if (s.phase === "LISTENING") {
        engine.startStory(s.transcript || DEFAULT_PROMPT, "button");
      } else if (s.phase === "STORY_PLAYBACK") {
        if (s.finished) engine.tellAnother(DEFAULT_PROMPT, "button");
        else engine.setPaused(!s.paused);
      }
    },
    back() {
      if (engine.getState().phase === "IDLE_MIRROR") void app.exit();
      else engine.returnToMirror();
    },
    right: () => void engine.next(),
    left: () => void engine.previous(),
  });

  // `granted` is a dependency on purpose: voice.say only becomes available once the host enters.
  const narrator = useMemo(() => pickNarrator(app), [app, granted]);

  const { phase, story } = state;
  return (
    <TvStage hosted={hosted}>
      <main className="relative h-full w-full overflow-hidden bg-night">
      {phase === "STORY_PLAYBACK" && story ? (
        <MoviePlayer
          key={story.id}
          story={story}
          subjects={state.subjects}
          visuals={state.visuals}
          score={state.score}
          shot={state.shot}
          paused={state.paused}
          finished={state.finished}
          onShotChange={(s) => engine.goToShot(s)}
          onFinished={() => engine.finishStory()}
          narrator={narrator}
        />
      ) : (
        <RoomScanner hosted={hosted} cameraAllowed={granted !== null} />
      )}
        <NoticeBanner notice={state.notice} />
      </main>
    </TvStage>
  );
}
