import { cleanSpokenPrompt, matchTrigger, promptAfterWake, wordCount } from "./wakeWord";

export type ListenMode = "off" | "wake" | "prompt";

export interface VoiceCallbacks {
  /** The wake phrase (or a plain story request) was heard while waiting. */
  onWake(): void;
  /** The prompt so far, while capturing. */
  onTranscript(text: string): void;
  /** The viewer finished speaking. */
  onPrompt(text: string): void;
  /** Prompt capture started but nobody said anything. */
  onNoSpeech(): void;
  /** Recognition can't run here: "not-allowed", "audio-capture", "network", "unavailable". */
  onError(code: string): void;
}

interface Timing {
  /** Quiet time after the last final result that ends the prompt. */
  settleMs: number;
  /** Quiet time after the last interim result (the recognizer may still revise it). */
  interimSettleMs: number;
  noSpeechMs: number;
  maxPromptMs: number;
}

const DEFAULT_TIMING: Timing = { settleMs: 1300, interimSettleMs: 2600, noSpeechMs: 8000, maxPromptMs: 25_000 };
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

function recognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * One continuous Web Speech recognizer shared by both jobs: waiting for "hey RoomTale" and
 * capturing the prompt that follows. A wake phrase and its prompt are often one utterance
 * ("hey RoomTale, a pirate story about us"), so capture picks up from the very result the
 * wake phrase was heard in instead of restarting recognition and losing the first words.
 */
export class VoiceListener {
  static supported(): boolean {
    return recognitionCtor() !== null;
  }

  private recognition: SpeechRecognition | null = null;
  private mode: ListenMode = "off";
  private running = false;
  private disposed = false;

  // Prompt capture, in this recognition session's result indexes.
  private promptStart = 0;
  private wakeIndex = -1;
  private carry = "";
  private latest = "";
  private resultCount = 0;

  private settleTimer?: ReturnType<typeof setTimeout>;
  private noSpeechTimer?: ReturnType<typeof setTimeout>;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private sessionStartedAt = 0;
  private shortSessions = 0;

  constructor(
    private readonly cb: VoiceCallbacks,
    private readonly lang = "en-US",
    private readonly timing: Timing = DEFAULT_TIMING,
  ) {}

  get currentMode(): ListenMode {
    return this.mode;
  }

  setMode(mode: ListenMode) {
    if (this.disposed || mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    this.clearTimers();
    if (mode === "off") {
      this.stop();
      return;
    }
    // Start first: a fresh session resets resultCount, and the prompt must begin after it.
    this.ensureRunning();
    if (mode === "prompt" && previous !== "prompt") this.beginPrompt(this.resultCount, -1);
  }

  dispose() {
    this.disposed = true;
    this.mode = "off";
    this.clearTimers();
    clearTimeout(this.restartTimer);
    this.stop();
    this.recognition = null;
  }

  private beginPrompt(startIndex: number, wakeIndex: number) {
    this.promptStart = startIndex;
    this.wakeIndex = wakeIndex;
    this.carry = "";
    this.latest = "";
    this.noSpeechTimer = setTimeout(() => {
      if (this.mode === "prompt" && !this.latest) {
        this.mode = "off";
        this.stop();
        this.cb.onNoSpeech();
      }
    }, this.timing.noSpeechMs);
    this.maxTimer = setTimeout(() => this.finishPrompt(), this.timing.maxPromptMs);
  }

  private finishPrompt() {
    if (this.mode !== "prompt") return;
    const text = cleanSpokenPrompt(this.latest);
    this.clearTimers();
    // Recognition stops here; the owner switches back to "wake" once the story is done.
    this.mode = "off";
    this.stop();
    if (text) this.cb.onPrompt(text);
    else this.cb.onNoSpeech();
  }

  private create(): SpeechRecognition | null {
    const Ctor = recognitionCtor();
    if (!Ctor) return null;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = this.lang;
    r.maxAlternatives = 1;
    r.onresult = (e) => this.onResult(e);
    r.onerror = (e) => this.onError(e);
    r.onend = () => this.onEnd();
    return r;
  }

  private ensureRunning() {
    if (this.running) return;
    this.recognition ??= this.create();
    if (!this.recognition) {
      this.mode = "off";
      this.cb.onError("unavailable");
      return;
    }
    try {
      this.recognition.start();
      this.running = true;
      this.sessionStartedAt = performance.now();
      this.resultCount = 0;
    } catch {
      // start() throws InvalidStateError if a previous session hasn't fully ended; onend retries.
    }
  }

  private stop() {
    if (!this.running || !this.recognition) return;
    try {
      this.recognition.abort();
    } catch {
      // Already stopped.
    }
  }

  private onResult(e: SpeechRecognitionEvent) {
    const results = e.results;
    this.resultCount = results.length;

    if (this.mode === "wake") {
      for (let i = e.resultIndex; i < results.length; i++) {
        const hit = matchTrigger(results[i][0].transcript);
        if (!hit) continue;
        this.mode = "prompt";
        this.beginPrompt(i, hit.kind === "wake" ? i : -1);
        this.cb.onWake();
        break;
      }
    }
    if (this.mode !== "prompt") return;

    let text = this.carry;
    let allFinal = true;
    for (let j = this.promptStart; j < results.length; j++) {
      const t = results[j][0].transcript;
      text += ` ${j === this.wakeIndex ? promptAfterWake(t) : t}`;
      if (!results[j].isFinal) allFinal = false;
    }
    this.latest = cleanSpokenPrompt(text);
    this.cb.onTranscript(this.latest);

    clearTimeout(this.settleTimer);
    if (wordCount(this.latest) > 0) {
      clearTimeout(this.noSpeechTimer);
      this.settleTimer = setTimeout(() => this.finishPrompt(), allFinal ? this.timing.settleMs : this.timing.interimSettleMs);
    }
  }

  private onError(e: SpeechRecognitionErrorEvent) {
    if (e.error === "no-speech" || e.error === "aborted") return;
    if (FATAL.has(e.error)) {
      this.mode = "off";
      this.clearTimers();
      this.cb.onError(e.error === "service-not-allowed" ? "not-allowed" : e.error);
    } else if (e.error === "network") {
      this.cb.onError("network");
    }
  }

  private onEnd() {
    this.running = false;
    if (this.disposed || this.mode === "off") return;
    // Chrome ends "continuous" sessions on its own (silence, ~60s, network blips). Carry the
    // prompt so far into the next session and restart, backing off if sessions die instantly.
    const lived = performance.now() - this.sessionStartedAt;
    this.shortSessions = lived < 1000 ? this.shortSessions + 1 : 0;
    if (this.shortSessions >= 4) {
      this.mode = "off";
      this.clearTimers();
      this.cb.onError("unavailable");
      return;
    }
    if (this.mode === "prompt") {
      this.carry = this.latest;
      this.promptStart = 0;
      this.wakeIndex = -1;
    }
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.ensureRunning(), 200 * (this.shortSessions + 1));
  }

  private clearTimers() {
    clearTimeout(this.settleTimer);
    clearTimeout(this.noSpeechTimer);
    clearTimeout(this.maxTimer);
  }
}
