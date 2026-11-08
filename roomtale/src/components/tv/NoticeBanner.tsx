import type { Notice } from "@/lib/engine/machine";

export function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const error = notice.kind === "error";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--little-safe-top,0px)+40px)] z-50 flex justify-center">
      <div
        key={notice.at}
        role="status"
        data-little="readout"
        data-little-label={error ? "Problem" : "Notice"}
        className={`glass animate-fade-up rounded-full px-12 py-5 text-[36px] font-bold shadow-2xl ${error ? "border-blush/60 text-blush" : "text-white"}`}
      >
        {notice.text}
      </div>
    </div>
  );
}
