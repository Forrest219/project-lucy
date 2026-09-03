import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const PRODUCT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requireLucyVersion(value: string, source: string): string {
  const normalized = value.trim();
  if (!PRODUCT_VERSION_RE.test(normalized)) {
    throw new Error(`${source} must use numeric X.Y.Z form without a v prefix; got ${JSON.stringify(value)}`);
  }
  return normalized;
}

function readLucyVersion(): string {
  const fromEnv = (process.env.LUCY_VERSION ?? process.env.VITE_LUCY_VERSION ?? "").trim();
  if (fromEnv) return requireLucyVersion(fromEnv, "LUCY_VERSION/VITE_LUCY_VERSION");
  let fromFile: string;
  try {
    fromFile = readFileSync(resolve(here, "../VERSION"), "utf8");
  } catch {
    return "0.17.0";
  }
  return requireLucyVersion(fromFile, "VERSION");
}

const lucyVersion = readLucyVersion();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_LUCY_VERSION": JSON.stringify(lucyVersion)
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5174"
    }
  }
});
