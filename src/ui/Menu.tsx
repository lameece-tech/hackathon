import type { KeyboardEvent } from "react";
import { cues } from "../audio/cues";
import { useGameEngine } from "../engine/GameEngineContext";
import { GAMES } from "../games/registry";

const INPUT_ICON = { GESTURE: "✋", VOICE: "🎙️", MOTION: "🏃" } as const;

export function Menu() {
  const engine = useGameEngine();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-tile]")];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const next = tiles[(i + (e.key === "ArrowRight" ? 1 : -1) + tiles.length) % tiles.length];
    if (next && next !== document.activeElement) {
      e.preventDefault();
      next.focus();
      cues.play("select");
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-20 px-24">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-hot via-volt to-ice bg-clip-text text-[180px] font-black leading-none tracking-tighter text-transparent">
          COUCH CLASH
        </h1>
        <p className="mt-6 text-5xl font-bold text-white/60">Quick-reaction games for the living room</p>
      </div>

      <div className="flex gap-10" onKeyDown={onKeyDown} data-little="region" data-little-label="Games">
        {GAMES.map((game, i) => {
          const playable = Boolean(game.Component);
          const body = (
            <>
              <span className="text-[140px] leading-none">{game.emoji}</span>
              <span className="text-[44px] font-black leading-tight">{game.title}</span>
              <span className="text-2xl font-bold text-white/60">{game.tagline}</span>
              <span className="mt-auto rounded-full bg-white/10 px-5 py-2 text-2xl font-black tracking-widest">
                {INPUT_ICON[game.input]} {game.input}
              </span>
            </>
          );
          const perception = {
            "data-little": "item",
            "data-little-id": `game-${game.id}`,
            "data-little-label": game.title,
            "data-little-data": JSON.stringify({ game: game.id, available: playable }),
          };
          return playable ? (
            <button
              key={game.id}
              data-tile
              autoFocus={i === 0}
              onClick={() => engine.openGame(game.id)}
              data-little-action="open_game"
              {...perception}
              className="tile"
            >
              {body}
            </button>
          ) : (
            <div key={game.id} {...perception} className="tile opacity-35">
              {body}
              <span className="absolute right-6 top-6 rounded-full bg-volt px-4 py-1 text-xl font-black text-ink">SOON</span>
            </div>
          );
        })}
      </div>

      <p className="text-3xl font-bold text-white/40">◀ ▶ choose · OK play · or just say “play rock paper scissors”</p>
    </div>
  );
}
