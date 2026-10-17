# Lucy Enterprise Security and Real User E2E Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 企业安全整改与真实用户 E2E 实施计划 |
| 文档类型 | Plan |
| 版本 / 日期 | v0.2 / 2026-10-18，Asia/Shanghai（v0.1 初稿；v0.2 补 V-08 与 A0 热修复、测试/demo 冲击面、子提交拆分、R7–R10 阻塞项） |
| 撰写人 | Codex（v0.1）；Claude（v0.2 修订） |
| 委托人 | xingchen |
| 状态 | **已批准（2026-10-18，xingchen）— 按批次实施；T00～T15 代码已实施，本地证据已执行，目标 K8s / 真实客户端验证 BLOCKED（R8/R10）；不构成客户上线授权。四级状态见 Spec §0** |
| 交付提示词 | [Cursor 开发交付提示词](2026-10-18-enterprise-security-cursor-prompts.md) |
| 权威 Spec | [企业安全整改与真实用户 E2E 上线门禁](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) v0.2 |
| 架构决策 | [ADR — 安全账本与上下文对象授权](../access-control/adr-20261018-security-ledger-and-context-acl.md) |
| 输入问题 | V-01～08、D-01～03、G-01～05；评估 [assessment.md v1.1](../../inbox/e2e-security-audit-20261017/assessment.md) |
| 正式验收 | Spec §7 的 32 个场景展开后的全部 required 变体，不能以任务单测通过替代 |
| 工作区基线 | `lucy-v2.0 / 5c1e5cf`，存在他人未提交更改；本次文档产出不认领、不提交这些改动 |
| 输出位置 | `docs/plans/2026-10-18-enterprise-security-and-real-e2e-plan.md` |

> **For implementer:** 使用已安装的 [executing-plans 技能](/Users/zhangxingchen/.agents/skills/executing-plans-0.1.0/SKILL.md)按任务执行与复核；本文件已批准实施（2026-10-18），但不是客户上线授权。

**Goal:** 修复评估中的 P0/P1 安全问题，恢复可解释的 Wiki/Skill 隔离，以当前候选版本的真实用户 E2E 证据阻断不合格客户发布。

**Architecture:** 保持 Lucy 单进程/单副本及现有静态数据权限模型；在 Lucy 公共入口统一认证授权，增加持久安全状态与审计账本，现有审计库作为可重建查询投影。真实管理浏览器、协议攻击与实际产品 Agent 各自采集证据，由统一 verifier 校验并在客户 amd64 K8s 发布依赖中强制执行。

**Tech Stack:** 既有 TypeScript / Fastify / React / better-sqlite3 / Vitest / Playwright / Node 22 / KTX / Helm / Kubernetes；本地 bash 兼容 macOS 3.2。不修改 KTX 源码，不新增队列服务。

## 1. 审阅、范围与交付批次

先审 Spec §10 的 R1～R10；建议默认方案已写全，没有“开工后再决定 ACL 含义/审计失败策略”的隐藏 TODO。用户批准后才执行代码、真实配置迁移、治理事实源更新。实施中若发现架构/权限语义需要超出批准 Spec，先给出具体差异再补审，普通实现选择与修复不逐项追加审批。

| 批次 | 任务 | 交付/检查点 | 交付 Cursor 的前置条件 |
|---|---|---|---|
| A0 热修复 | T00、T0A | V-08 代码执行关闭；客户默认不再 open；停用 Agent 全方法拒绝。可作内部/紧急补丁候选 | Spec/Plan 批准即可开工，不依赖 R1～R10 |
| A 安全止血 | T01～T04 | 持久会话、受控引导与限速、全协议统一准入。仅内部修复候选，不签客户 GO | R3 批准 |
| B 隔离与可问责 | T05～T09 | 对象 ACL、迁移、耐久响应审计、可信归因/隐私、依赖与旧脚本债务关闭 | R1、R2、R5 及 ADR 批准 |
| C 真实验收与上线接线 | T10～T15 | 真实 UI/多产品 Agent/DB/KTX/K8s 全链路、统一 verifier、不可绕过的发布依赖与长期证据 | R4、R7～R10 批准，且 R8 基础设施已交付（T10/T11/T13 可先做，T12/T14 需基础设施） |

依赖主链：`T00 → T0A → T01 → T02/T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13 → T14 → T15`。斜线仅表示实现依赖相近，不授权另建 Agent、多个写者或并行修改同一工作区。T0A 完成后可直接提交审阅，不等待 T01。

建议每任务一个可审阅提交；只加入本任务新增/变更文件，禁止 `git add .` 吸入他人改动。默认不 push、不部署客户环境、不创建/发布镜像或替换真实私有配置；这些动作执行时需有相应明确授权和已通过门禁。本计划描述拟实施步骤，下面新命令/文件均**尚不存在或尚未具备新语义**。

## 2. 公共执行约定

实施从现有合适 checkout/worktree 开始；若需要隔离未提交改动，先明确基于哪份工作区快照，不能默默从默认分支丢掉用户当前修改。本轮文档不新建 worktree。

每个实现任务按以下小步执行，单步以一个改动/命令为单位；测试失败需先确定是需求断言失败而非夹具/依赖损坏：

1. 在列明测试文件增加一个安全/行为反例，运行定向命令确认 RED。
2. 实现最小规则/状态转换，引用 Spec 的固定判定顺序。
3. 重跑该任务定向测试，确认 GREEN；涉及 UI 则加对应真实浏览器场景或明确 contract 类型。
4. 检查 diff、敏感信息、术语/API/selector 文档，并记录证据与尚未满足项。
5. 建议独立提交，再进入下一任务；不以该提交测试通过宣称客户 E2E 已完成。

**Cursor 会话粒度（v0.2）：** 一个 Cursor Agent 会话只执行一个“子提交”（本 Plan 中标为 `Txx-n` 的条目；未拆分的任务即一个子提交）。会话开始时先读本 Plan 对应条目、权威 Spec 相关章节与 `docs/governance/DEVELOPMENT.md`；结束时输出：改动文件清单、RED→GREEN 的命令与结果、未满足项。遇到以下情况立即停止并回报，不自行扩展：需要改变 Spec 已定的权限/审计语义；需要真实凭据、私有配置或外部基础设施；定向测试以外出现无法解释的大面积失败。

公共验证：源码本地与 CI 使用 Node 22；切换版本后按仓库要求重建本地 native addon。输出落 `inbox/e2e/<runId>/`，不能把旧 `inbox/p1-*` 固定文件当本轮成功凭证。所有需要真实凭据/客户端的步骤缺失即 BLOCKED，不填造值。

## 3. 任务清单

### T00 · 冻结批准范围、基线与回归目录

**优先级/依赖：** P0 开工前；依赖用户审阅批准 Spec/Plan。

**文件：**
- 新建 `docs/qa/enterprise-security-real-e2e-acceptance.md`（Spec 场景到实际执行文件/断言的映射，不复制授权正文）。
- 审阅 `docs/governance/DEVELOPMENT.md`、`docs/access-control/adr-post-p15-roadmap-freeze.md`、`webui/docs/00-product-terminology-standard.md`。
- 临时证据 `inbox/e2e/<runId>/baseline.json`。

