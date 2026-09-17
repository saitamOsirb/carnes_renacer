import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ["image/webp"],
    deviceSizes: [360, 480, 640, 750, 828, 1080, 1200, 1440],
    imageSizes: [64, 96, 128, 160, 192, 256, 320],
    minimumCacheTTL: 2_592_000,
  },
  experimental: {
    optimizePackageImports: [],
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
