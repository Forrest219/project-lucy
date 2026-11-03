# Pre-batch A/B 基线对比（`a5810e4e` vs `c1ad7a8b`）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 目的 | 交接文档第三节 P0 指定的未完成验证：「在 `a5810e4e`（本批起点）上跑同样的全量，确认这条失败**在加了我那 2 个新测试文件之前就存在**」 |
| 结论 | **交接文档归因的两条症状（Symptom A／B）在本次 A/B 的两侧、共 5 次全量运行中一次都没有复现；两侧均 0 failed。此前观察到的失败是运行环境的 CPU 争用打爆了 vitest 默认 5 秒单测预算，不是代码缺陷，本批没有引入任何 webui 套件失败。** |

---

## 一、交接文档要求核对的症状

交接文档 P0 写了两条症状，都被要求做 A/B 归属：

| 症状 | 交接文档描述 |
|---|---|
| **Symptom A** | `api.create-connection.test.ts` 2 次间歇失败 |
| **Symptom B** | `admin-agents.test.ts` → `PATCH dryRun surfaces gate decision` 期望 200，实际 404 `AGENT_NOT_FOUND` |

## 二、A/B 的实测

两侧都用**同一套 CI 条件**跑：`PATH` 内**没有宿主 ktx CLI**（模拟 CI 的 `spec-and-webui`
job，它从不装 ktx），`--maxWorkers=1`（与 CI 的 `npm test` 一致），全程**不并发跑任何
其他重活**。

| 侧 | 提交 | 运行 | 结果 |
|---|---|---|---|
| Pre-batch | `a5810e4e` | `npx vitest run --maxWorkers=1` | **423 passed / 1 skipped（424 文件），5148 tests passed / 8 skipped（5156），0 failed，exit 0** |
| Post-batch | `c1ad7a8b` ＋ 本次 CI 修复 | 同上 | **426 passed / 1 skipped（427 文件），5183 tests passed / 8 skipped（5191），0 failed，exit 0** |

两侧的文件数与用例数之差恰好等于本批新增的 3 个 webui 测试文件：

```
webui/server/__tests__/publish-workbench-closure.test.ts
webui/src/__tests__/publish-sync-confirm-drawer.test.tsx
webui/src/__tests__/url-driven-input-mirror-contract.test.tsx
```

（另有 1 个根级脚本测试 `scripts/smoke/lucy-runtime-build-context.test.mjs`，不在
vitest 套件内，走 `npm run smoke:p0:delivery-isolation:build-context`。）

**两侧都是 0 failed。** 本批没有引入任何 webui 套件失败。

### Pre-batch 一侧的关键前提

`a5810e4e` 的工作树用 `git worktree` 挂在 `/private/tmp/ktx-prebatch`。两处必须手工补齐，
否则测的不是代码而是环境：

- `ktx.yaml` 被 `.gitignore` 排除（第 12 行），工作树里没有 → 从主工作树复制；
- 根 `node_modules` 与 `webui/node_modules` 不在版本控制里 → 软链到主工作树。

这两条正是「git worktree 跑不起来」最常见的原因，与被测代码无关。

## 三、此前观察到的「失败」是什么

第一次做 A/B 时，两侧都出现失败，形态是：

- 失败全部是 **vitest 默认 5 秒单测超时**（`webui/vitest.config.ts` 未设 `testTimeout`，
  vitest 默认 5000ms）；
- 命中的文件每次都不同（3 次运行给出 3 组不同的受害文件）；
- 首次运行 import 阶段耗时 **333 秒**，而安静状态下只要 **32–34 秒**。

同时段并发跑着 `npx tsc --noEmit` 和 docker 构建上下文冒烟。CPU 被抢之后，单测只要
原本 3 秒的用例超过 5 秒就判超时；**受害文件每次不同**正是这种争用下的随机受害者现象，
不是用例之间的顺序依赖。

**安静状态下重跑，两侧都不再出现这些失败**（见第二节，两侧均 0 failed）。因此：

- 交接文档把这条归因为「服务端 flake」，并要求「交给 PM 定性」；
- 实测口径应是：**这不是 flake，是本机跑全量时的资源争用**；
- 交接文档归因的两条症状——Symptom A（`api.create-connection.test.ts` 间歇失败）与
  Symptom B（`admin-agents.test.ts` 期望 200 得 404 `AGENT_NOT_FOUND`）——在本次
  A/B 的两侧、共 5 次全量运行中**一次都没有复现**；
- 本仓库没有任何一条 CI 结论是被这个原因影响的——CI runner 的 CPU 配额与本机不同，
  且 CI 的套件**从来没有报过这两条症状**。

## 四、对交接文档的更正

交接文档第三节写「全量门禁绿」，这与 GitHub Actions 的实际结论相反：`lucy-v0.25`
的 CI **自 2026-10-30 起是红的**（最后一次全绿是 2026-10-29 的 `cae69bbd`）。
实际成因有三处，已分别定位并修复：

| # | 门禁 | 成因 | 状态 |
|---|---|---|---|
| A | `workflow-contracts` | `scripts/lint-spec-docs.test.mjs` 被 git 跟踪但未登记进 root test 注册表 | 已由上游 `3a0857ee` 修复 |
| B | `k8s-static` | `v025-coverage.schema.json` 的 `requires` 枚举漏了 `mysql`，与 `catalog.mjs` 的 `CAPABILITIES` 漂移 → 40 条 manifest 行全挂 | 本次修复（`29f32170`） |
| C | `spec-and-webui` | 本批新测试 `publish-workbench-closure.test.ts` 没把 `../ktx` 打桩，真去调宿主 ktx CLI → ENOENT → 503 | 本次修复（`29f32170`） |

Failure C 的原始报错（CI 模拟运行复现）：

```
Error: expected 200 "OK", got 503 "Service Unavailable"
 ❯ server/__tests__/publish-workbench-closure.test.ts:125:77
    125|     await request(app.server).post("/api/semantic-assets/reindex").sen…
```

### CI 侧的实际 job 结论（修复前的 run #12，`c1ad7a8b`）

| job | 结论 |
|---|---|
| `spec-and-webui` | **failure** ← Failure C |
| `k8s-static` | **failure** ← Failure B |
| `workflow-contracts` | success ← Failure A 已由上游 `3a0857ee` 修好 |
| `k8s-upgrade-gate` / `headless-config` / `business-eval-catalog` / `ktx-diff-audit` | success |
| `docker-smoke` / `demo-db-smoke` / `postgres-demo-db-smoke` | **skipped**（被 `spec-and-webui` 的失败挡住） |
| `ci-required` | failure |

三处成因与交接文档「全量门禁绿」的说法逐条对不上：**门禁不是绿的，而且红的
位置不止一处**。

## 五、仍未验证的部分

- **`docker-smoke`（及其下游 `demo-db-smoke` / `postgres-demo-db-smoke`）** 此前因
  `spec-and-webui` 失败而被 `skipped`。修复落地后它会重新跑起来，执行真实的 docker
  build + compose（CI 侧约 25 分钟）。**宿主本地未做端到端验证**，这是当前最大的一条
  残余风险。
- **浏览器层与移动窄屏**按 `DEVELOPMENT.md` §44–48 默认不做，本文件的所有结论同样
  不覆盖这两层。

## 六、不在本文件里

- 本文件**没有**重跑交接文档 P1 所列的 L25 矩阵——见
  [`2026-11-01-l25-registry-verification.md`](2026-11-01-l25-registry-verification.md)。
- 本文件**没有**修改任何被测代码；A/B 只用于归属，不用于「修好它」。
