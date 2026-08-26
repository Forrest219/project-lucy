# Lucy Agent Chat A3 Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变 Lucy 默认 headless / 客户交付路径的前提下，将 Agent Chat A3 收敛为可复现、可审计、默认安全的单租户验证附包。

**Architecture:** Lucy 与 A3 采用物理隔离和运行旁路双重隔离：Lucy 默认镜像、源码包、发布硬门禁不携带 A3 密钥、状态或悬空入口；A3 作为可选旁路连接已部署 Lucy MCP。M0 收紧为一个 Hermes profile、一个 Lucy Agent token、一个 Open WebUI 验证账号和串行问题验证；通过结论必须由 Lucy Admin 会话下的两段式 `turnId` / `accessLogs` 证据链支撑。

**Tech Stack:** Docker / Docker Compose、Open WebUI、Hermes API Server、Lucy MCP Proxy、Node.js 22、现有 JSON smoke evidence、Markdown Spec / Runbook。

---

## 0. 文档状态与执行约束

- 状态：**Accepted with review amendments**（审阅反对意见 + 二次有条件批准已纳入）。
- Wave 0（本文修订）已批准；Wave 1+ 实现按本计划执行（与 `a3_plan_corrections` 冻结项一致）。
- A3 始终是可选验证附包，不进入 `smoke:p0:headless-config`、`e2e:sow-trust-standard` 或客户默认 source bundle 的可运行入口。
- Lucy 交付隔离（`smoke:p0:delivery-isolation`）是 **Lucy 硬门禁**，与 A3 是否启用无关。
- 若任一优化方案与“Lucy 可独立交付”冲突，直接放弃该 A3 能力，不以修改 Lucy 默认契约换取 Chat 可用性。
- **本波次不**生成独立 `lucy-agent-chat-a3-bundle.tar.gz`（packaging backlog）；先清客户包悬空入口。

## 1. 两条不可妥协底线

1. **Lucy 零干扰、可独立交付**
   - 不启动、不下载、不配置 A3 时，Lucy 的构建、部署、运行、升级、发布包和硬门禁保持完整可用。
   - A3 的密钥、会话、镜像不得进入 Lucy 默认镜像；客户包不得出现悬空 A3 命令或失效相对链接。

2. **Agent 仅在 Lucy 之上做单租户验证**
   - 数据能力只通过一个只读 Lucy Agent token 调用已部署 Lucy MCP。
   - M0：单一 Chat 验证账号、串行提问；不验证多用户权限隔离。
   - Chat、Hermes 或 LLM 不能绕过 Lucy ACL、audit 和 trace。

## 2. 问题基线

| ID | 严重级别 | 问题 | 当前证据 | 底线影响 |
|---|---|---|---|---|
| A3-01 | P0 | Runbook 生成的 `agent-chat/.env`、Hermes home 未被根 `.dockerignore` 排除，`Dockerfile` 的 `COPY . .` 可将 L2/L3/LLM 密钥和运行态打入 Lucy 镜像 | `docs/runbook-lucy-agent-chat-a3.md`；`.dockerignore`；`Dockerfile` | 直接破坏 Lucy 干净交付并泄漏凭据 |
| A3-02 | P1 | A3 默认端口映射绑定所有宿主网卡；fresh Open WebUI 未受控创建首个管理员 | `docker-compose.agent-chat.yml` | 未授权访问或管理员权 |
| A3-03 | P1 | 多个 Open WebUI 账号共享同一 L3 身份；Lucy turn fallback 按 `userId + tokenHashPrefix`，并发可串单 | design spec；`mcp-proxy.ts` near-neighbor Map | 审计无法证明同一次提问 |
| A3-04 | P1 | “默认关闭持久 memory”未通过 Hermes 显式配置锁定 | `hermes-home.example/config.yaml` | 共享记忆/用户画像漂移 |
| A3-05 | P1 | V-5 只查配置文本，未核验模型实际可调用工具集合 | design / A3 smoke | 高危工具可能仍可用 |
| A3-06 | P1 | Hermes `latest`、Open WebUI `main` | compose | 不可复现 |
| A3-07 | P2 | 客户 source bundle **allow-list 已不含** A3 目录/compose，但根 `package.json` 脚本与客户文档（含 `test-layers-and-release-gates.md`、`deployment-docker.md`）仍引用缺失的 A3 入口 | `release-artifacts.mjs` REQUIRED_DOCS；`package.json`；客户文档 | 默认交付包不自洽（悬空入口） |
| A3-08 | P2 | V-2 接受“流式或最终”，V-3 只要求时间附近任一调用 | design V-2/V-3 | 假通过 |
| A3-09 | P2 | Spec 与 compose 对 `API_SERVER_HOST` 绑定描述不一致 | design / compose | Open WebUI 可能连不上 Hermes |
| A3-10 | P2 | 停止保留 volume/home；仅轮换 L3 不清验证数据 | Runbook | 数据驻留与复用 |
| A3-11 | P2 | 远程 MCP TLS、LLM 出境与数据分级未定义 | design | Bearer/业务数据外发风险 |

