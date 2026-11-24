/** @type {import('next').NextConfig} */
// What pages may load and talk to. The browser only needs this site plus the public price feeds the
// Markets page streams from (Deriv, Binance); fonts are bundled with the site.
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines small scripts and styles into each page.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' wss://api.derivws.com https://data-api.binance.vision wss://data-stream.binance.vision",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // No other site may show binaryTrades inside a frame (stops click-jacking of Buy / Sell buttons).
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
