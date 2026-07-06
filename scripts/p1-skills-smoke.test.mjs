import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "p1-skills-smoke.mjs");

async function writeFixtureFile(root, relPath, text) {
  const filePath = path.join(root, relPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

async function withFixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p1-skills-smoke-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runSmoke(root) {
  return spawnSync(process.execPath, [
    SCRIPT,
    "--root",
    root,
    "--out",
    "inbox/p1-skills-evidence.json"
  ], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

async function readEvidence(root) {
  const text = await readFile(path.join(root, "inbox", "p1-skills-evidence.json"), "utf8");
  return JSON.parse(text);
}

test("passes when skills, references, runtime instructions, and eval skill versions are covered", async () => {
  await withFixture(async (dir) => {
    await writeFixtureFile(dir, "skills/warehouse/SKILL.md", `---
name: warehouse-knowledge
version: v1.0
owner: forrest
triggers:
  - 数据
dependencies:
  - references/table-routing.md
eval_coverage:
  - demo-001
publish_targets:
  - claude-code
---

# Warehouse Knowledge Skill

参见 [表路由](references/table-routing.md)。
`);
    await writeFixtureFile(dir, "skills/warehouse/references/table-routing.md", `# Table Routing

本文件可被 Skill 依赖解析。
`);
    await writeFixtureFile(dir, "webui/config/data-qa-instructions.md", `# Lucy 数据问答基础指导

本 fallback 明确不自动加载 Skill；业务路由需要通过可见 catalog、wiki 或显式读取 skills/**/SKILL.md 后执行。
`);
    await writeFixtureFile(dir, "evals/demo/eval/demo-eval-cases.yaml", `metadata:
  version: v1.0
safety_contract:
  readonly: true
cases:
  - id: demo-001
    skill_version: v1.0
    question: demo
`);

    const result = runSmoke(dir);
    assert.equal(result.status, 0, result.stderr);
    const evidence = await readEvidence(dir);
    assert.equal(evidence.status, "pass");
    assert.equal(evidence.summary.blockers, 0);
  });
});

test("fails with explicit blockers for missing references, runtime skill routing, and eval skill_version gaps", async () => {
  await withFixture(async (dir) => {
    await writeFixtureFile(dir, "skills/warehouse/SKILL.md", `---
name: warehouse-knowledge
version: v1.0
owner: forrest
triggers:
  - 数据
dependencies:
  - references/missing.md
eval_coverage: []
publish_targets:
  - claude-code
---

# Warehouse Knowledge Skill
`);
    await writeFixtureFile(dir, "skills/warehouse/references/bad.md", `---
name: [not closed
---

# Bad Reference
`);
    await writeFixtureFile(dir, "webui/config/data-qa-instructions.md", `# Lucy 数据问答基础指导

只使用当前可见工具。
`);
    await writeFixtureFile(dir, "evals/demo/eval/demo-eval-cases.yaml", `metadata:
  version: v1.0
safety_contract:
  readonly: true
cases:
  - id: demo-001
    question: demo
`);

    const result = runSmoke(dir);
    assert.equal(result.status, 1);
    const evidence = await readEvidence(dir);
    assert.equal(evidence.status, "fail");
    assert.ok(evidence.blockers.some((item) => item.check === "skill-files" && item.reason === "dependency file not found"));
    assert.ok(evidence.blockers.some((item) => item.check === "skill-references" && item.reason === "reference frontmatter YAML is not parseable"));
    assert.ok(evidence.blockers.some((item) => item.check === "runtime-instructions"));
    assert.ok(evidence.blockers.some((item) => item.check === "eval-skill-version" && item.reason === "one or more eval cases are missing skill_version"));
  });
});
