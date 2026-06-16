import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: false,
  experimental: {
    // Router-Cache sofort invalidieren, damit Seiten immer frische Serverdaten zeigen
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
