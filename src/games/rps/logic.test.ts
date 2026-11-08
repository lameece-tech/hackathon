import { describe, expect, it } from "vitest";
import type { Commit } from "../../input/InputManager";
import { scoreRound, type Throw } from "./logic";

const commit = (value: Throw, firstSeenAt = 0): Commit<Throw> => ({
  value,
  source: "gesture",
  firstSeenAt,
  confirmedAt: firstSeenAt + 66,
  lastSeenAt: firstSeenAt + 500,
  peakConfidence: 0.9,
});

describe("scoreRound", () => {
  it("scores locked throws", () => {
    expect(scoreRound({ kind: "locked", locked: commit("rock"), leadMs: 100 }, "scissors").outcome).toBe("win");
    expect(scoreRound({ kind: "locked", locked: commit("rock"), leadMs: 100 }, "paper").outcome).toBe("lose");
    expect(scoreRound({ kind: "locked", locked: commit("paper"), leadMs: 100 }, "paper").outcome).toBe("draw");
  });

  it("turns every foul into a loss, even when the late throw would have won", () => {
    const late = scoreRound({ kind: "foul", reason: "TOO_LATE", offending: commit("paper"), deltaMs: 180 }, "rock");
    expect(late).toMatchObject({ outcome: "foul", headline: "TOO LATE!" });
    expect(late.detail).toContain("180 ms");
    const switched = scoreRound(
      { kind: "foul", reason: "SWITCHED", locked: commit("rock"), offending: commit("paper"), deltaMs: 220 },
      "rock",
    );
    expect(switched).toMatchObject({ outcome: "foul", foul: "SWITCHED" });
  });
});
