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

export default defineConfig({
  plugins: [react()],
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
  },
});
