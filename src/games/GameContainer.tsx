import { Component, Suspense, type ReactNode } from "react";
import { useEngineState, useGameEngine } from "../engine/GameEngineContext";
import { Menu } from "../ui/Menu";
import { getGame } from "./registry";

/**
 * Swaps games in place: the selected game mounts under its own key, so leaving it unmounts
 * it completely (camera released, scheduled frames and sounds cancelled) with no page reload.
 */
export function GameContainer() {
  const { gameId } = useEngineState();
  const engine = useGameEngine();
  const game = gameId ? getGame(gameId) : undefined;

  if (!game?.Component) {
    return (
      <div key="menu" className="h-full animate-enter">
        <Menu />
      </div>
    );
  }

  const { Component: Game } = game;
  return (
    <GameBoundary key={game.id} onExit={() => engine.backToMenu()}>
      <Suspense fallback={<Splash title={game.title} emoji={game.emoji} />}>
        <div className="h-full animate-enter">
          <Game />
        </div>
      </Suspense>
    </GameBoundary>
  );
}

function Splash({ title, emoji }: { title: string; emoji: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <span className="animate-pump text-[220px] leading-none">{emoji}</span>
      <p className="text-7xl font-black">{title.toUpperCase()}</p>
    </div>
  );
}

class GameBoundary extends Component<{ onExit: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-10 text-center">
        <p className="text-8xl font-black text-stop">THAT GAME CRASHED</p>
        <p className="max-w-[1400px] text-3xl text-white/60">{this.state.error.message}</p>
        <button autoFocus className="tv-button bg-hot text-white" onClick={this.props.onExit}>
          BACK TO MENU
        </button>
      </div>
    );
  }
}
