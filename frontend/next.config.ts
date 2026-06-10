import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Router-Cache sofort invalidieren, damit Seiten immer frische Serverdaten zeigen
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
