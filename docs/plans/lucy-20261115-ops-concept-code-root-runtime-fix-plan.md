# Ops 概念核心代码根与运行时装配修复 Implementation Plan

> **For agentic workers:** 委托人已授权 **落盘 Spec＋Plan**。**R2-F＋R4 已闭合**——按 Task 勾选实现；全真复测优先；全真复测优先；禁止 vitest 冒充 UAT PASS。

| 元数据 | 内容 |
|---|---|
| 状态 | S5｜v0.7；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。R2-F＋R4 已闭合（2026-11-15）；开发授权已获得；实现已落地；SC-01–SC-09 通过；测试台复测 PASS（cursor-p1-27-ops-retest）；GAP-UAT-P1-11-RUNTIME 已关闭；不入核心分母；≠ 可上线 |
| 主 Spec | [`docs/specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md`](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md) **v0.7** |
| 总账 | **P1-27**／REQ-030-048；**不入核心分母**；P1-11 伴生事故修复 |
| 父合同 | [P1-11 Spec](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md) |
| 授权边界 | 本 Plan 只约定实现任务与验收。改 `webui/server` 须另获终稿确权＋开发授权 |
| 验收 | Spec SC-01–SC-09；测试台 `UAT-OPS-CONCEPT-02`（＋01／03） |
| 过程对抗 | [Kimi](../reviews/2026-11-15-kimicode-review-ops-concept-code-root-runtime-fix.md)（≠ R2-F） |
| Codex 终审 | [Codex](../reviews/2026-11-15-codex-review-ops-concept-code-root-runtime-fix.md) |

## 目标

在容器拆卷部署下，概念 Ops 工具从 **代码根**加载 `scripts/concepts/**`，项目／内容根仍信 `KTX_PROJECT_ROOT`；读写失败统一 `ops_concept_runtime_unavailable` 且可审计；commit **claim 前预加载**（D10）；关闭 GAP-UAT-P1-11-RUNTIME。

## Architecture

`resolveConceptCodeRoot()`＝从 ops 模块 `import.meta.url` 祖先查找 `scripts/concepts/store.mjs`（**禁 cwd**）；动态 import／默认 whitelist 走 codeRoot；`invokeOpsTool` 读写分支强制 try/catch；commit 前 preload；content／fence 仍走 projectRoot。

## Tech Stack

Node ESM 动态 `import`、`pathToFileURL`、Vitest、`docs/qa/uat/suites/ops-concepts/`。

## Global Constraints

- 不修改 KTX 源码；不改问数热路径；不本版扩 WebUI 概念页
- **禁止**把 `scripts/concepts` 播种进数据卷／template 当作正式修复
- **禁止**以 `process.cwd()` 解析代码根
- 禁止用手工 `docker cp`／临时 `/tmp` 探针冒充 UAT PASS
- 凭据只写路径；≠ 可上线
- 
## 浏览器验证

不适用：Spec 已交互合同豁免；本条仅修复 Ops MCP 装配，不改变用户可见 WebUI 表面，无浏览器验收步骤

---

## 1. 开工前置（开发授权后）

- [x] Spec 终稿确权（Codex CLI 终审 PASS，2026-11-15）
- [x] 委托人另发 **开发授权**（2026-11-15）
- [x] 总账 P1-27／REQ-030-048／Spec／Plan 头部同句镜像为「已授权实现」后再动代码

---

## 2. 文件地图

| 文件 | 职责 | SC |
|---|---|---|
| `webui/server/ops/concepts-adapter.ts` | `resolveConceptCodeRoot`；`importConceptModule`；`resolveConceptWhitelistPath(codeRoot, …)`；写路径加载失败 → `ops_concept_runtime_unavailable`；**claim 前 preload 入口** | SC-01–03／05／09 |
| `webui/server/ops/concepts-read.ts` | 动态 import → codeRoot；读路径失败同码 | SC-01–03／05 |
| `webui/server/ops/ops-tools.ts` | **强制**：读写分支不抛；写前置入 try；commit 前调用 preload | SC-05／06／09 |
| `webui/server/ops/ops-batch.ts` | **仅当需要**：保证 claim 后加载失败仍可经 `opsOutcome`／detail 保留 runtime 码；**不得**破坏 D19／D21 | SC-09 |
| `webui/server/proxy/mcp-proxy.ts` | **默认不改**；仅当读分支收敛后仍冒 502 再单点补 | SC-05 |
| `webui/server/ops/__tests__/ops-concepts.test.ts` | 去掉 cp；改走 Task 3 全部锚点；禁 cwd；故障矩阵 | SC-04／07／09 |
| `docs/qa/uat/suites/ops-concepts/runs/…` | 复测跑次（gitSha＋gitDirty=false） | SC-08 |
| INDEX／e2e-ledger／总账 | 关缺口指针 | SC-08 |

---

## 3. Tasks（获开发授权后执行）

### Task 1: 代码根解析＋加载改锚

- [x] **Step 1:** 实现 `resolveConceptCodeRoot()`：从本模块 `import.meta.url` 祖先逐级查找 `scripts/concepts/store.mjs`；失败 → 抛／返回带 code＝`ops_concept_runtime_unavailable` 的可控错误（如 `OpsConceptError`）。**禁止** `process.cwd()`
- [x] **Step 2:** `importConceptModule`／`concepts-read` 动态 import 改用 codeRoot；加载失败同可控错误码；`resolveConceptWhitelistPath` **首参改名为 `codeRoot`（或注释锁定）**，默认路径＝`path.join(codeRoot, "scripts/concepts/seed-whitelist.yaml")`
- [x] **Step 3:** 确认 `resolveOpsConceptContentRoot(projectRoot)`、恢复围栏路径仍用 projectRoot

**本地快检（修复进镜像后）：**