## 3. 目标架构与边界

```text
Lucy 默认交付（独立）
  ├─ Lucy image（无 A3 路径/密钥）
  ├─ Lucy customer source bundle（无悬空 A3 入口）
  ├─ headless / SOW gates + smoke:p0:delivery-isolation
  └─ 仓库根可保留 A3 开发脚本（不进客户包 staging）

A3 可选旁路（本波次不打独立 tar）
  ├─ pinned Open WebUI / Hermes（repository:tag@sha256:<64 hex>）
  ├─ compose + templates + Runbook + smoke（仓库内开发用）
  └─ HTTPS/私网 → 已部署 Lucy MCP
       └─ 1 read-only Agent token → Lucy ACL / audit / trace
```

M0 身份模型：

```text
1 Open WebUI validation account
  → 1 API_SERVER_KEY
    → 1 Hermes home/profile
      → 1 read-only LUCY_AGENT_TOKEN
        → 1 Lucy user/role identity
```

另需 **独立的 Lucy Admin 凭据**（用于证据链查询）；**禁止**用 Open WebUI 管理员凭据冒充。

## 4. 架构决策（ADR 摘要）

### ADR-A3-01：Lucy 默认交付与 A3 物理隔离

**状态：** Accepted

**决策：** Lucy 镜像与客户 source bundle 不含 A3 密钥/状态；客户包无悬空 A3 命令或失效链接。仓库根可保留 A3 开发脚本。独立 A3 release tar **本波次不做**（backlog）。

**拒绝方案：** 把 A3 运行文件打进默认客户包；或仅靠可选 A3 smoke 守护 Lucy 镜像隔离。

### ADR-A3-02：M0 单账号、单 profile、单 token、串行提问

**状态：** Accepted

**决策：** M0 仅一个受控 Open WebUI 验证账号；同一时间一个验证问题。多账号推迟 M1。

### ADR-A3-03：默认 loopback + 受控管理员；volume 分场景验收

**状态：** Accepted

**决策：** Open WebUI 默认 `127.0.0.1`；`WEBUI_ADMIN_EMAIL`/`PASSWORD` 仅作 **fresh volume 首次初始化**（DB 无用户时创建），不是持续账号收敛。fresh 与 existing volume 分别验收运行时状态；不合规不得自动 `down -v`。

### ADR-A3-04：模型可调用工具 exact allow-list

**状态：** Accepted

**决策：** 验收对象是模型实际可调用的工具集合（Lucy MCP 数据面），不是 Hermes 全部管理/系统工具。配置仅为输入；运行时探针在 pin 后固化；不可探测 → `blocked`。

### ADR-A3-05：镜像必须 pin 到 tag@digest

**状态：** Accepted

**决策：** `${HERMES_IMAGE:?pinned image required}` / `${OPEN_WEBUI_IMAGE:?pinned image required}`；输入匹配 `repository:tag@sha256:<64 hex>`。Evidence 记录：immutable reference、`docker image inspect` 的 `.Id`、可用时的 `.RepoDigests`。

### ADR-A3-06：两段式 turn/trace 因果链 + Lucy Admin 登录

**状态：** Accepted

**决策：** 每题后缀 `A3_CASE:<uuid>`。经 Lucy Admin 会话：

1. `GET /api/admin/audit/turns?source=reported&q=A3_CASE:<uuid>&limit=2`
2. 必须 `total === 1`
3. 取唯一 `turnId`
4. `GET /api/admin/audit/turns/:turnId`
5. 从 `accessLogs` 验证 ≥1 允许的 `lucy_*` 数据调用

SSE：流式帧 + `completed` + `meaningfulDeltaCount >= 1`。凭据判定见 §5。

### ADR-A3-07：非生产或已批准数据/模型链路

**状态：** Accepted

**决策：** 默认脱敏/合成/专用验证数据；真实客户数据须记录 Provider、区域、保留策略与批准人；远程 Lucy MCP 须 HTTPS（loopback / host.docker.internal / 隔离 bridge 可用 http）。

## 5. 核心流程（伪代码）

```text
function validateA3(case):
  assert lucyDeliveryIsolationPasses()  # Lucy hard gate; A3 checkout may be absent

  assert a3.imagesMatch("repository:tag@sha256:<64hex>")
  assert a3.openWebui.bindHost == "127.0.0.1" OR approvedHttpsIngress()
  assertMemoryOffAndCallableToolsExactAllowList()  # or blocked if probe unavailable

  # volume: fresh → admin created, signup off, userCount==1
  # volume: existing → read runtime state (not env alone); non-compliant → fail/blocked; never auto down -v

  if lucyUnreachable: return blocked
  if missingDeclaredLucyAdminCredentials: return blocked
  # never reuse Open WebUI admin credentials as Lucy admin
  session = lucyAdminLogin(declaredCredentials)
  if loginFailed or later 401/403: return fail

  validationCaseId = "A3_CASE:" + uuid()
  response = askThroughOpenWebUI(case.question + " " + validationCaseId, stream=true)
  assert sseFramingObserved && response.completed && meaningfulDeltaCount >= 1

  list = GET /api/admin/audit/turns?source=reported&q=<validationCaseId>&limit=2
  assert list.total == 1
  detail = GET /api/admin/audit/turns/:turnId
  assert detail.accessLogs.any(allowed lucy_* data tool)
  assert detail.accessLogs.none(forbidden tools)

  writeEvidence({ validationCaseId, stream, lucy, runtime: { hermesImage, openWebuiImage, effectiveCallableTools }, status })
```

