import { describe, expect, it } from "vitest";
import { cleanSpokenPrompt, findWake, matchTrigger, promptAfterWake } from "./wakeWord";

describe("wake phrase", () => {
  it.each(["hey RoomTale", "Hey room tale", "ok room tail", "hi Room Tell", "roomtale", "Hey, room-tale!"])("hears %s", (text) => {
    expect(findWake(text)).not.toBeNull();
  });

  it.each(["the room is tall", "bathroom tile", "tell me about the weather"])("ignores %s", (text) => {
    expect(matchTrigger(text)).toBeNull();
  });

  it("extracts the prompt that follows the wake phrase", () => {
    expect(promptAfterWake("Hey RoomTale, create a silly sci-fi story about everyone in this room")).toBe(
      "create a silly sci-fi story about everyone in this room",
    );
    expect(promptAfterWake("hey room tail um so a pirate story")).toBe("a pirate story");
  });

  it("treats a plain story request as a trigger", () => {
    expect(matchTrigger("tell us a story about dinosaurs")).toEqual({ kind: "request" });
    expect(matchTrigger("can you make a really silly bedtime story")).toEqual({ kind: "request" });
    expect(matchTrigger("hey roomtale")).toEqual({ kind: "wake" });
  });

  it("strips filler words", () => {
    expect(cleanSpokenPrompt("  um, uh so  please a space story  ")).toBe("a space story");
  });
});
