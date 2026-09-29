import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  allowedDevOrigins: ["192.168.1.196","192.168.1.200"],
  output:"standalone",
  // The dedicated `npm run lint` gate is the single lint gate. Without this,
  // `next build` would run ESLint too and a lint failure would break the image
  // build in Dockerfile:36-40 before the CI gate reported it.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