**步骤：**
1. 保存 HEAD、dirty 文件名/摘要、Node/架构、关键文件 hash。重读与当前改动有关的所有 AGENTS。
2. 将旧评估复现迁为正式测试的候选清单，重新确认 V-01/02/03/04/06/08 仍存在（V-08 用 `inbox/xv-20261018/gm-rce-probe.ts`）；如已由他人修复，记录证据、复用结果，不重复改实现。
3a. 新建 `docs/qa/security-findings.yaml`（Spec §8.3a 格式），按评估 v1.1 登记 V-01～V-08、D-01～D-02、G-01～G-05 及依赖条目，初始全部 `open`。后续每个任务关闭对应条目时同提交更新 `fixedIn` / `verifiedBy`。
3. 登记 Spec 的 32 个场景、协议/身份/引擎/客户端变体及必须覆盖的分支；标明旧 BY-01～19、Spec 151/161/162/172/173 用例复用位置。
4. 锁定两个以上 required 产品及真实执行方式；默认按 R4 Codex+Cursor。不把两份 Hermes profile 计成两个产品。

**验证：** `git status --short`、`node --version`、`npm --prefix webui run e2e:selector-contract`；已知 33 项漂移记入 T09，而非改为警告。验收目录不允许出现未分配执行器的 required 场景。

### T0A · A0 热修复：frontmatter 代码执行、默认开放、停用 Agent 入口

**优先级/依赖：** P0；T00。不依赖 T01，不新建安全库。拆为三个子提交，可分别审阅。

#### T0A-1 · V-08 仅允许 YAML frontmatter

**文件：**
- 新建 `webui/server/markdown-frontmatter.ts`：导出 `parseMarkdownFrontmatter(text): { data; content }` 与 `stringifyMarkdownFrontmatter(content, data)`；后者可继续委托 `gray-matter` 的 `stringify`（YAML 引擎，现 `wiki.ts:374` 的唯一用法）。
- 修改 `webui/server/wiki.ts`：8 处 `matter(...)` 全部替换为新入口；`import matter from "gray-matter"` 只允许出现在新入口文件。
- 修改 `webui/server/index.ts`：把 `FRONTMATTER_ENGINE_FORBIDDEN` 映射为 400 `WIKI_FRONTMATTER_UNSUPPORTED`（上传/保存）与 422（读取磁盘已有非法文件）。
- 修改 `scripts/release/security-baseline.mjs`：新增检查，`webui/server/**/*.ts` 中出现 `from "gray-matter"` 且文件不是 `markdown-frontmatter.ts` 即 `fail`。
- 新建 `webui/server/__tests__/frontmatter-safety.test.ts`；`webui/docs/03-api-spec.md` 登记新错误码；术语标准登记“文档属性”用户文案（如尚无）。

**步骤：**
1. RED：用 `buildServer()` + 进程内探针（`globalThis.__LUCY_FM_PROBE`）对 `POST /api/wiki/upload/preview`、`/api/wiki/upload/commit`、`PUT /api/wiki/:key`（dryRun 与非 dryRun）、`GET /api/wiki/:key`（磁盘预置文件）、版本恢复提交载荷 `---js`、`---javascript`、`---JS`、`--- js`、`---json`；断言探针被设置（复现）。
2. 实现入口：解析首行 `---` 后的语言标记，`trim().toLowerCase()` 为空或 `yaml` 才继续，用 `yaml` 包 `parse` 解析，其余抛错；正文切分逻辑与现有 `wiki-acl.ts` `parseFrontmatter` 保持一致的 `---` 边界规则。
3. GREEN：同一测试改断言为探针未被设置、状态码 400/422、目标文件未写入；合法 YAML 上传/读取对照成功，现有 Wiki 测试不回归。
4. 检查 `examples/*/project-template/wiki/**` 与 `customer-config.example/config/wiki/**` 均为合法 YAML frontmatter（预计全部通过；如有失败按内容修正，不放宽解析）。

**验证：**
```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/frontmatter-safety.test.ts server/__tests__/wiki.test.ts
cd ..
npm run security:baseline
webui/node_modules/.bin/tsx inbox/xv-20261018/gm-rce-probe.ts   # 期望三个 case 的 evaluated 均为 null
```

#### T0A-2 · V-01 最小版：部署模式与默认非开放

**文件：**
- 修改 `webui/server/auth/admins-store.ts`（`resolveAuthMode`）、`webui/server/auth/routes.ts`（bootstrap 前置检查）。
- 新建 `webui/server/auth/deployment-mode.ts`：`resolveDeploymentMode()` 读取 `LUCY_DEPLOYMENT_MODE`，缺省 `customer`，非法值抛错拒绝启动。
- 修改 `webui/test/setup.ts`：未显式设置时默认 `LUCY_DEPLOYMENT_MODE=development`、`LUCY_WEBUI_AUTH=off`，保持现有 40 个依赖开放模式的 server 测试不变；已显式设置 `LUCY_WEBUI_AUTH` 的 5 个 suite 不受影响。
- 修改 `deploy/k8s/helm/lucy/templates/_helpers.tpl`：`lucy.composeEnv` 写死 `LUCY_DEPLOYMENT_MODE=customer`；`templates/deployment.yaml` 挂载 bootstrap Secret（values 新增 `bootstrap.existingSecret`，缺省为空时 Pod 仍可启动但 bootstrap 返回 503）。
- 修改 `deploy/compose/docker-compose.{demo,postgres-demo,executive-poc,customer-config}.yml` 与 `scripts/upgrade/upgrade-lucy-cli.mjs`（或 `upgrade-lucy.sh`，以 `demo:upgrade` 实际入口为准）：`--fresh` 时生成 `deploy/compose/secrets/webui-bootstrap-token` 并以 compose file secret 挂载；只打印路径。
- 修改 `scripts/runtime/docker-entrypoint.sh` 及测试：customer 模式下检测到 `LUCY_WEBUI_AUTH=off` 立即退出非 0。
- 新建 `webui/server/__tests__/webui-deployment-mode.test.ts`。

