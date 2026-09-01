import type { NextConfig } from "next";

const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
// Three distinct hosts take part in a browser upload and all are required:
// vercel.com serves the multipart control plane (/api/blob/mpu), and the
// object itself lives on the per-store host, which for a private store is
// <id>.private.blob.vercel-storage.com. Downloads are top-level navigations
// and need no connect-src allowance.
const blobSources = [
  "https://vercel.com",
  "https://blob.vercel-storage.com",
  "https://*.blob.vercel-storage.com",
].join(" ");
const connectSources =
  process.env.NODE_ENV === "production"
    ? `'self' wss: ${blobSources}`
    : `'self' ws: wss: ${blobSources}`;

const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${developmentEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${connectSources}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["argon2", "ioredis", "ws"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/:roomPath",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
