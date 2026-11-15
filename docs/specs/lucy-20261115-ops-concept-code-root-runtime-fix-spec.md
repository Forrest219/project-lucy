# Ops 概念核心代码根与运行时装配修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 事故修复合同／**v0.7** |
| 日期 / 目标版本 | 2026-11-15／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-27**／REQ-030-048／**P1**（P1-11 伴生事故修复；**不入核心分母**） |
| 状态 | **v0.7；R2-F＋R4 已闭合（2026-11-15）；实现中；关 GAP-UAT-P1-11-RUNTIME；不入核心分母；≠ 可上线** |
| 决策来源 | 差集 UAT [`2026-11-15-claude-macmini-p1-11-ops`](../qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)：`allow.ops` 可见工具，但 `list`／`summary` 502、`scan` `ERR_MODULE_NOT_FOUND`（从 `KTX_PROJECT_ROOT=/data/lucy` 加载 `scripts/concepts/*.mjs`） |
| 父合同 | [P1-11 概念注册表 Ops Spec](lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md)（D11／D12／D15／D19／D21／D22；实施主体复用 `scripts/concepts/**`） |
| 授权 | **R2-F＋R4 已闭合（2026-11-15）**。实现按 Plan 进行中 |
| 测试台 | [`UAT-SUITE-OPS-CONCEPTS`](../qa/uat/suites/ops-concepts/suite.md)（INDEX 已挂首跑 **FAIL**；复测 **NOT RUN**）。复测必做：`UAT-R0-FIX`、`UAT-OPS-CONCEPT-02`；回归 `01`／`03`；cases 已落盘可复跑 |
| 配套 Plan | [lucy-20261115-ops-concept-code-root-runtime-fix-plan.md](../plans/lucy-20261115-ops-concept-code-root-runtime-fix-plan.md) |
| 过程对抗 | [Kimi 三轮](../reviews/2026-11-15-kimicode-review-ops-concept-code-root-runtime-fix.md)（≠ R2-F） |
| Codex 终审 | [Codex R2-F](../reviews/2026-11-15-codex-review-ops-concept-code-root-runtime-fix.md)（#3＝PASS → R2-F 闭合；仍≠ R4） |

## 交互合同豁免

- 原因：本条仅修复 Ops MCP 概念工具代码根装配与错误收敛，不改变用户可见 WebUI 表面
- 不改变：无新路由、无导航、无浏览器人审页、无人审浏览器 API

## 闭口层级

- 层级：功能合同
- 本条承诺：SC-01–SC-09
- 本条出口：SC-01–SC-09（含 vitest、容器拆卷受理、错误信封／审计、commit 前预加载与结算语义、UAT 复测）
- 不在本条出口：改写 P1-11 已收口授权／审计／人审写语义；改 KTX 源码；本版 WebUI「概念权威」页；把数据卷当作代码安装根播种 `scripts/`；客户现场 Ops 概念运维交付包
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| 术语 | 含义 |
|---|---|
| **代码根（code root）** | Lucy 安装树中含 `scripts/concepts/*.mjs` 且其 `import "yaml"` 可解析到安装树 `node_modules` 的根（容器典型＝`/app`） |
| **项目根（project root）** | Proxy 可信 `KTX_PROJECT_ROOT`（含 `ktx.yaml`；容器典型＝`/data/lucy`） |
| **内容根（content root）** | 相对项目根解析的业务内容目录（典型＝`<projectRoot>/config` 或 `LUCY_CONTENT_ROOT`） |
| **`ops_concept_runtime_unavailable`** | 本条稳定机器码：概念核心／默认 whitelist 模块加载或解析失败（`cause` 可带原始 errno 供诊断） |

不新增用户可见 WebUI 文案。沿用父 Spec：概念运维工具／`lucy_ops_concept_*`／`allow.ops`。

## 1. 问题（实测）

| 项 | 内容 |
|---|---|
| 现象 | 临时 `allow.ops` Agent 的 `tools/list` 可见 `lucy_ops_concept_*`；`list`／`summary` → HTTP 502 `Upstream unavailable`；`scan` → `isError`＋`ERR_MODULE_NOT_FOUND` 点名 `/data/lucy/scripts/concepts/scan.mjs` |
| 根因 | `concepts-read.ts`／`concepts-adapter.ts` 用 `path.join(projectRoot, "scripts/concepts/…")` 动态 `import`；容器内 **项目根＝数据卷**，**代码与 `node_modules` 在 `/app`**。两独立阻塞：① 卷上无文件；② 即便拷贝进卷，裸 `import "yaml"` 仍无法从 `/data/lucy` 向上解析到 `/app/node_modules` |
| 502 机制 | 读路径 `invokeOpsTool` → `invokeConceptReadTool` **无 try/catch**，异常在 `recordRequestAudit` 之前上抛，mcp-proxy 顶层抹成 `Upstream unavailable` 且 **无 access_log 行**；写路径有 catch，故 scan 有 isError＋审计 |
| 旁证 | 容器内 `import('/app/scripts/concepts/store.mjs')` **成功**；对真实内容根的纯计算 list 空库／scan preview 语义成立（UAT 探针，已清理） |
| 测试债 | vitest `ops-concepts` 把仓库 `scripts/concepts` **拷进临时 projectRoot**，掩盖部署态拆卷；另有 whitelist 与直接 `pathToFileURL` import 硬编码 `path.join(projectRoot, "scripts/concepts/…")`（共 10 处，见 SC-07） |
| 附带 | 读路径失败未写 `access_log` 且被抹成通用 502，排障不可见 |