**步骤：**
1. RED：customer 模式 + 空 `admins.yaml` + 未设 `LUCY_WEBUI_AUTH` 时，`/api/auth/status` 为 `open`、匿名 `PUT /api/wiki/...` 为 200、匿名 bootstrap 为 200。
2. 实现：customer 模式下 `resolveAuthMode` 不返回 `open`（无管理员 → `bootstrap`）；`off` 仅在 development 生效；bootstrap 在 customer 模式下要求 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE` 指向可读非空文件且请求头 `X-Lucy-Bootstrap-Token` 用 `timingSafeEqual` 匹配，否则 503 `BOOTSTRAP_NOT_PROVISIONED` / 401。Login 页面增加引导密钥输入框（仅内存持有）。
3. GREEN：上述匿名请求变为 401/503；development 模式行为与现状一致；`node --test scripts/runtime/docker-entrypoint.test.mjs` 覆盖 customer+off 拒启动（bash 3.2 兼容）。
4. 本地 demo 冒烟：`npm run demo:upgrade -- --fresh` 后用生成的密钥完成 bootstrap；再执行一次不带 `--fresh` 的 `npm run demo:upgrade`，确认管理员保留、无需再次引导。

**验证：**
```bash
cd webui && npx vitest run --maxWorkers=1 server/__tests__/webui-deployment-mode.test.ts server/__tests__/webui-admin-auth.test.ts && npm test && cd ..
node --test scripts/runtime/docker-entrypoint.test.mjs
npm run gate:k8s-static
```
完整限速、bootstrap 互斥与持久引导状态留给 T02。

#### T0A-3 · V-02 最小版：停用 Agent 全方法拒绝

**文件：** 修改 `webui/server/proxy/mcp-proxy.ts`（`handlePost` 及 GET/DELETE 处理中 `identifyRequestDetailed` 之后）；新建 `webui/server/__tests__/mcp-disabled-agent-all-methods.test.ts`。

**步骤：**
1. RED：同一 `enabled:false` Agent 的有效 Token，`initialize`、`tools/list`、`resources/list`、`resources/read`、`prompts/list`、`prompts/get`、`tools/call` 中至少 resources/prompts 返回 Skill canary 或列表。
2. 实现：身份识别成功后读取当前 access 配置（复用 `authorizeAndRewrite` 使用的同一配置来源，不另建缓存），`enabled === false` 时返回 HTTP 403 + JSON-RPC `{code:-32003,message:"Access denied: agent_disabled"}`，并写 denied 审计；不转发上游。
3. GREEN：全部方法拒绝、响应无 canary；启用 Agent 对照正常；现有 `mcp-proxy-*.test.ts` 不回归。

**验证：** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/mcp-disabled-agent-all-methods.test.ts server/__tests__/mcp-proxy-skills.test.ts server/__tests__/mcp-proxy-acl.test.ts server/__tests__/mcp-proxy-instructions.test.ts`。

**T0A 退出：** 三个子提交各自 GREEN；`security-findings.yaml` 中 V-08 标 `fixed`，V-01/V-02 保持 `open` 并注明“A0 最小修复已合入，完整修复见 T02/T04”。

### T01 · 持久安全状态与账本基础

**优先级/依赖：** P0/P1 基础；T00。

**文件：**
- 新建 `webui/server/security/store.ts`、`schema.ts`、`types.ts`、`recovery.ts`。
- 新建 `webui/server/__tests__/security-store.test.ts`、`security-recovery.test.ts`。
- 修改 `webui/server/index.ts`、`webui/server/fs-safe.ts`（保护内部状态路径）、`webui/docs/04-data-model.md`。

**步骤：**
1. RED：重启后会话吊销/epoch/引导状态保留；schema 重跑不损坏；磁盘只读/数据库锁失败不返回成功；安全库/WAL/SHM 权限正确。
2. 建立 Spec §2 的表、事务和 append-only API；显式 `synchronous=FULL`。安全库失败返回结构化 unavailable，不创建空 fallback 数据。
3. 加 pending operation 恢复：prepare 后崩溃、文件写后未 commit、投影后游标未提交；不自动恢复更宽权限，不把 pending 算成功。
4. 禁止把安全库当资产导出或通用 SQLite/ops 数据源；保留正常 `.ktx-ui` 所需功能，避免一刀切破坏历史/导出模块。

**验证：**
```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/security-store.test.ts server/__tests__/security-recovery.test.ts server/__tests__/fs-safe.test.ts server/__tests__/fs-safe.config-root.test.ts
```
**退出：** 持久状态真实落盘、故障 fail-closed、旧审计库兼容；不宣称投影与真实用户 E2E 已完成。

### T02 · 默认强制认证、受控 bootstrap 与限速

**优先级/依赖：** P0；T01、T0A-2（部署模式与引导密钥已存在，本任务补持久引导状态、互斥、限速和 Cookie 安全）。

**文件：**
- 修改 `webui/server/auth/admins-store.ts`、`guard.ts`、`routes.ts`、`session.ts`（Cookie `Secure` 按部署模式默认开启）、`webui/server/web-security.ts`、`webui/src/pages/Login.tsx`。
- 新建 `webui/server/auth/bootstrap.ts`、`rate-limit.ts`。
- 修改/新增 `webui/server/__tests__/webui-admin-auth.test.ts`、`webui-bootstrap-concurrency.test.ts`、`webui-auth-rate-limit.test.ts`。
- 修改 `scripts/runtime/docker-entrypoint.sh` 及其测试，`deploy/k8s/helm/lucy/values.yaml`、`templates/_helpers.tpl`、`templates/deployment.yaml`。

**步骤：**
1. RED：缺失/空/损坏管理员配置时匿名 PUT Wiki 不能成功；未知管理员 role 不能成为 owner；客户 off 必须拒启动。
2. 用表驱动实现 `customer/development` 与 auth mode；公共 health/help/brand 只保留最小非敏感恢复信息。
3. RED：错/无/已消费引导密钥、两个并发请求、hash 密码后抢写、引导崩溃恢复。实现互斥范围覆盖 fresh read→验证→落盘→消费→commit。
4. 实现持久有界限速与统一认证失败响应，测试 TTL/桶上限/重启；可信代理地址检查不接受任意 forwarded IP。
5. Login UI 的密钥只在内存使用；客户 Secret 注入不入 ConfigMap/argv/log；同一值不能通过 extraEnvFrom 覆盖强制 customer 安全约束。
6. Cookie：customer 模式默认带 `Secure`；`LUCY_WEBUI_COOKIE_SECURE=0` 在 customer 模式下启动预检失败（Spec §3.1 第 8 条测试 profile 例外除外）；Chart 透传逻辑与 `helm template` 断言加入 `gate:k8s-static`。
7. 启动预检：Pod 内 `LUCY_DEPLOYMENT_MODE` 与 Chart 写死值不一致（例如被 `extraEnvFrom` 覆盖为 development）时退出非 0，并在 `deploy/k8s/K8S_CONTRACT.md` 记录。

**验证：**
```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/webui-admin-auth.test.ts server/__tests__/webui-bootstrap-concurrency.test.ts server/__tests__/webui-auth-rate-limit.test.ts server/__tests__/web-security.test.ts
cd ..
node --test scripts/runtime/docker-entrypoint.test.mjs
npm run gate:k8s-static
```
**退出：** SEC-01/02/05 的协议测试通过，新增 UI 分支在 T11 真实浏览器复验；不得因浏览器暂无凭据保留默认开放。

### T03 · v2 会话、退出/密码重置与恢复边界

**优先级/依赖：** P1；T01/T02。

**文件：**
- 修改 `webui/server/auth/session.ts`、`admins-store.ts`、`routes.ts`、`guard.ts`。
- 新建 `webui/server/auth/account-state.ts`。
- 新建 `webui/server/__tests__/webui-session-revocation.test.ts`、`webui-account-incarnation.test.ts`；补现有 `webui-admin-auth.test.ts`。
- 修改 `webui/docs/03-api-spec.md`、`04-data-model.md`、`docs/access-control/design-webui-admin-auth.md`。

**步骤：**
1. RED：已退出 Cookie 重放、重置密码后旧 Cookie、停用后快速请求、删除重建同 id、从旧配置/安全库还原后的重放。
2. 增加不可变 account_uid、持久 jti/epoch 与 v2 签名，拒绝 v1；弱旧密钥按迁移计划轮换。
3. 顺序严格为先撤销/提升 epoch，再完成配置写；logout 仅在耐久吊销后成功，Cookie 清除不是服务端吊销的替代。
4. 实现 idle/absolute 期限与 `no-store`，全部敏感请求不依赖展示缓存；安全库异常返回 503。
5. 编写恢复 runbook：受控停服、最新吊销事实源、密钥/实例代次轮换与重新登录；不能直接清管理员文件对外认领。

