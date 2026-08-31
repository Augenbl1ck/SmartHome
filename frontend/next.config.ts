import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: false,
  // Pi: nicht 60s auf Laravel warten, wenn versehentlich noch prerendert wird.
  staticPageGenerationTimeout: 20,
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
