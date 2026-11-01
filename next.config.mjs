/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Load the WebSocket client from node_modules instead of bundling it: bundling breaks its
    // optional native helpers ("t.mask is not a function") and with them every Deriv WebSocket call.
    // Script bots run in QuickJS (WebAssembly); it loads its .wasm file from node_modules at runtime.
    serverComponentsExternalPackages: ["ws", "bufferutil", "utf-8-validate", "quickjs-emscripten", "quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],
    outputFileTracingIncludes: {
      "/api/**/*": ["./node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm"],
    },
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
