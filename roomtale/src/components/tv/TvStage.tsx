"use client";

import { useEffect, useState, type ReactNode } from "react";
import { STAGE } from "./ScanOverlay";

/**
 * The TV's fixed 1920×1080 canvas. A Little host already scales the page to the panel, so
 * under a host this is a plain full-size box; in a browser it letterboxes the canvas on black
 * and scales it to fit the window, so the layout looks exactly as it will on a TV. It scales
 * with a transform rather than CSS zoom because the SDK's perception snapshot reads element
 * rects, and only transforms are reflected in them.
 */
export function TvStage({ hosted, children }: { hosted: boolean; children: ReactNode }) {
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    if (hosted) return;
    const measure = () => {
      const scale = Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height);
      setFit({ scale, x: (window.innerWidth - STAGE.width * scale) / 2, y: (window.innerHeight - STAGE.height * scale) / 2 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hosted]);

  if (hosted) return <div className="relative h-full w-full overflow-hidden">{children}</div>;
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          width: STAGE.width,
          height: STAGE.height,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
