import { copyFile, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const SCRIPT = fileURLToPath(new URL("./patch-ktx-notion-client-cjs.js", import.meta.url));
const MARKER = "lucy-notion-client-cjs-compat";

async function runPatch(workDir, filePath) {
  // Repo package.json is "type": "module"; the patcher is CJS like the StarRocks
  // patch and is meant to run from /tmp during image build. Tests copy it to .cjs.
  const tmpScript = path.join(workDir, "patch-ktx-notion-client-cjs.cjs");
  await copyFile(SCRIPT, tmpScript);
  return spawnSync(process.execPath, [tmpScript], {
    env: { ...process.env, KTX_NOTION_CLIENT_PATH: filePath },
    encoding: "utf8"
  });
}

test("rewrites the Notion Client named import to a CJS default import", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-notion-patch-"));
  const filePath = path.join(dir, "notion-client.js");
  await writeFile(
    filePath,
    "import { Client } from '@notionhq/client';\nexport function ping() { return Client; }\n",
    "utf8"
  );
  try {
    const result = await runPatch(dir, filePath);
    assert.equal(result.status, 0, result.stderr);
    const text = await readFile(filePath, "utf8");
    assert.match(text, /import pkg from '@notionhq\/client'/);
    assert.match(text, /const \{ Client \} = pkg/);
    assert.ok(text.includes(MARKER));
    assert.doesNotMatch(text, /import \{ Client \} from '@notionhq\/client'/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("is idempotent when the marker is already present", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-notion-patch-"));
  const filePath = path.join(dir, "notion-client.js");
  const already = `import pkg from '@notionhq/client';\nconst { Client } = pkg; /* ${MARKER} */\n`;
  await writeFile(filePath, already, "utf8");
  try {
    const result = await runPatch(dir, filePath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(filePath, "utf8"), already);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