**关键回归示例（由实现者按测试 helper 落地）：**
```ts
// expected behavior, not a pure helper mirror
const cookie = await loginAsOwner();
await httpLogout(cookie);
expect((await protectedAdminRead(cookie)).status).toBe(401);
await restartLucy();
expect((await protectedAdminRead(cookie)).status).toBe(401);
```
**验证：** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/webui-session-revocation.test.ts server/__tests__/webui-account-incarnation.test.ts server/__tests__/webui-admin-auth.test.ts`。

### T04 · MCP 公共准入、会话绑定与撤销屏障

**优先级/依赖：** P1；T01～T03。

**文件：**
- 修改 `webui/server/proxy/identity.ts`、`mcp-proxy.ts`、`upstream-session.ts`、`acl.ts`、`turn-correlation.ts`。
- 新建 `webui/server/proxy/admission.ts`、`authorization-barrier.ts`。
- 新建 `webui/server/__tests__/mcp-admission-all-methods.test.ts`、`mcp-session-ownership.test.ts`、`mcp-revocation-stream.test.ts`；补 `mcp-proxy-skills.test.ts`、`mcp-proxy-upstream-session.test.ts`、`mcp-proxy-acl.test.ts`。
- 实施后同步 `webui/docs/07-mcp-auth-proxy-spec.md`、`171-governed-skill-system-and-context-transpass-spec.md`。

**子提交拆分（v0.2）：** T04-1 统一 admission（步骤 1–2，吸收 T0A-3 的入口检查为正式 `admission.ts`）；T04-2 会话归属绑定（步骤 3）；T04-3 撤销发送屏障与 passthrough 关闭（步骤 4–5）。每个子提交只跑与其相关的验证命令子集，T04-3 完成后跑全量命令。

**步骤：**
1. RED：同一 disabled Token 对 tools/read 拒绝而 resources/prompts 读出 canary；补 GET/DELETE/通知/initialize/list 组合。
2. 提取统一 admission；Bearer/吊销/到期/启用/角色/许可/Origin 在所有合法路径一致执行。未知路径/方法、batch/非法 envelope 不透传。合法 legacy direct-allow 的既有数据面不新增角色门槛，上下文按 T05 强制正式角色，补两者的兼容对照。
3. session store 从 userId 键迁为 Token+Agent+downstreamSession；验证持有别人的 sessionId 不取其状态，丢 header 的兼容客户端仍可重连。
4. 将 Token/Agent/角色收窄操作接入发送屏障：先持久收窄，取消在途内容、流与缓存，再成功响应；每内容发送点重新验证版本。
5. 客户禁用旧 skills passthrough；禁止以 KTX 直连/stdio 为“兼容修复”；保留 TokenScope≡TRUE。

**验证：**
```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/mcp-admission-all-methods.test.ts server/__tests__/mcp-session-ownership.test.ts server/__tests__/mcp-revocation-stream.test.ts server/__tests__/mcp-proxy-skills.test.ts server/__tests__/mcp-proxy-upstream-session.test.ts server/__tests__/mcp-proxy-acl.test.ts server/__tests__/ac-security-eval.test.ts
```
**退出：** SEC-07/08/21 协议负例与 allow 控制通过，非授权上游执行为 0。真实客户端与发送后不能撤回的边界在 T12 验证。

### T05 · 统一 Wiki/Skill ACL 与缓存裁决

**优先级/依赖：** P1；T04，Spec R1 批准。T05 的默认拒绝与 T06 步骤 6 的模板 ACL 必须在同一 PR 合入，避免中间提交使 demo / POC Wiki 全部不可见。

**文件：**
- 新建 `webui/server/proxy/context-acl.ts`、`context-policy.ts`。
- 修改 `webui/server/proxy/skill-acl.ts`、`wiki-acl.ts`、`acl.ts`、`mcp-proxy.ts`、`webui/server/skills/{loader,types,validator}.ts`、`webui/server/admin/roles.ts`。
- 新建 `webui/server/__tests__/context-acl-matrix.test.ts`、`context-channel-parity.test.ts`、`context-policy-invalidation.test.ts`；补 `skill-acl.test.ts`、`mcp-proxy-instructions.test.ts`、`mcp-proxy-skills.test.ts`。

**步骤：**
1. RED：空 ACL/public/global 不放行、跨角色拼权、legacy 无角色、损坏 ACL、草稿/停用、直接已知 URI、仅 discover/仅 read、未知角色。
2. 按 Spec §4 统一 canonical ACL 与同角色闭合。沿用 roles_allowed/allowed_roles，不增加第二套按 Role 对象白名单，不从 sl_refs 推导授权。
3. initialize/search/read/resources/prompts/export 全部复用同一裁决，内部保留精确 deny 原因，外部对不存在/不可见对象同形响应。
4. 定义 contextPolicyVersion、按 action/身份/版本的缓存键与游标；收窄即时失效，不等 KTX reindex；无可证明 ACL 的降级拒绝。Role 删除检查上下文引用并记退役 ID，重建旧 ID 或命中历史未知引用不得意外激活 ACL。
5. 明确表/行权限独立不变，旧 Skill file identity/expected_version 规则保留。

**验证：** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/context-acl-matrix.test.ts server/__tests__/context-channel-parity.test.ts server/__tests__/context-policy-invalidation.test.ts server/__tests__/skill-acl.test.ts server/__tests__/mcp-proxy-skills.test.ts server/__tests__/ac-security-eval.test.ts`。

### T06 · 对象授权 UI、受控迁移与文件安全

**优先级/依赖：** P1；T05。

**文件：**
- 修改 `webui/server/wiki.ts`、`fs-safe.ts`、`admin/skills.ts`、`admin/roles.ts`、`index.ts`、`skills/writer.ts`、`semantic-asset-export.ts`。
- 修改 `webui/src/pages/skills/SkillList.tsx`、`webui/src/pages/WikiEditor.tsx`、`webui/src/components/WikiEditView.tsx`、`webui/src/components/WikiSavePreflight.tsx`、`webui/src/lib/types.ts`、`webui/src/lib/skills.ts`、`webui/src/lib/wiki.ts`；复用现有工作台，不新增影子入口。
- 新建 `scripts/security/migrate-context-acl.mts`、`webui/server/security/context-migration.ts`。
- 新建 `webui/server/__tests__/context-acl-migration.test.ts`、`wiki-acl-concurrency.test.ts`、`context-file-boundary.test.ts`；补既有 Skill file safety / wiki / export 测试。
- 批准后更新 Spec 151/170/171、术语标准 §4.10、`docs/access-control/README.md`、API Spec 和 selector contract。

