"use client";

import dynamic from "next/dynamic";

// Camera, microphone, MediaPipe and the Little connection are browser-only, and the TV has
// nothing useful to show before they start, so these trees skip server rendering entirely.
const RoomTaleApp = dynamic(() => import("./RoomTaleApp"), { ssr: false });
const PlayerDemo = dynamic(() => import("./PlayerDemo"), { ssr: false });

export default function ClientOnly({ view }: { view: "app" | "demo" }) {
  return view === "app" ? <RoomTaleApp /> : <PlayerDemo />;
}
