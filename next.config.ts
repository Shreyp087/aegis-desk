import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const rootDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingRoot: rootDir,
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
