import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
const publicDomain = process.env.POCKETCONTEXT_DEV_PUBLIC_DOMAIN;
if (
  publicDomain &&
  (publicDomain.length > 253 ||
    !publicDomain.includes(".") ||
    isIP(publicDomain) ||
    !publicDomain
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))
) {
  throw new Error(
    "POCKETCONTEXT_DEV_PUBLIC_DOMAIN must be an explicit lowercase DNS hostname",
  );
}

// The server's asset route serves only names like `name-hash.js` (letters,
// digits, `_` and `-`; .js, .css, .woff2 or .svg). Chunk names from files such
// as pdf.mjs lose their dots, and the pdf.js worker (.mjs) becomes a .js asset.
const safeName = (name: string) =>
  name.replace(/\.[cm]?js$/, "").replace(/[^A-Za-z0-9_-]+/g, "-") || "chunk";

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) => `assets/${safeName(chunk.name)}-[hash].js`,
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? "";
          if (/^pdf\.worker(\.min)?\.mjs$/.test(name))
            return "assets/pdf-worker-[hash].js";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    fs: { strict: true, allow: [fileURLToPath(new URL(".", import.meta.url))] },
    ws: {
      path: "/__ui_hmr",
      ...(publicDomain
        ? { protocol: "wss" as const, host: publicDomain, clientPort: 443 }
        : { clientPort: Number(process.env.POCKETCONTEXT_DEV_PORT || 8099) }),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Above the 5 s async wait in test-setup.ts, so a slow wait fails with
    // its own message instead of the test timeout.
    testTimeout: 20000,
  },
});
