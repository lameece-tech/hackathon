import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameId } from "../engine/types";

export interface GameDefinition {
  id: GameId;
  title: string;
  tagline: string;
  emoji: string;
  input: "GESTURE" | "VOICE" | "MOTION";
  /** What the television says when the game opens. */
  intro: string;
  /** Code-split so each game's code loads only when it's opened. Null until the game is built. */
  Component: LazyExoticComponent<ComponentType> | null;
}

export const GAMES: readonly GameDefinition[] = [
  {
    id: "rps",
    title: "Rock Paper Scissors",
    tagline: "Throw on SHOOT. No peeking.",
    emoji: "✊",
    input: "GESTURE",
    intro: "Rock paper scissors. Hold your hand up to the camera, then say start.",
    Component: lazy(() => import("./rps/RockPaperScissors")),
  },
  {
    id: "coin",
    title: "Call the Coin",
    tagline: "Yell HEADS or TAILS before the apex.",
    emoji: "🪙",
    input: "VOICE",
    intro: "",
    Component: null,
  },
  {
    id: "redlight",
    title: "Red Light, Green Light",
    tagline: "Move on green. Freeze on red.",
    emoji: "🚦",
    input: "MOTION",
    intro: "",
    Component: null,
  },
  {
    id: "quickdraw",
    title: "Quick Draw",
    tagline: "Hand up on the bang. Not before.",
    emoji: "🤠",
    input: "GESTURE",
    intro: "",
    Component: null,
  },
];

export const getGame = (id: GameId) => GAMES.find((g) => g.id === id);

export const PLAYABLE_GAME_IDS: readonly GameId[] = GAMES.filter((g) => g.Component).map((g) => g.id);

export function isPlayable(id: unknown): id is GameId {
  return typeof id === "string" && (PLAYABLE_GAME_IDS as readonly string[]).includes(id);
}
