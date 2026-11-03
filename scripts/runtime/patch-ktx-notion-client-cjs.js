#!/usr/bin/env node
/**
 * Patch @kaelio/ktx Notion adapter: ktx 0.16.0 uses
 *   import { Client } from '@notionhq/client'
 * but bundled @notionhq/client 5.x is CommonJS and Node ESM rejects that
 * named import. `ktx connection test` loads the adapter for every driver,
 * so MySQL / Postgres probes fail before they reach the database.
 *
 * Idempotent — safe to run on every image build.
 */
const fs = require("fs");
const path = require("path");

const MARKER = "lucy-notion-client-cjs-compat";
const TARGET = "import { Client } from '@notionhq/client';";
const REPLACEMENT = `import pkg from '@notionhq/client';
const { Client } = pkg; /* ${MARKER} */`;

function resolveNotionClientPath() {
  const envPath = process.env.KTX_NOTION_CLIENT_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    "/usr/local/lib/node_modules/@kaelio/ktx/dist/context/ingest/adapters/notion/notion-client.js",
    path.join(
      process.env.HOME || "",
      ".npm-global/lib/node_modules/@kaelio/ktx/dist/context/ingest/adapters/notion/notion-client.js"
    )
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  try {
    const pkgJson = require.resolve("@kaelio/ktx/package.json");
    return path.join(path.dirname(pkgJson), "dist/context/ingest/adapters/notion/notion-client.js");
  } catch {
    return null;
  }
}

function main() {
  const targetPath = resolveNotionClientPath();
  if (!targetPath) {
    console.error("patch-ktx-notion-client-cjs: notion-client.js not found");
    process.exit(1);
  }

  const text = fs.readFileSync(targetPath, "utf8");
  if (text.includes(MARKER)) {
    console.log(`patch-ktx-notion-client-cjs: already patched (${targetPath})`);
    return;
  }
  if (!text.includes(TARGET)) {
    console.error(`patch-ktx-notion-client-cjs: target import not found in ${targetPath}`);
    process.exit(1);
  }

  fs.writeFileSync(targetPath, text.replace(TARGET, REPLACEMENT), "utf8");
  console.log(`patch-ktx-notion-client-cjs: patched ${targetPath}`);
}

main();
