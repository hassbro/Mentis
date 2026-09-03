import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      {
        source: "/",
        // You can check a specific query parameter or header, 
        // or ensure it only redirects if it's a direct visit without a launch flag
        has: [
          {
            type: "query",
            key: "mode",
            value: "admin", // Only redirects if ?mode=admin is present, or vice-versa
          },
        ],
        destination: "/admin",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;