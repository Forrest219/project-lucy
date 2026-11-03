#!/usr/bin/env node
/**
 * 宿主 KTX CLI 版本自检。
 *
 * **为什么需要它**：镜像捆绑的 KTX 版本由 `Dockerfile` 的 `ARG KTX_VERSION`
 * 钉住，但 WebUI 在**本机直接跑**时是 `execFile("ktx", …)`（见
 * `webui/server/ktx.ts` 的 `testConnection` / `runIngest` / `validateSource` /
 * `reindexProject` / `runSql`，以及 `webui/server/ktx-runtime.ts`、
 * `webui/server/hive/compile-bridge.ts`）——拿到的是 PATH 上的宿主 CLI，
 * 不是镜像里的那份。仓库里的版本门禁全部打在镜像/容器内，宿主 CLI 落后不会
 * 让任何门禁变红。
 *
 * 事实源：`Dockerfile` 的 `ARG KTX_VERSION`。宿主 CLI 必须与它一致，否则本机
 * 的语义层、目录与连接测试结果可能与交付产物不同。
 *
 * 用法：
 *   node scripts/verify/verify-host-ktx-version.mjs
 *   LUCY_KTX_BIN=/path/to/ktx node scripts/verify/verify-host-ktx-version.mjs
 *
 * 退出码：0 一致 / 1 不一致 / 2 宿主未安装 ktx
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 镜像捆绑的 KTX 版本（唯一事实源）。 */
export async function readPinnedKtxVersion(repoRootDir = repoRoot) {
  const dockerfile = await readFile(path.join(repoRootDir, "Dockerfile"), "utf8");
  const match = dockerfile.match(/^ARG KTX_VERSION=(\S+)$/m);
  if (!match) throw new Error("Dockerfile has no ARG KTX_VERSION");
  return match[1];
}

/** 宿主 CLI 的版本；未安装返回 null。 */
export function readHostKtxVersion(ktxBin) {
  const result = spawnSync(ktxBin, ["--version"], { encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") return null;
  if (result.status !== 0) return null;
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

async function main() {
  const pinned = await readPinnedKtxVersion();
  const ktxBin = process.env.LUCY_KTX_BIN ?? "ktx";
  const host = readHostKtxVersion(ktxBin);

  if (!host) {
    console.error(
      `[verify-host-ktx] the host ktx CLI is unavailable (${ktxBin}). ` +
        `Install the pinned version: npm install -g @kaelio/ktx@${pinned}`
    );
    return 2;
  }
  if (host !== pinned) {
    console.error(
      `[verify-host-ktx] host ktx ${host} does not match the bundled ${pinned}. ` +
        `The host CLI is what a locally started WebUI shells out to, so local ` +
        `semantic-layer, catalog and connection-test results would differ from the ` +
        `shipped image. Run: npm install -g @kaelio/ktx@${pinned}`
    );
    return 1;
  }
  console.log(`[verify-host-ktx] host ktx ${host} matches the bundled ${pinned}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[verify-host-ktx] ${error.message}`);
      process.exitCode = 1;
    });
}
