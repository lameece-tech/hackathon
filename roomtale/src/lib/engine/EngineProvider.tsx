"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { RoomTaleEngine } from "./engine";
import type { RoomTaleState } from "./machine";

const EngineContext = createContext<RoomTaleEngine | null>(null);

export function EngineProvider({ engine, children }: { engine: RoomTaleEngine; children: ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): RoomTaleEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine must be used inside <EngineProvider>.");
  return engine;
}

export function useEngineState(): RoomTaleState {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}
