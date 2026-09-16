import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["pg-boss", "pg", "@prisma/client"],
};

export default nextConfig;
