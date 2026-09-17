import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["pg-boss", "pg", "@prisma/client", "undici"],
  // The e2e suite builds into its own directory so it never clobbers a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
