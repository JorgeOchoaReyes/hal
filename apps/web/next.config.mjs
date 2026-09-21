/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @hal/core is a workspace TS package compiled to ESM; let Next transpile it.
  transpilePackages: ["@hal/core"],
  eslint: { ignoreDuringBuilds: true },
  // Allow self-hosting behind any host; standalone output for easy Docker deploys.
  output: "standalone",
};

export default nextConfig;
