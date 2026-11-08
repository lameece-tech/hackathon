import { useLittleActiveTools, useLittleApp, useLittleEnter, useLittleTool } from "@kabletv/little-react";
import { useEffect } from "react";
import { cues } from "./audio/cues";
import { GameEngineProvider, useEngineState, useGameEngine } from "./engine/GameEngineContext";
import { ROUND_PHASES } from "./engine/machine";
import { GameContainer } from "./games/GameContainer";
import { getGame, isPlayable, PLAYABLE_GAME_IDS } from "./games/registry";

// The agent can start and leave rounds but has no tool that throws for the viewer.
const ACTIVE_TOOLS = {
  menu: ["open_game"],
  round: ["back_to_menu"],
  between: ["start_round", "open_game", "back_to_menu"],
};

export default function App() {
  return (
    <GameEngineProvider>
      <Shell />
    </GameEngineProvider>
  );
}

function Shell() {
  const engine = useGameEngine();
  const { phase } = useEngineState();
  const app = useLittleApp();

  useLittleEnter<{ game?: string }>(({ params }) => {
    const id = params.game;
    if (isPlayable(id)) queueMicrotask(() => engine.openGame(id));
  });

  useLittleTool<{ game: string }>("open_game", ({ game }) => {
    if (!isPlayable(game)) {
      return { ok: false, detail: `"${game}" isn't playable yet. Playable now: ${PLAYABLE_GAME_IDS.join(", ")}.` };
    }
    engine.openGame(game);
    return { say: getGame(game)!.intro };
  });

  useLittleTool("back_to_menu", () => {
    engine.backToMenu();
  });

  useLittleActiveTools(ACTIVE_TOOLS[phase === "MENU" ? "menu" : ROUND_PHASES.has(phase) ? "round" : "between"]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      cues.unlock();
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (engine.store.getState().phase === "MENU") void app.exit();
      else engine.backToMenu();
    };
    const onPointer = () => cues.unlock();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [engine, app]);

  return (
    <main className="h-full w-full">
      <GameContainer />
    </main>
  );
}
