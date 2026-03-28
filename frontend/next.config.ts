import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for a unified self-hosted Docker setup
  output: 'export',
  // Disable image optimization because we are doing a static export
  images: {
    unoptimized: true,
  },
  // Keep our network access settings
  allowedDevOrigins: ["192.168.1.34", "omihome", "localhost"],
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 5,
  }
};

export default nextConfig;
