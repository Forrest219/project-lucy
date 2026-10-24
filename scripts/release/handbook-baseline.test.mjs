import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertHandbookBaseline,
  parseHandbookBaselineTable,
  readBaselineSources
} from "./handbook-baseline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const HANDBOOK_OK = `## 0. 常见问题速查

### 0.0 文档基线（自动同步）

本表由 \`npm run lint:handbook-baseline\` 校验；任一格被手改、与事实源不一致即 fail。

| 字段 | 当前值 | 来源 |
| --- | --- | --- |
| 产品版本（\`VERSION\`） | 0.2.0 | \`VERSION\` |
| 产品版本标签 | v0.2.0 | \`webui/src/lib/lucyVersion.ts\` FALLBACK |
| Helm \`appVersion\` | 0.2.0 | \`deploy/k8s/helm/lucy/Chart.yaml\` \`appVersion\` |
| 捆绑 KTX 版本 | 0.16.0 | \`Dockerfile\` \`LUCY_BUNDLED_KTX_VERSION\` |
| 上次手册审计 | 2026-10-24 | 人工维护；下次审计由治理 PR 触发 |
| 版本号规则 | \`0.2.x\`（版本号不承担大小序，见 \`docs/governance/version-matrix.md\` §1.1） | \`docs/governance/version-matrix.md\` |

> 不要手改。

### 0.1 面向开发者

占位行。
`;

const CHART_OK = `apiVersion: v2
name: lucy
description: Lucy
version: 0.2.6
appVersion: "0.2.0"
`;
const LUCY_VERSION_OK = `const FALLBACK = "0.2.0";
const PRODUCT_VERSION_RE = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/;
`;
const DOCKERFILE_OK = `ARG TARGETPLATFORM=linux/amd64
ARG KTX_VERSION=0.16.0
ARG LUCY_VERSION=0.2.0
`;

function makeFixtureRepo(files) {
  const tmp = mkdtempSync(path.join(tmpdir(), "handbook-baseline-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(tmp, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return tmp;
}

function withFixture(files, fn) {
  const tmp = makeFixtureRepo(files);
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const SOURCES_OK = {
  version: "0.2.0",
  sidebarLabel: "v0.2.0",
  helmAppVersion: "0.2.0",
  ktxVersion: "0.16.0"
};

test("readBaselineSources reads the four expected values from a fixture repo", () => {
  withFixture(
    {
      VERSION: "0.2.0\n",
      "deploy/k8s/helm/lucy/Chart.yaml": CHART_OK,
      "webui/src/lib/lucyVersion.ts": LUCY_VERSION_OK,
      Dockerfile: DOCKERFILE_OK
    },
    (tmp) => {
      const sources = readBaselineSources(tmp);
      assert.deepEqual(sources, SOURCES_OK);
    }
  );
});

test("parseHandbookBaselineTable extracts the §0.0 baseline table fields", () => {
  const parsed = parseHandbookBaselineTable(HANDBOOK_OK);
  assert.equal(parsed["产品版本（`VERSION`）"], "0.2.0");
  assert.equal(parsed["产品版本标签"], "v0.2.0");
  assert.equal(parsed["Helm `appVersion`"], "0.2.0");
  assert.equal(parsed["捆绑 KTX 版本"], "0.16.0");
  assert.equal(parsed["上次手册审计"], "2026-10-24");
  assert.equal(parsed["版本号规则"], "`0.2.x`（版本号不承担大小序，见 `docs/governance/version-matrix.md` §1.1）");
});

test("assertHandbookBaseline passes when §0.0 aligns with sources", () => {
  const result = assertHandbookBaseline(HANDBOOK_OK, SOURCES_OK);
  assert.deepEqual(result, SOURCES_OK);
});

test("assertHandbookBaseline throws when product version diverges", () => {
  const wrong = HANDBOOK_OK.replace(
    "| 产品版本（`VERSION`） | 0.2.0 |",
    "| 产品版本（`VERSION`） | 9.9.9 |"
  );
  assert.throws(
    () => assertHandbookBaseline(wrong, SOURCES_OK),
    /产品版本（`VERSION`）[\s\S]*9\.9\.9[\s\S]*0\.2\.0/
  );
});

test("assertHandbookBaseline throws when the product version label diverges", () => {
  const wrong = HANDBOOK_OK.replace(
    "| 产品版本标签 | v0.2.0 |",
    "| 产品版本标签 | v9.9.9 |"
  );
  assert.throws(
    () => assertHandbookBaseline(wrong, SOURCES_OK),
    /产品版本标签[\s\S]*v9\.9\.9[\s\S]*v0\.2\.0/
  );
});

test("assertHandbookBaseline throws when Helm appVersion diverges", () => {
  const wrong = HANDBOOK_OK.replace(
    "| Helm `appVersion` | 0.2.0 |",
    "| Helm `appVersion` | 9.9.9 |"
  );
  assert.throws(
    () => assertHandbookBaseline(wrong, SOURCES_OK),
    /Helm `appVersion`[\s\S]*9\.9\.9[\s\S]*0\.2\.0/
  );
});

test("assertHandbookBaseline throws when bundled KTX version diverges", () => {
  const wrong = HANDBOOK_OK.replace(
    "| 捆绑 KTX 版本 | 0.16.0 |",
    "| 捆绑 KTX 版本 | 9.9.9 |"
  );
  assert.throws(
    () => assertHandbookBaseline(wrong, SOURCES_OK),
    /捆绑 KTX 版本[\s\S]*9\.9\.9[\s\S]*0\.16\.0/
  );
});
