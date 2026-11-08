import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The parent folder is another app (Couch Clash) with its own lockfile; don't adopt it as the root.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // The Little harness and phones on the LAN reach the dev server by IP, not localhost.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*"],
  async headers() {
    return [
      {
        // The platform fetches and pins this on publish; don't let a CDN serve a stale copy.
        source: "/little/manifest.json",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
