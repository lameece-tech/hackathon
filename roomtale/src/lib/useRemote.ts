"use client";

import { useEffect, useRef } from "react";

export type RemoteKey = "ok" | "back" | "left" | "right" | "up" | "down";

const KEYS: Record<string, RemoteKey> = {
  Enter: "ok",
  " ": "ok",
  MediaPlayPause: "ok",
  Escape: "back",
  GoBack: "back",
  BrowserBack: "back",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** The remote reaches the page as ordinary keydown events; this maps them to intents. */
export function useRemote(handlers: Partial<Record<RemoteKey, () => void>>) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = KEYS[e.key];
      const handler = key && ref.current[key];
      if (!handler || e.repeat) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