**步骤：**
1. RED：两管理员同时保存 Wiki ACL 覆盖；batch migration 过期 inventoryDigest/expected_version；并发角色变化；迁移崩溃后错误恢复全开放；symlink/打开前替换读取外部 canary。
2. Wiki 增加 file_version/expected_version（428/409），Skill 保留原并发合同；恢复既有授权控件、* 独立确认和 readonly Role 摘要。
3. 写迁移 `--dry-run` 报告与 owner `--apply --expected-digest` 的 journal；空/损坏 ACL 不自动赋权，旧 public 只能由 owner 显式确认。批准缺少读取数据不算授权。
4. fs-safe 统一拒绝任意层 symlink、编码逃逸和 TOCTOU 替换；不读取真实 secret；export 区分管理与 Agent 身份。
5. 完成迁移/回滚说明，取消 170 当前效力时同步原文，不能只改新 Spec；迁移回滚不能运行旧全开放版本。
6. 模板 ACL（v0.2，必须与 T05 默认拒绝在同一 PR 合入，避免中间态 demo 全部失效）：为 `examples/docker-demo`、`examples/postgres-demo`、`examples/executive-poc` 的 `project-template/wiki/**` 与 `skills/**`，以及 `customer-config.example/config/wiki/**` 共 14 个 Wiki 及全部模板 Skill 写入 `allowed_roles` / `roles_allowed`，角色取自同模板 `webui/config/access.yaml` 实际定义；提交说明列出每个使用 `['*']` 的对象及理由。修改 `scripts/smoke/` 下 `smoke:p0:demo`、`smoke:p0:postgres-demo` 对应脚本，各增加“授权角色可 `wiki_read`、无授权角色得到 `context_not_available`”断言。

**验证：**
```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/context-acl-migration.test.ts server/__tests__/wiki-acl-concurrency.test.ts server/__tests__/context-file-boundary.test.ts server/__tests__/skill-file-management-147.test.ts server/__tests__/wiki.test.ts server/__tests__/api.semantic-asset-export.test.ts
npm run lint:terminology
npm run e2e:selector-contract
npm run smoke:p0:demo   # 需本地 demo 栈；不可用时记 BLOCKED，不跳过
```
迁移命令只在合成 fixture 上先执行；真实客户 apply 属部署授权范围，不能用本计划的批准代替对目标私有配置的确认。

### T07 · 内容释放前耐久审计与幂等投影

**优先级/依赖：** P1；T01/T04～T06，Spec R2 批准。

**文件：**
- 新建 `webui/server/security/ledger.ts`、`projector.ts`、`response-commit.ts`。
- 修改 `webui/server/proxy/{mcp-proxy,audit,audit-write-health}.ts`、`webui/server/admin/{audit,config-audit-write}.ts`、`webui/server/trace/evidence.ts`、`webui/server/index.ts`。
- 新建 `webui/server/__tests__/audit-release-barrier.test.ts`、`audit-projection-recovery.test.ts`；补 `audit-write-health.test.ts`、`proxy-audit.test.ts`、`admin-audit.test.ts`。

**子提交拆分（v0.2）：** T07-1 读取路径 admitted→prepared→发送（步骤 1–2，先覆盖非流式 JSON 响应）；T07-2 SSE 有界缓冲与崩溃恢复（步骤 2 的流式部分与步骤 3）；T07-3 projector 与配置写 intent（步骤 4–5）；T07-4 性能预算验证（见下）。

**步骤：**
1. RED：schema 成功但真实 INSERT 失败，Resources/Prompts/Wiki/Query 仍输出 canary；只断言 health partial 不足。
2. 每个敏感响应执行 admitted→读取/缓冲→版本复核→durable response_prepared→发送；SSE 有界缓冲，失败丢弃敏感内容，超限明确报错。
3. 测试 prepare 成功/headers 前崩溃、发送失败、terminal 丢失，恢复标 interrupted，不伪造 delivered。
4. 实现 canonical event→审计/Trace 投影与目标库事务游标；暂停/恢复/重放不重复计数。投影延迟明确 complete=false；安全库失败不能“best effort 成功”。
5. 配置写 durable intent/committed/failed 与恢复路径；将审计写入健康、投影延迟与核心健康分清，不用 optional projection 延迟掩盖 canonical failure。

**验证：** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/audit-release-barrier.test.ts server/__tests__/audit-projection-recovery.test.ts server/__tests__/audit-write-health.test.ts server/__tests__/proxy-audit.test.ts server/__tests__/admin-audit.test.ts`。
**T07-4 性能验证：** 新建 `webui/scripts/audit-overhead-bench.mts`，在同一机器上对比 T07 前后（以 git stash 或前一提交构建为基线）`tools/call`（上游用本地 stub 固定返回，排除上游耗时）与 `resources/read` 的 p50/p95/p99；并发 16 客户端持续 5 分钟统计 503 与 `SQLITE_BUSY`。结果写入 `inbox/e2e/<runId>/audit-overhead.json`，须满足 Spec §5.1 预算（p95 ≤ 20 ms、p99 ≤ 50 ms 额外延迟，零 BUSY 503）。不达标时按 Spec 优化顺序处理，不放宽 `synchronous=FULL`。

**退出：** 注入数据库锁/只读/写失败/进程崩溃时零未授权敏感输出，并对恢复记录逐条对账；性能预算达标。

### T08 · 真实操作者、认证日志、脱敏与历史清理

**优先级/依赖：** P1，含原 P2 V-05；T07。

**文件：**
- 新建 `webui/server/security/request-actor.ts`、`redaction.ts`。
- 修改 `webui/server/auth/routes.ts`、`webui/server/{index,wiki,semantic-layer,semantic-assets,project,catalog-assets}.ts`、`webui/server/admin/{agents,roles,tokens,skills,audit,config-audit-write}.ts`、`webui/server/proxy/{audit-privacy,request-client-meta}.ts`、`webui/server/eval/suite-import.ts`。
- 修改 `webui/server/audit/query-artifact-{capture,crypto,store}.ts`（只在需要落实默认脱敏合同的位置改动）。
- 新建 `scripts/security/scrub-audit-secrets.mts`、`webui/server/__tests__/audit-actor-propagation.test.ts`、`audit-secret-scrub.test.ts`；补 `audit-privacy.test.ts`、`audit-export-paging.test.ts`。

**子提交拆分（v0.2）：** T08-1 可信 actor 透传（步骤 1–2；已知缺口集中在 `wiki.ts` 4 处、`semantic-layer.ts` 2 处 `auditedWriteFile` 调用未传 actor/requestId/IP，Agent/Token/Role/账户/许可证已用 `actorIdFromRequest`，只需改为 T03 后的可信 actor 类型）；T08-2 写入前脱敏与认证事件（步骤 3，含 `admins.yaml` 整文件 diff 的哈希剔除）；T08-3 历史清理工具与保留维护（步骤 4–5）。

**步骤：**
1. RED：owner/operator 同对象保存均记 local-admin；operator config-audit 读到 scrypt；伪 actor/forwarded 头改变可信归因；正文/过滤值进入日志。
2. 从请求构建 trusted actor，显式传递到每个写服务、后台任务；系统事件用 system actor，禁止真实登录请求静默 fallback local-admin。
3. 写入前 allowlist 脱敏，统一 API/CSV/zip/SQL hot store/测试产物策略；加认证与权限变更事件，导出条数/哈希/关联 ID。
4. 历史清理工具只输出计数/摘要；dryRun→受控备份→清理→维护事件；不得泄漏旧哈希，也不伪造已删除备份的承诺。
5. 验证保留维护不删除 pending/unprojected，用户问询短期原文保留不被本次 180 天事件保留扩大。

**验证：** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/audit-actor-propagation.test.ts server/__tests__/audit-secret-scrub.test.ts server/__tests__/audit-privacy.test.ts server/__tests__/audit-export-paging.test.ts server/__tests__/query-artifact-cold-store.test.ts server/__tests__/request-client-meta.test.ts`。

