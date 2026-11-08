import { configureLittle } from "@kabletv/little-react";

// Must run before the first Little hook mounts. The SDK's dev stage reparents <body>'s
// children into a wrapper, which breaks a Next.js app (React owns the whole document);
// <TvStage> does the same 1920×1080 fit-to-window scaling inside React instead.
configureLittle({ devScale: false });
