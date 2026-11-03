/**
 * 客户镜像的构建上下文隔离——端到端验证。
 *
 * 与 `lucy-delivery-isolation-smoke.test.mjs` 的分工：
 * - 那条用自带的 dockerignore 解析器做**静态**断言，守护解析语义与反向断言；
 * - 这条**真跑 `docker build`**，在真实构建上下文里验证「任意深度的私有运行时状态
 *   都没进镜像，同时客户模板与 runtime 脚本还在」。
 *
 * 静态规则看不出 docker 实际怎么裁剪上下文，端到端这条能看出来，两者互补。
 *
 * 来源：分支 `codex/customer-publication-isolation` 的提交 7de67e77
 * （fix(delivery): exclude nested local runtime state from customer images）。
 * 该分支的唯一独有物就是这份测试；其 `.dockerignore` 与同族的
 * `lucy-delivery-isolation-smoke.mjs` 在主线已演进更新，本文件对现行规则直接通过。
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Docker excludes ignored runtime state at every depth while keeping customer templates", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lucy-runtime-context-"));
  const context = path.join(temp, "context");
  const output = path.join(temp, "output");
  const denied = [
    ".ktx/secrets/password",
    ".ktx-ui/security.sqlite-wal",
    "examples/docker-demo/project-template/.ktx-ui/audit.sqlite",
    "examples/docker-demo/project-template/.ktx-ui/audit.sqlite-wal",
    "webui/:memory:/.ktx-ui/security.sqlite",
    ".mcp.json",
    "nested/.env.local",
    "nested/.env.production.local",
    "webui/config/access.yaml",
    "webui/config/admins.yaml"
  ];
  const kept = ["customer-config.example/ktx.yaml", "webui/config/access.yaml.example", "scripts/runtime/docker-entrypoint.sh"];
  try {
    await mkdir(context);
    await writeFile(path.join(context, ".dockerignore"), await readFile(path.join(root, ".dockerignore")));
    await writeFile(path.join(context, "Dockerfile"), "FROM scratch\nCOPY . /context/\n");
    for (const name of [...denied, ...kept]) {
      await mkdir(path.dirname(path.join(context, name)), { recursive: true });
      await writeFile(path.join(context, name), "synthetic-fixture-only\n");
    }
    const result = spawnSync("docker", ["build", "--quiet", "--output", `type=local,dest=${output}`, context], {
      encoding: "utf8",
      timeout: 120000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const name of denied)
      await assert.rejects(access(path.join(output, "context", name)), { code: "ENOENT" }, name);
    for (const name of kept)
      assert.equal(await readFile(path.join(output, "context", name), "utf8"), "synthetic-fixture-only\n");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
