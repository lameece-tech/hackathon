import type { RoundAudit } from "../input/InputManager";

const LEAD_IN_MS = 600;

/**
 * Every recognized frame of the round on one axis, against the window and the reveal frame.
 * Dots are frames (by capture time); bars are inputs that held long enough to count.
 */
export function TimingTimeline<V extends string>({
  audit,
  colorOf,
}: {
  audit: RoundAudit<V>;
  colorOf: (value: V) => string;
}) {
  const { spec, closedAt, verdict } = audit;
  const start = spec.opensAt - LEAD_IN_MS;
  const end = closedAt + spec.watchMs;
  const pct = (t: number) => `${(Math.min(Math.max((t - start) / (end - start), 0), 1) * 100).toFixed(2)}%`;
  const width = (a: number, b: number) => `${(Math.max(0, Math.min(b, end) - Math.max(a, start)) / (end - start)) * 100}%`;
  const locked = verdict.locked;
  const offending = verdict.kind === "foul" ? verdict.offending : undefined;

  return (
    <div className="relative h-24 w-full">
      <div className="absolute inset-x-0 top-8 h-12 rounded-xl bg-white/5" />
      <div
        className="absolute top-8 h-12 rounded-xl bg-volt/20 ring-2 ring-volt/60"
        style={{ left: pct(spec.opensAt), width: width(spec.opensAt, closedAt) }}
      />
      <span className="absolute top-0 text-xl font-black tracking-widest text-volt" style={{ left: pct(spec.opensAt) }}>
        WINDOW
      </span>

      {audit.log.map((entry, i) =>
        entry.capturedAt < start || entry.capturedAt > end ? null : (
          <span
            key={i}
            className={`absolute top-10 h-3 w-1.5 -translate-x-1/2 rounded-full ${entry.status === "accepted" ? "" : "ring-2 ring-stop"}`}
            style={{
              left: pct(entry.capturedAt),
              background: entry.value ? colorOf(entry.value) : "rgb(255 255 255 / 0.15)",
            }}
          />
        ),
      )}

      {audit.commits.map((c, i) => (
        <span
          key={i}
          className={`absolute top-15 h-4 rounded-full ${c === offending ? "ring-4 ring-stop" : c === locked ? "ring-4 ring-white" : ""}`}
          style={{ left: pct(c.firstSeenAt), width: width(c.firstSeenAt, c.lastSeenAt), background: colorOf(c.value) }}
        />
      ))}

      <div className="absolute top-5 h-18 w-1.5 -translate-x-1/2 bg-white" style={{ left: pct(closedAt) }} />
      <span className="absolute top-0 -translate-x-1/2 text-xl font-black tracking-widest" style={{ left: pct(closedAt) }}>
        REVEAL
      </span>
    </div>
  );
}
