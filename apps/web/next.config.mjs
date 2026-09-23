import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace TS packages compiled to ESM; let Next transpile them into the build.
  transpilePackages: ["@hal/core", "@hal/media"],
  eslint: { ignoreDuringBuilds: true },
  // Standalone output for the Electron bundle / Docker. In a pnpm monorepo Next
  // must trace from the repo root, otherwise `next` and workspace deps are left
  // out of .next/standalone/node_modules and the server fails with
  // "Cannot find module 'next'".
  output: "standalone",
  outputFileTracingRoot: join(__dirname, "..", ".."),
};

export default nextConfig;
