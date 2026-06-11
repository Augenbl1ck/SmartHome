import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Router-Cache sofort invalidieren, damit Seiten immer frische Serverdaten zeigen
    staleTimes: {
      dynamic: 0,
    },
    // Alt+Klick auf ein Element im Browser → VS Code springt zur Komponente
    reactCompiler: false,
  },
};

export default nextConfig;