> **定性**：P1-11（2026-11-09）实现时引入的部署态装配缺陷；**不是** UAT 引入，也不是老客户问数路径回归。

## 2. 决策

| ID | 裁定 |
|---|---|
| D1 | **拆根**：动态加载 `scripts/concepts/*.mjs` 与默认 `seed-whitelist.yaml` **只**从 **代码根**解析；**禁止**再以 `projectRoot` 作为这些模块的文件系统锚点 |
| D2 | **项目根／内容根不变**：`resolveOpsConceptContentRoot(projectRoot)`、concepts 围栏目录、恢复围栏文件、ops 计划／审计仍信 Proxy `projectRoot`＋D12；请求仍禁止覆盖根（父 Spec SC-17） |
| D3 | **代码根解析**：从 ops 模块 `import.meta.url` **祖先目录逐级**查找含 `scripts/concepts/store.mjs` 的安装根（vitest→仓库根；容器→`/app`）。**禁止**以 `process.cwd()` 作为代码根依据。可选显式 env（若引入须文档化；**默认不依赖**；且不得指向数据卷） |
| D4 | **禁止**以「把 `scripts/` 播种进数据卷／template」作为本条正式修复；禁止依赖数据卷 `node_modules` symlink |
| D5 | **失败可观测（读写同码）**：模块缺失／动态 import／默认 whitelist 读取失败时，读写路径统一返回机器码 **`ops_concept_runtime_unavailable`**（`cause` 可含原始 errno 文本，**不得**把 Node errno 当作对外稳定顶层 code）。**不得**冒成无细节的 502 Upstream unavailable。须写入 `access_log`。**不变量**：`invokeOpsTool` 对概念工具调用 **不得向外抛异常**——读分支 try/catch **覆盖整个读分支**（含 actor／DB 前置）；写分支中 `getOpsDatabase`／`loadPlanRow`／`enforceOwnerOnly` 等 try 外前置点须移入既有写 catch 或各自收敛为信封。**判别器**：`resolveConceptCodeRoot`／动态 import／默认 whitelist 失败统一抛（或返回）带 code＝`ops_concept_runtime_unavailable` 的可控错误（如 `OpsConceptError`）；`ops-tools` catch **透传**该 `err.code`；无 code → `ops_tool_failed`；不得靠 message 字符串匹配 |
| D6 | **测试**：至少一条 vitest：**projectRoot 无 `scripts/`**，仅靠 D3 解析到仓库代码根 → list（及 scan dry_run／preview）业务可受理；保留授权负例。禁止再以「cp 进 projectRoot」或「cwd 指向 scripts」作为唯一绿路径。**`ops-concepts.test.ts` 内不得再留任何 `path.join(projectRoot, "scripts/concepts/…")` 锚点**（含直接 `pathToFileURL` import 与 whitelist） |
| D7 | **复测**：本机 demo **不**手工补 `/data/lucy/scripts`；修复进容器后 health `gitSha` **必须等于**修复提交，且 **`gitDirty` 必须为 false**（脏树须重构建干净 stamp；**禁止**脏树跑次／书面确认放行），否则 STOP 不算跑次；然后 `UAT-OPS-CONCEPT-02` 须 PASS；01／03 回归 PASS |
| D8 | 不改 KTX；不改问数热路径；不扩大本版 WebUI 概念页范围 |
| D9 | `resolveConceptWhitelistPath` 首参语义＝**codeRoot**（实现须改名或注释锁定）；默认路径＝`path.join(codeRoot, "scripts/concepts/seed-whitelist.yaml")`。对齐父 Spec D22「服务器登记白名单」＝随安装树分发，**不回开**父 Spec 决策 |
| D10 | **commit 路径加载与结算（闭合 Codex F-01）**：概念写工具 commit **须在 claim／效果阶段之前**完成所需模块与默认 whitelist 的预加载。预加载失败 → **不得 claim**；顶层返回 `ops_concept_runtime_unavailable` 信封并记审计。若 claim 后仍发生加载类失败（防回归），**不得**用顶层 runtime 码短路父合同 D19／D21 的 rollback／recovery 结算；须走既有组结算，并在结果 `detail`／诊断中保留 `ops_concept_runtime_unavailable`（及 cause）。**禁止**让 `ops-batch.outcomeOfError` 吞掉可控加载码后只剩无因业务摘要 |

## 3. 核心流程（伪代码）

