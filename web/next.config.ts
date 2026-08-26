import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  // Allow the dev server to be reached from other devices on the LAN
  // (testing on a real Android phone — the "Bu Sari test" device).
  allowedDevOrigins: ["192.168.1.102", "100.120.83.114"],
  // Proxy API requests to the Go backend during development
// Use Tailscale IP so phone clients go through the tunnel to the API
  async rewrites() {
    const apiTarget = process.env.API_PROXY_TARGET ?? "http://100.120.83.114:8080";
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
      {
        source: "/healthz",
        destination: `${apiTarget}/healthz`,
      },
    ];
  },
  // Allow cross-origin images if needed (e.g., from ImageKit)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
    ],
  },
};

export default withNextIntl(nextConfig);