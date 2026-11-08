import { useEngineState } from "../engine/GameEngineContext";
import type { Phase } from "../engine/types";

const PHASE_STYLE: Record<Phase, { label: string; className: string }> = {
  MENU: { label: "MENU", className: "bg-white/10 text-white" },
  READY: { label: "READY", className: "bg-ice text-ink" },
  COUNTDOWN: { label: "GET SET", className: "bg-white text-ink" },
  ACTION_WINDOW: { label: "LOCK IN", className: "bg-volt text-ink animate-pulse" },
  EVALUATION: { label: "REVEAL", className: "bg-hot text-white" },
  RESULT: { label: "RESULT", className: "bg-go text-ink" },
};

export function Hud({ title }: { title: string }) {
  const { phase, round, score } = useEngineState();
  const pill = PHASE_STYLE[phase];
  return (
    <header className="flex h-16 items-center justify-between">
      <div className="flex items-baseline gap-6">
        <span className="text-4xl font-black tracking-tight text-hot">COUCH CLASH</span>
        <span className="text-4xl font-bold text-white/60">{title}</span>
      </div>
      <div className="flex items-center gap-10">
        <span
          className={`rounded-full px-7 py-2 text-3xl font-black tracking-widest ${pill.className}`}
          data-little="readout"
          data-little-label="Game phase"
          data-little-data={JSON.stringify({ phase })}
        >
          {pill.label}
        </span>
        {round > 0 && <span className="text-4xl font-bold text-white/60">ROUND {round}</span>}
        <span
          className="text-5xl font-black tabular-nums"
          data-little="readout"
          data-little-label="Score"
          data-little-data={JSON.stringify(score)}
        >
          YOU {score.player} <span className="text-white/40">–</span> {score.ai} TV
        </span>
      </div>
    </header>
  );
}
