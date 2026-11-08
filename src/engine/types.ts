export type Phase =
  | "MENU" // game picker
  | "READY" // a game is mounted; camera/mic warming, waiting for "start"
  | "COUNTDOWN" // timeline running, input not yet eligible
  | "ACTION_WINDOW" // input is eligible; closes on the exact frame of the reveal
  | "EVALUATION" // reveal on screen; late/switched input is watched for fouls
  | "RESULT";

export type GameId = "rps" | "coin" | "redlight" | "quickdraw";

export type Outcome = "win" | "lose" | "draw" | "foul";

export type FoulReason =
  | "TOO_LATE" // first input arrived after the window closed
  | "SWITCHED" // input changed after the reveal
  | "NO_SHOW" // nothing at all
  | "EARLY"; // input before the window opened, for games that forbid it

export interface RoundResult {
  outcome: Outcome;
  foul?: FoulReason;
  headline: string;
  detail: string;
}

export interface Score {
  player: number;
  ai: number;
  draws: number;
}

export interface PhaseStamp {
  from: Phase;
  to: Phase;
  at: number;
}