失败/阻塞：

1. Lucy 隔离失败 → `fail`，停止 A3。
2. 外部依赖不可达 / 缺声明凭据 / 探针端点不稳 → `blocked`。
3. 工具面越界、memory 未关、账号不合规、登录失败、证据链不唯一 → `fail`。

## 6. 分阶段实施

### Phase 0 / Wave 1：Lucy 交付隔离硬门禁

**Files:** `.dockerignore`；`scripts/lucy-delivery-isolation-smoke.mjs` + test；`package.json`；`scripts/p0-smoke.mjs`；`docs/test-layers-and-release-gates.md`

**Local gate:** 锚定 `.dockerignore`；临时 fixture 测 ignore（禁止写真实 `agent-chat/`）；A3 文件不存在时仍 PASS。

**Docker gate:** 至少检查 `project-lucy:p0-smoke` 与 compose 运行镜像 `project-lucy:local`。

**Denylist:** `/app/agent-chat`、`/app/docker-compose.agent-chat.yml`、A3 design/runbook、A3 smoke 脚本。

**接线:** `smoke:p0:delivery-isolation`；由 `smoke:p0` / `smoke:p0:docker` 调用。

### Phase 1-A / Wave 2：清客户包悬空入口（不做独立 tar）

**Files:** `scripts/release-artifacts.mjs` + test；`docs/deployment-docker.md`；`docs/test-layers-and-release-gates.md`

- **仅** staging 内根 `package.json` 剥离 `smoke:agent-chat:a3*`。
- **不改**仓库根 `package.json` 的 A3 开发脚本；测试断言根文件未被改写。
- 客户文档去掉失效 A3 相对路径与「请运行 smoke:agent-chat:a3」入口。

### Phase 1-B / Wave 3：pin、loopback、memory、volume 验收

**Files:** `docker-compose.agent-chat.yml`；`agent-chat/.env.example`；`hermes-home.example/config.yaml`；Runbook；A3 smoke

见 ADR-A3-03/04/05。

### Phase 2 / Wave 4：单账号规范 + 证据链

**Files:** design、Runbook、A3 smoke、`docs/qa/suite-agent-mcp.md`

见 ADR-A3-02/06 与 §5 伪代码。

### Phase 3 / Wave 5：TLS、数据分级、Pause vs Destroy、门禁矩阵

**Files:** design、Runbook、`.env.example`、A3 smoke、test-layers、project-overview

| Gate | 类型 | 影响 Lucy 默认发布 |
|---|---|---|
| Lucy delivery isolation | 硬门禁 | 是 |
| 客户包无悬空 A3 入口 | release 测试 | 是（包自洽） |
| A3 packaging 独立 tar | backlog | 否 |
| A3 runtime / evidence | 可选 smoke | 否 |
| Headless / SOW | 既有 | 不引入 A3 |

## 7. 优先级与退出条件

| 波次 | 内容 | 退出条件 |
|---|---|---|
| Wave 1 | 隔离硬门禁 | 双镜像 denylist；无 A3 checkout 仍 PASS |
| Wave 2 | 悬空入口 | staging 无 A3 scripts；根 package.json 不变；客户文档自洽 |
| Wave 3 | pin + volume | immutable ref 格式；fresh/existing 验收；memory off；callable tools 或 blocked |
| Wave 4 | 证据链 | Admin 登录 + 两段式 + SSE≥1 |
| Wave 5 | 生命周期/文档 | Pause≠Destroy；TLS/数据分级可审计 |

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| Hermes/Open WebUI 升级破坏探针 | 钉死 digest；A3 `blocked`；Lucy 不改契约 |
| begin_question 未调用 | evidence `fail`/`blocked`；不强制改 Lucy |
| existing volume 不合规 | 人工 Destroy；不自动 `down -v` |

## 9. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`. No new product terms. Do not describe Agent Chat as Lucy’s answer kernel.

## 10. 参考

- `docs/design-lucy-agent-chat-a3.md`
- `docs/runbook-lucy-agent-chat-a3.md`
- `docs/agent-integration-guide.md`
- `webui/docs/09-lucy-r1-mcp-tool-contract.md`
- `webui/docs/62-trace-evidence-kernel-spec.md`
- `docs/test-layers-and-release-gates.md`
- `scripts/release-artifacts.mjs`
- `.dockerignore` / `Dockerfile`
- Cursor plan: A3 Plan Corrections（审阅修正冻结源）