### T09 · 依赖修复、旧门禁状态、fixture 与 selector 债务

**优先级/依赖：** P1；T08；可提前做只读定位，不提前混入业务变更。

**文件：**
- 修改 `webui/package.json`、`webui/package-lock.json`（仅必要的依赖修复，重新评估 2026-10-17 报告所列 override）。
- 修改 `scripts/gates/p1-release-readiness.mjs` 及其测试，`scripts/smoke/p1-{governance,publish-regression}-smoke.mjs`，`scripts/smoke/p1-agent-e2e.mjs` 及测试，`scripts/smoke/package-sow-trust-evidence.mjs`。
- 修改 `scripts/demo/init-e2e-fixture.sh`、`webui/playwright.config.ts`、`webui/scripts/check-selector-contract.mjs`、`docs/qa/{selector-contract.md,impact-map.json}` 和有实际漂移的 contract specs。

**步骤：**
1. RED：治理 smoke 全 blocked 却 exit0、dry-run 总体 passed、readiness `--list` 输出契约错误、任意 500 被算正确 deny、无服务端 query/Trace 却 100% 覆盖。
2. 旧入口先统一 Spec §8.2 状态；干跑/收集不签 releaseReady；缺 KTX/runtime/客户端不伪 pass。T13 再用独立 verifier 做最终客户判定。
3. 修复 content root/eval paths、Role Set 与新 Wiki ACL 断言；移除 `/Users/forrest` 等机器绑定，不能读取私有配置凑运行环境。
4. 修 selector 真实漂移和正负引用识别、fixture 角色与 manifest 匹配、初始化目标一致性、服务实例核对；不能靠空元素断言/删失败用例制造绿灯。确需开放模式的 contract fixture 显式设置 development+loopback，不能污染真实 E2E 的 customer+auth required 配置。
5. 修受影响生产依赖并核对兼容；不盲从 audit fix 的降级建议。`webui/package.json` `overrides.fast-uri` 当前锁定 3.1.6（提交 `5b31145` 引入，受影响范围 3.0.0–3.1.7），改为已修复版本并确认 Fastify/ajv 路由校验测试通过。再次扫描，high/critical 未处置 0；moderate 逐条在 `docs/qa/security-findings.yaml` 登记可达性与处置，不宣称都是远程漏洞。

**验证：**
```bash
node --test scripts/smoke/p1-agent-e2e.test.mjs scripts/gates/p1-release-readiness.test.mjs
npm --prefix webui run e2e:selector-contract
npm --prefix webui audit --omit=dev --registry=https://registry.npmjs.org
npm --prefix webui run build
```
**退出：** 标准浏览器 contract 入口可运行，已知 Selector/fixture/harness 漂移关闭；不将 contract 通过当作 T11/T12 完成。

### T10 · 正式合成数据、32 场景目录与安全执行器

**优先级/依赖：** P1 门禁基础；T09。

**文件：**
- 新建 `examples/security-e2e/README.md`、`project-template/`、`db/seed.sql`、`gold/compute-gold.mjs`。
- 新建 `scripts/e2e/prepare-environment.mjs`、`run-security.mjs`、`contracts/case-catalog.yaml`、`contracts/release-evidence.schema.json`、`profiles/customer-release.yaml`。
- 新建 `scripts/e2e/__tests__/environment-identity.test.mjs`、`case-catalog.test.mjs`、`security-runner.test.mjs`。
- 新建 `docs/qa/real-e2e-clients.yaml`，补 T00 验收映射。

**步骤：**
1. 写 table-driven catalog 校验：32 ID 齐全、每 required 变体具备 executor/断言/gold/产物，禁止空分母/重复 id/测试后改 required。Spec §7 明列的元数据工具、认证路径/模板、问询预算、172/173 归因、监控窗口、许可/品牌/导出等子场景必须单独编号，不被父场景名掩盖。
2. 构造独立库/两个连接同名 source、分区 canary、只读 DB 账户、脱敏 VIEW 与文档生命周期；按 run seed 生成随机 gold，checker 与 Agent 文件/网络隔离。
3. prepare 校验 image/instance/contentRoot/profileDigest，隔离 run 目录和卷，不接受未知现有服务或真实项目目录；客户 profile 绑定 amd64 K8s。
4. 将 SEC-01～23 转为真实 Lucy/HTTP/SQLite/DB 故障与攻击用例；支持 allow 控制、预期 deny 原因、实际上游执行计数、完整输出泄漏扫描。
5. 故障钩子只存在测试环境控制面，通过隔离部署/权限注入；不得在客户 HTTP API 暴露任意故障注入后门。

**验证：** `node --test scripts/e2e/__tests__/environment-identity.test.mjs scripts/e2e/__tests__/case-catalog.test.mjs scripts/e2e/__tests__/security-runner.test.mjs`；准备合成环境后执行拟新增 `npm run e2e:real:security -- --run <run.json>`。真实 RLS 必须对当前 KTX 真行集与聚合 gold，proven 标志只作能力门控。

### T11 · 真管理浏览器链路、离线 Eval 与审计导出

**优先级/依赖：** P1；T10，§3～5 已实现。

**文件：**
- 新建 `webui/playwright.real.config.ts`。
- 新建 `webui/tests/real-e2e/{management-journey,admin-auth,context-isolation,eval-offline,audit-export}.spec.ts`、`helpers/run-context.ts`、`helpers/secret-capture.ts`。
- 修改 `webui/package.json`，新增明确命名的真实浏览器入口；更新 `docs/qa/suite-user-journey.md`。

**步骤：**
1. RED：把旧空 ACL 放到真服务、UI 保存后 MCP 仍读旧文档、拷配置串实例、签发 Token 后 trace 泄漏、导出审计操作者错误，任一都必须使链路失败。
2. 按 Spec J-01 操作实际 UI：auth required、真实连接/保存/同步/签发，禁止 page.route fulfill API 或 PATH KTX shim；每测试独立资源或串行复用。
3. 密码/Token/引导密钥只由受控 helper 内存传递；签发与配置复制步骤不录制参数 trace、不截敏感状态；对所有保留 artifact 再扫描。关闭录像不等于可以不验证复制配置的实际内容/目标。
4. UI 下载套件→指定角色真实离线跑批→完整导入→趋势/待复核，覆盖 Spec 161 的 complete/hash/runner/role 拒绝；区分离线 query 证据与真实 Agent 证据。
5. 打开真实访问日志/配置审计、筛选并导出双 CSV/zip，按 run/event/policy 对账；补完原 ADM-02～05、ENG-02～07 剧本并与正式执行文件绑定。

**验证：** 拟新增 `npm run e2e:real:management -- --run <run.json> --project chromium`；1440×900，workers=1、retries=0，按真实等待契约而非固定 sleep。此任务不执行移动/窄屏，不用 mock browser 代签。

### T12 · 两个以上实际产品客户端与业务答案验证

