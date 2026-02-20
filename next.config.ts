import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3100",
    "http://localhost:3000",
    "http://localhost:3100",
  ],
};

export default nextConfig;
