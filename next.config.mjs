/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Load the WebSocket client from node_modules instead of bundling it: bundling breaks its
    // optional native helpers ("t.mask is not a function") and with them every Deriv WebSocket call.
    serverComponentsExternalPackages: ["ws", "bufferutil", "utf-8-validate"],
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