**优先级/依赖：** P1；T11 已通过同 run 管理链路，客户端矩阵已批准；R7（Cursor 以 CLI Agent 为 required 路径）、R8 protected runner、R10 模型凭据就绪。任一未就绪时本任务只交付 adapter 与 harness 单测，真实执行状态记 BLOCKED。

**文件：**
- 新建 `scripts/e2e/run-agent-journey.mjs`、`adapters/codex.mjs`、`adapters/cursor.mjs`（及批准矩阵中其他 required adapter）。
- 新建 `scripts/e2e/answer-assertions.mjs`、`collect-server-evidence.mjs`。
- 新建 `scripts/e2e/__tests__/{adapter-contract,answer-assertions,server-evidence-binding}.test.mjs`。
- 新建 `docs/runbooks/real-user-e2e.md`；补 `docs/runbooks/agent-integration-guide.md` 和 QA Agent 分表。

**步骤：**
1. RED：静态打印 gold、两个 Hermes profile、curl 改 UA 冒充客户端、Agent 不查数却答对、Runner 自造 Trace、旧窗口/别人的 Token 事件，全部不能通过。
2. 对实际接入方式实现 adapter；GUI 导入/发问有真实 UI 证据，CLI 只宣称实际 CLI 路径。按 R7 默认：`adapters/codex.mjs` 驱动 Codex CLI，`adapters/cursor.mjs` 驱动 Cursor CLI Agent（二进制名以 runner 上实际安装版本为准，`cursor-agent` 或 `agent`；当前开发机未安装，需 R8 runner 预装），两者都从 T11 复制出的 MCP 配置生成各自原生配置文件，证据记 `transport=cli`、二进制路径与 `--version` 输出；adapter 启动前先探测二进制与凭据，缺失即 BLOCKED。使用 T11 复制出的 endpoint 与独立测试 Token，不重新拼一套可能串实例的配置。
3. UX-02～05 每 required 产品固定 3 次独立运行；由 Agent 自主选 Wiki/Skill/语义工具，保留多轮、无权限、空结果、超时/截断/恢复与恶意文档案例。
4. checker 独立计算 typed gold、金额/排序/日期/版本/来源，不能只做词语和数字存在判断；扫描所有最终答案和事件内容。
5. 从服务端采集真实 query、上下文 read、policy/context 版本、Token 指纹、问询/Trace，绑定 case/时窗。模型缺凭据、GUI runner 不可用或产品认证方式不支持即 BLOCKED。

**验证：** `node --test scripts/e2e/__tests__/adapter-contract.test.mjs scripts/e2e/__tests__/answer-assertions.test.mjs scripts/e2e/__tests__/server-evidence-binding.test.mjs`；真实环境执行拟新增 `npm run e2e:real:agent -- --run <run.json> --clients docs/qa/real-e2e-clients.yaml`。
**退出：** 两个以上 required 实际产品的全部固定重复通过；harness 单测不代替真实执行。每个外部客户端/模型的访问由受控测试环境授权，不复用个人生产配置。

### T13 · 唯一 verifier、反作弊测试与 readiness 契约

**优先级/依赖：** P1；T10～T12。

**文件：**
- 新建 `scripts/e2e/verify-evidence.mjs`、`archive-evidence.mjs`、`scripts/gates/customer-release-readiness.mjs`。
- 新建 `scripts/e2e/__tests__/evidence-verifier.test.mjs`、`scripts/gates/customer-release-readiness.test.mjs`。
- 修改 `scripts/gates/p1-release-readiness.mjs`、`scripts/smoke/package-sow-trust-evidence.mjs`、`sow-trust-e2e-standard.mjs`、根 `package.json`。

**步骤：**
1. RED：逐一注入 GATE-01 的 500、超时、blocked0、exit/JSON 矛盾、skip、dry-run、缺 case/客户端、空分母、重复 case、篡改 artifact、旧 run、错 digest、无真实 query/伪 Trace。
2. 实现 Spec §8.4 集合相等校验，所有结果只来自有 schema 的产物；child stdout 只为日志，不参与判通过。0/1/2/3 与 JSON 严格一致。
3. 校验真实性：server Trace/event binding、fixture/gold/adapter/profile/catalog digest、候选实际身份、最小查询证据、三次重复、隐私扫描；来源可信不是仅 `stub:false`。
4. 全通过才写 releaseReady=true；collect/dry-run/list 不能覆盖上一份 release evidence 或产生 READY。旧 SOW 固定 inbox 路径打包改为显式 run manifest + 同 verifier。
5. 采集在内存脱敏后才落盘，再扫描、生成完整产物 manifest/哈希、verify、附可信 CI provenance/runner 签名后归档；签名后文件变化须重算并复验。归档失败即 BLOCKED，不签 release。

**关键回归示例：**
```js
// A server error is not successful ACL enforcement.
assert.equal(verifyDenyCase({ httpStatus: 500, reason: 'upstream_error' }).status, 'failed');
assert.equal(verifyRelease({ executionMode: 'dry_run' }).releaseReady, false);
assert.equal(verifyRelease(withMissingRequiredCase(validEvidence)).releaseReady, false);
assert.equal(verifyRelease(withRunnerGeneratedTrace(validEvidence)).releaseReady, false);
```
**验证：** `node --test scripts/e2e/__tests__/evidence-verifier.test.mjs scripts/gates/customer-release-readiness.test.mjs scripts/gates/p1-release-readiness.test.mjs scripts/smoke/p1-agent-e2e.test.mjs`。

### T14 · 客户 amd64 K8s、升级恢复与强制发布依赖

**优先级/依赖：** P1；T13；R8 amd64 单节点 K8s 与 protected runner 已交付（未交付时 workflow 接线与 negative 测试照常完成，真实 K8s 运行记 BLOCKED）。

**文件：**
- 修改 `.github/workflows/lucy-release.yml`（含把 `demo-e2e` / `postgres-demo-e2e` job 改名为 `demo-db-smoke` / `postgres-demo-db-smoke`，并同步引用它们的 `needs`）、`scripts/gates/{k8s-acceptance,k8s-release-gate,k8s-upgrade-gate}.sh`、`scripts/release/build-customer-amd64-image.sh`、`scripts/gates/build-k8s-delivery-package.sh` 及相关 negative 测试；按需更新 `.dockerignore` 和 `scripts/smoke/lucy-delivery-isolation-smoke.mjs`，确保安全测试 fixture/故障控制面不进入客户运行时或默认 seed。
- 新建 `deploy/k8s/security-e2e/` 下隔离测试 values/网络约束（不包含真实凭据）。
- 修改 `deploy/k8s/K8S_CONTRACT.md`、`deploy/k8s/helm/lucy/UPGRADE.md`、客户 delivery/image/preflight runbook、`docs/governance/test-layers-and-release-gates.md`、`docs/qa/e2e-sop.md`。