```
function resolveConceptCodeRoot(fromModuleUrl):
  walk ancestors until scripts/concepts/store.mjs exists
  fail → OpsConceptError(ops_concept_runtime_unavailable)
  never use process.cwd()

function invokeOpsConceptTool(invocation):
  try:
    if readTool:
      authorize(allow.ops)
      return list|show|summary via import(codeRoot/scripts/concepts/*.mjs)
    // write path
    ensureDbAndPlanAndOwnerInsideTry()   // 1A
    if dry_run:
      return preview/buildPlan(codeRoot modules)
    // commit
    preloadConceptModules(codeRoot)      // D10 — before claim
    if preload.failed:
      return opsDeny(ops_concept_runtime_unavailable)  // no claim
    return runOpsCommit(...)             // D19/D21 settlement unchanged
  catch err:
    code = err.code ?? ops_tool_failed
    return opsDeny(code)                 // never throw
```

## 4. 验收（实现后）

| ID | 断言 |
|---|---|
| SC-01 | 运行代码中概念核心动态 `import`／默认 whitelist 路径 **不**再 `path.join(projectRoot, "scripts/concepts/…")` 作为唯一／权威锚点；whitelist 解析器首参为 codeRoot |
| SC-02 | 容器 `KTX_PROJECT_ROOT=/data/lucy` 且卷上 **无** `scripts/` 时，`lucy_ops_concept_list` 返回业务成功信封（空库 `concepts=[]` 可接受），**非** 502／顶层 `ERR_MODULE_NOT_FOUND` |
| SC-03 | 同上环境下 `lucy_ops_concept_scan`（`dry_run=true` 或 preview）达到可观察受理（计划／preview／明确空结果），**非**模块缺失失败 |
| SC-04 | 问数 Token（无 `allow.ops`）仍不可见／不可调概念工具（父 Spec SC-05 不回归） |
| SC-05 | 人为破坏代码根加载（或注入失败）时：响应顶层机器码＝`ops_concept_runtime_unavailable`；**不是**仅有 `Proxy error`／`Upstream unavailable`；读写路径同码。非加载类异常不得冒用该码，但仍须信封返回且记审计 |
| SC-06 | 上述失败在 `access_log` 有对应行（`outcome` 反映拒绝／错误）；读路径不得静默跳号 |
| SC-07 | vitest：projectRoot **无** scripts 拷贝、**不**靠 cwd 指向 scripts 时 list（及约定的 scan 路径）仍绿；授权负例仍绿；文件内 **不再存在** 任何 `path.join(projectRoot, "scripts/concepts/…")`（含 whitelist L254／340／510 与直接 import L250／336／402／473／506／662／717）；一律改走 `resolveConceptCodeRoot()`／`repoRoot` |
| SC-08 | 本机 demo：health `gitSha`＝修复提交且 `gitDirty=false` 后复跑 `UAT-OPS-CONCEPT-02` PASS；01／03 PASS；跑次写入测试台；关闭 GAP-UAT-P1-11-RUNTIME |
| SC-09 | **持久计划＋进程重启＋加载失败**：claim 前预加载失败 → 顶层 `ops_concept_runtime_unavailable`、**未 claim**、有审计；若注入 claim 后加载失败 → 仍走 D19／D21 结算，且诊断含该码（不得无因业务摘要） |

## 5. 复测挂钩（测试台）

| Case | 套件 | 目的 |
|---|---|---|
| `UAT-OPS-CONCEPT-02` | OPS-CONCEPTS | 关闭本波 FAIL：业务受理 |
| `UAT-OPS-CONCEPT-01` | 同上 | 授权面不回归 |
| `UAT-OPS-CONCEPT-03` | 同上 | 清理与问数 Token 复检 |

用例正文见 [`cases.md`](../qa/uat/suites/ops-concepts/cases.md)。SC-09 以 vitest／探针为主，不强制扩大 UAT commit 范围。

## 6. 非目标

- 不修改 `@kaelio/ktx` 源码
- 不把概念核心迁出 `scripts/concepts/**` 重写成 TS 内联（可选后续优化，非本条必做）
- 不重新打开 P1-10 CLI／WebUI
- **默认不改** `mcp-proxy.ts`（读路径在 `ops-tools` 收敛后即可；若仍冒 502 再单点补）
- 本 Spec／Plan **单独不构成开发授权**

## 7. 变更

| 版本 | 内容 |
|---|---|
| v0.1-draft | 首开：拆根 D1–D8；SC-01–SC-08 |
| v0.2-draft | Kimi R1：D5 单一码＋读写同码＋不抛；D3 禁 cwd；D9 whitelist＝codeRoot |
| v0.3-draft | Kimi R2：整读分支分码；全锚点；gitDirty |
| v0.4-draft | Kimi R3：写分支前置；可控错误码透传；文件地图对齐 |
| v0.5-draft | 委托人 1A／2A／3A／4C；gitDirty 硬门禁 |
| v0.6-draft | Codex R2-F #1 BLOCK：D10／SC-09；闭口层级／术语／核心流程；镜像索引 |
| v0.7-draft | Codex R2-F #2 BLOCK：交互合同豁免＋浏览器验证不适用；状态句全镜同句 |
| v0.7 | Codex R2-F #3＝PASS；R4 开发授权（2026-11-15）；实现中 |
