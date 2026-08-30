import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: false,
  experimental: {
    // Client-Router-Cache: 30s, damit Home/Settings nicht bei jedem Tab-Wechsel
    // neu vom Server geholt werden. Gerätedaten kommen weiter per Echo.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