```bash
docker exec compose-lucy-1 sh -c 'test ! -e /data/lucy/scripts && echo no-volume-scripts'
docker exec compose-lucy-1 node --input-type=module -e \
  'import{pathToFileURL}from"node:url"; await import(pathToFileURL("/app/scripts/concepts/store.mjs").href); console.log("ok")'
```

### Task 2: 失败可观测（强制；读写同码；D10）

- [x] **Step 1（强制）：** `ops-tools.ts` 读分支 **整体** try/catch（含 `resolveOpsActorContext` 等前置）：catch **透传** `err.code`；无 code → `ops_tool_failed`；**不得向外抛**
- [x] **Step 2（强制）：** `concepts-adapter.ts` 写路径：`importConceptModule`／默认 whitelist 读取失败统一包成 `ops_concept_runtime_unavailable`（含 `buildPlan` 等加载点）
- [x] **Step 3（强制）：** 写分支 try 外前置——非 dry-run scan 的 `getOpsDatabase`／`loadPlanRow`、以及 `enforceOwnerOnly`——移入既有写 catch 或各自收敛为信封
- [x] **Step 4（强制／D10）：** commit 路径在 **claim 前**预加载所需 `scripts/concepts` 模块与默认 whitelist；失败 → 顶层 `ops_concept_runtime_unavailable`、不 claim。claim 后加载失败：保留 D19／D21 结算，诊断含该码（必要时给 `OpsConceptError` 挂 `opsOutcome` 供 `outcomeOfError` 识别，或写入 result.detail）
- [x] **Step 5:** 故障矩阵探针／vitest（均须信封＋审计，不得 reject）：actor 失败、DB／计划读取失败、owner 失败、模块加载失败、whitelist 读取／解析失败；分别断言正确错误码（加载类＝runtime_unavailable；其余≠误用该码）

### Task 3: vitest

- [x] **Step 1:** 临时 projectRoot **不** `cp scripts/concepts`；依赖 Task 1 的 `import.meta.url` 解析到仓库根；断言 list 成功（空库可）
- [x] **Step 2:** 改写文件内 **全部** `path.join(projectRoot, "scripts/concepts/…")`：whitelist **L254／L340／L510**＋直接 import **L250／L336／L402／L473／L506／L662／L717** → `resolveConceptCodeRoot()`／`repoRoot`；纯模块对比两侧同一 codeRoot 实例
- [x] **Step 3:** 保留 `no_ops_agent` 拒 list；**禁止** `process.chdir`；`rg "path.join\\(projectRoot, .scripts/concepts"` 于该测试文件须 **0 命中**
- [x] **Step 4:** 覆盖 SC-09（持久计划＋加载失败／预加载）至少一条夹具
- [x] **Step 5:** `cd webui && npx vitest run server/ops/__tests__/ops-concepts.test.ts`

### Task 4: 文档镜像（实现中／后）

- [ ] Spec／Plan 头部状态升「实现中／功能合同收口」同句
- [ ] 总账 P1-27、REQ-030-048、父 Spec P1-11 状态行加修复指针
- [ ] e2e-ledger GAP-UAT-P1-11-RUNTIME 直至复测 PASS 后关闭

### Task 5: 测试台复测（另需 UAT 执行授权／委托人放行）

- [ ] **Step 0（强制）：** `demo:upgrade` 后 `GET /api/health` → `gitSha`＝修复提交且 `gitDirty=false`；否则 **STOP**
- [ ] 按 `UAT-SUITE-OPS-CONCEPTS` 复跑 01→02→03（卷上无 `/data/lucy/scripts`）
- [ ] Cursor 验收：INDEX 更新；关 GAP；`npm run lint:e2e-ledger`

---

## 4. 验收命令（实现后）

```bash
cd webui && npx vitest run server/ops/__tests__/ops-concepts.test.ts
npm run lint:e2e-ledger
npm run lint:spec-docs
# UAT：health gitSha＋gitDirty=false 后见 docs/qa/uat/suites/ops-concepts/
```

## 5. 完成定义

- 功能合同：SC-01–SC-09 证据齐
- 测试台：SC-08（OPS-CONCEPT-02 PASS；GAP 关闭；gitSha／gitDirty 对齐）
- **不含：** 可上线；客户现场 Ops 概念运维交付包

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| `import.meta.url` 上行层数不对 | 逐级查找 `store.mjs`；容器以 `/app` 实测为准 |
| 误把 codeRoot 写成 projectRoot | SC-02／07；whitelist 参数名锁定 codeRoot |
| 502 抹因残留 | Task 2 强制不抛；UAT 断言错误码 |
| 旧镜像／脏树假绿 | Task 5 Step 0 gitSha＋gitDirty=false |
| claim 后加载失败破坏结算 | D10／SC-09；保留 D19／D21 |

回滚：恢复改前加载点即可；无数据迁移。

## 7. 变更

| 版本 | 内容 |
|---|---|
| v0.1-draft | 首开任务图 |
| v0.2–v0.5-draft | Kimi 三轮＋委托人 1A／2A／3A／4C |
| v0.6-draft | Codex F-01…F-04：D10 preload；故障矩阵；目标小节；SC-09 |
| v0.7-draft | Codex F-04／F-05：状态同句；浏览器验证不适用 |
| v0.7 | Codex R2-F #3＝PASS；R4 开发授权（2026-11-15）；实现落地中（vitest ops-concepts 24/24） |

## 8. 委托人已批（会话）

- 2026-11-15：授权落盘 Spec＋Plan；Kimi 三轮过程对抗
- 2026-11-15：裁决 **1A／2A／3A／4C**
- 2026-11-15：Codex R2-F #3＝PASS → **终稿确权闭合**
- **未**批开发授权／UAT 复测执行
