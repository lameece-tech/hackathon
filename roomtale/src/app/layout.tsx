import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoomTale",
  description: "Illustrated, read-aloud stories starring everyone in your living room.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070712",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The Little host sets the --little-safe-* overscan variables on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