**步骤：**
1. RED：native-amd64 或 release-package 跳过统一 readiness 仍能生成客户包/tag；验证失败后重建新 digest 继续发布；required GUI job 缺失却通过。
2. 将 customer-release-readiness 设置为所有客户发布分支的必需依赖，保护分支/环境配置有机器可核验证据；未具备 protected runner 前上线结论为 BLOCKED。
3. 客户构建统一 linux/amd64 单架构，保留 G1～G4 的真实 ELF/运行验证及 G4b/G8、Helm/H3 等；Mac host-native demo 不使用 lucy-amd64 builder，不执行 `buildx create --use`。
4. 在同一 digest 的单副本 K8s 上运行新装、N-1 PVC 升级、故障恢复。验证安全库/审计/Token 吊销与角色保持，旧管理会话按策略不复活；customer+off/TLS配置/可信代理/上游旁路预检失败阻断。
5. 测试可读数据只在隔离环境 seed，客户原库只读；真实部署采用入口维护模式迁移，迁移报告 owner 批准后 apply。
6. gate 通过后仅 promote 已测 digest，附可信签名/provenance 的脱敏证据包；候选 staging push 不等于客户可发布。若需要离线交付，verify-k8s-package 必须校验相同 manifest 与 digest。

**验证：**
```bash
npm run test:k8s-gate-negative
npm run test:k8s-delivery-package
npm run gate:k8s-static
# 以下命令只能在准备并获授权的目标测试环境执行
npm run gate:customer-release -- --candidate <identity.json> --run <run.json>
```
**退出：** 实际 CI/离线包均无法绕过 gate；amd64 K8s 实际结果通过，而非只审阅 YAML。

### T15 · 全量收口、文档事实源与可审阅交付

**优先级/依赖：** 本轮完成条件；全部任务。

**文件：**
- 同步 `docs/qa/{enterprise-security-real-e2e-acceptance,suite-webui-browser,suite-agent-mcp,suite-user-journey}.md`、`docs/runbooks/security-guide.md`、`docs/access-control/README.md`、Spec 151/170/171 和 API/Model/术语标准。
- 修正 `docs/governance/DEVELOPMENT.md` 中已过时、可能引导客户绕过 Proxy 直接 stdio/7878 的示例，保留纯引用与双轨语境，不复制运行时问答规则。
- 最终报告与 run manifest、迁移摘要、依赖处置、已知限制、回滚演练结果、CI artifact 链接。

**步骤：**
1. 安全关键路径复查：默认认证、全协议准入、发送屏障、ACL 同角色闭合、会话不可复活、durable audit、脱敏与迁移均有分支到 case 映射。
2. 跑必要定向/全量测试与 lint；新增失败和既有未解决 P0/P1 都不得隐藏到 allowlist。变更后已有通过的检查只在受影响时重复。
3. 对同一候选 run 执行全部 required 场景，核对 fixed denominator、三次 Agent 重复、deny 原因/零泄漏、真实 query/Trace、投影对账/长期归档。所有 BLOCKED 保留阻断。
4. 迁移/发布只由已有批准范围推进；给用户最终可审阅证据后，才请求客户上线签字。代码合入/内部 hotfix 不是客户发布签字。
5. 更新 Spec 状态时分别标“已实现 / 本地通过 / 目标 K8s 通过 / 可发布”，只有最后一项全部满足才能写 verified/GO；不修改 CLAUDE.md 为规则正文。
6. 将 ADR `docs/access-control/adr-20261018-security-ledger-and-context-acl.md` 状态更新为已批准/已实施，并补实际性能基准与迁移结果；`docs/qa/security-findings.yaml` 中所有 P0/P1 为 `fixed` 且 `verifiedBy` 指向本次 release evidence。

**最终验证命令（实施后）：**
```bash
npm run lint:spec
npm run lint:terminology
npm run lint:ia-boundary
npm run security:baseline
npm --prefix webui test
npm --prefix webui run build
npm --prefix webui run e2e:selector-contract
npm run e2e:real:verify -- --run <run.json>
npm run gate:customer-release -- --candidate <identity.json> --run <run.json>
```
原有 runtime/ELF/G4b/G8/Helm/PVC 等命令由正式 gate 清单执行，不因本列表缩写而省略。

## 4. 测试责任与证据矩阵

| 需求 | 实现任务 | required 场景 | 必须交付的证据 |
|---|---|---|---|
| V-08 frontmatter 代码执行 | T0A-1/10/11 | SEC-15-FM-01～06 | 各入口进程内探针未触发、4xx、无写盘；`security:baseline` 静态检查 |
| V-01/06 管理安全 | T0A-2/01/02/11 | SEC-01/02/05/08 | 实际匿名读写拒绝、并发结果、持久引导/限速事件、真实 UI |
| V-03 会话 | T01/03/11/14 | SEC-03/04，OPS-01 | 旧 Cookie 重放/重启/恢复拒绝；UID/epoch 代次摘要 |
| V-02 MCP 停用 | T0A-3/04/10/12 | SEC-07/08/21 | 全通道旧新会话拒绝、在途发送终止、外来 session 无泄漏 |
| D-01 上下文 | T05/06/10/11/12 | SEC-09/10/13/14/16，UX-01/05 | ACL 决策矩阵、迁移 diff/摘要、所有协议、真实 Agent |
| D-02 / V-04 审计 | T07/08/11 | SEC-18/19/20 | durable prepared、故障重启恢复、真实 actor、UI/CSV/zip 对账 |
| V-05/07 隐私/文件 | T06/08/10 | SEC-15/17/20/23 | symlink canary 拒绝、历史清理摘要、全载体零凭据 |
| G-01～05 上线门禁 | T09/10/13/14/15 | GATE-01、SEC-23、OPS-01 | 反作弊矩阵、依赖处置、CI 依赖、同 digest 实际 K8s |
| 新旧全部产品功能 | T10/11/12/15 | UX-01～07 | 接入/建模/发布/恢复/离线 Eval/候选/多轮/多产品 typed gold |

## 5. 开工与客户上线的明确条件

**开工条件：** 用户批准 Spec/Plan 后按批次开工，前置决策见 §1 批次表：A0 只需批准本 Plan；A 需 R3；B 需 R1、R2、R5 与 ADR；C 需 R4、R7～R10，且 T12/T14 的真实执行需 R8 基础设施交付。批准前仅允许继续文档审阅和只读核查。

**交付 Cursor 的方式：** 每次把一个子提交条目（如 `T0A-1`）连同 Spec 对应章节交给一个 Cursor Agent 会话执行，按 §2 的会话粒度约定回报；审阅通过再交下一条。

**任务完成条件：** 对应反例从 RED 到 GREEN、有真实服务断言、代码/规格/术语一致、可审阅 diff 与证据。不得以“新增了测试文件”代替测试执行。

**客户 GO 条件：** 未关闭 P0/P1=0；生产依赖 high/critical 未处置=0；上下文迁移 pending=0；required 场景全部实际执行且通过；required 产品不少于两个并完成固定重复；真实 query/Trace/审计证据可核对；客户 amd64 单副本 K8s、TLS/可信代理/存储、升级恢复通过；同一候选 digest，产物脱敏签名归档；无 blocked/skip/dry-run 或旧证据拼装。没有降级为“先出客户包后补证据”的路径。

## Terminology Compliance

This plan follows `webui/docs/00-product-terminology-standard.md`；新增术语/恢复术语以配套 Spec 的 Terminology Compliance 为登记来源，实施前同步原标准。新增字段/路径/原因码 DOM 采用翻译防御。

## Design System Compliance

采用配套 Spec 引用的按钮、网格、Toast 与页面模式；本计划不设计新视觉模式。新增授权/引导/审计延迟 UI 在 T02/T06/T11 验证 1440×900 桌面及键盘可达性，不扩到移动/窄屏。
