# 企业安全整改 — Cursor 开发交付提示词

| 元数据 | 内容 |
|---|---|
| 文档名称 | 企业安全整改与真实用户 E2E — Cursor 开发交付提示词 |
| 文档类型 | Other（开发交付提示词） |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude |
| 委托人 | xingchen |
| 基于材料 | [Spec v0.2](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md)、[Plan v0.2](2026-10-18-enterprise-security-and-real-e2e-plan.md)、[ADR](../access-control/adr-20261018-security-ledger-and-context-acl.md)，均于 2026-10-18 批准 |
| 适用范围 | 把 Plan 的每个子提交交给一个 Cursor Agent 会话执行 |
| 输出位置 | `docs/plans/2026-10-18-enterprise-security-cursor-prompts.md` |

## 0. 使用方法

1. **一个会话只做一个子提交。** 新开 Cursor Agent 会话 → 粘贴 §1「公共前言」→ 紧接粘贴 §2 或 §3 中对应任务的提示词 → 发送。
2. **按顺序交付：** `T00 → T0A-1 → T0A-2 → T0A-3 → T01 → T02 → T03 → T04-1 → T04-2 → T04-3 → T05+T06 → T07-1…4 → T08-1…3 → T09 → T10 → T11 → T12 → T13 → T14 → T15`。上一条审阅通过并提交后再交下一条。
3. **审阅关注点：** 会话最后的「交付报告」里 RED/GREEN 两次命令都有真实输出；diff 只含本任务文件；`docs/qa/security-findings.yaml` 已按任务更新。
4. **提交由人完成。** 提示词要求 Agent 不执行 `git commit`（仓库 AGENTS 规则：未经明确要求不提交）。审阅通过后由你或 Aide 按「只暂存本任务文件」提交。
5. **前置决策：** A0 与 A 批次可立即交付。B 批次已具备条件（R1/R2/R5 与 ADR 已批准）。C 批次的 T12、T14 需要 R8 基础设施（受保护 runner、amd64 K8s）和 R10 测试凭据到位，否则 Agent 只交付代码与单测，真实执行记 BLOCKED。

---

## 1. 公共前言（每个会话都先粘贴）

```text
你在 project-lucy 仓库（分支 lucy-v2.0）中执行一项已批准的安全整改子任务。

【权威依据】（先读，不要凭印象实现）
- @docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md （Spec v0.2，已批准；§10 R1～R10 按默认值生效）
- @docs/plans/2026-10-18-enterprise-security-and-real-e2e-plan.md （Plan v0.2，已批准；只执行下面指定的子提交）
- @docs/access-control/adr-20261018-security-ledger-and-context-acl.md
- @AGENTS.md 与 @docs/governance/DEVELOPMENT.md
- 术语：@webui/docs/00-product-terminology-standard.md

【硬约束】
1. 只做本会话指定的子提交；Plan 中其他任务的内容即使顺手也不要做。
2. 工作区有他人未提交的改动。开工先运行 `git status --short` 记录基线；不得修改、格式化、暂存或回滚任何非本任务文件。
3. 先写失败测试（RED）并实际运行看到失败，再实现，再运行看到通过（GREEN）。不要只写测试不运行。
4. 不修改 KTX 源码；不读取真实 `.ktx/secrets/`、私有客户配置或生产数据；测试只用合成夹具与 canary。
5. 本地脚本必须兼容 macOS 自带 bash 3.2（禁用 readarray/mapfile/负数下标）。
6. 用户可见文案、错误信息遵守术语标准；新错误码登记到 @webui/docs/03-api-spec.md。
7. 需要重建本地 Docker demo 时用 `npm run demo:upgrade`（需要从零时加 `-- --fresh`），不要用 `--no-cache`。
8. 不执行 `git commit` / `git push`，不发布镜像，不部署任何环境。
9. 每关闭或推进一个缺陷，同步更新 `docs/qa/security-findings.yaml` 对应条目（T00 创建该文件）。

【立即停止并回报，不要自行扩展】
- 需要改变 Spec 已定的权限 / 审计 / 会话语义，或 Spec 与代码现状冲突无法按原文实现；
- 需要真实凭据、私有配置、外部基础设施或付费模型调用；
- 定向测试以外出现大面积、无法解释的失败；
- 发现评估报告未列出的新安全问题（记录复现方式后回报，不顺手修）。

【交付报告格式】（会话结束时必须输出）
1. 子提交 ID 与一句话结果（完成 / 部分完成 / BLOCKED）。
2. 改动文件清单（新增 / 修改），与 `git status --short` 基线对比，确认无越界文件。
3. RED：命令 + 关键失败输出；GREEN：命令 + 通过输出；其他回归命令与结果。
4. `security-findings.yaml` 的变更。
5. 未满足项、已知限制、需要人决策的问题。
```

---

## 2. A0 / A 批次：逐条提示词（可直接粘贴）

### T00 · 冻结基线与回归目录

```text
【本会话任务】执行 Plan「T00 · 冻结批准范围、基线与回归目录」全部步骤（含步骤 3a）。

要点：
- 把基线（HEAD、dirty 文件名、Node 版本、架构、Spec §1 映射表涉及文件的 sha256）写入 `inbox/e2e/<runId>/baseline.json`，runId 用 `t00-<yyyymmdd-HHMM>`。
- 用 `webui/node_modules/.bin/tsx inbox/e2e-security-audit-20261017/reproduce.ts` 与 `webui/node_modules/.bin/tsx inbox/xv-20261018/gm-rce-probe.ts` 重新确认 V-01/02/03/04/06/07/08 仍可复现，把结论写进 baseline.json；不修改这两个脚本。
- 新建 `docs/qa/security-findings.yaml`（严格按 Spec §8.3a 的字段），登记 V-01～V-08、D-01～D-02、G-01～G-05，以及 fast-uri、gray-matter、sprintf-js/argparse/js-yaml 依赖条目，初始 status 全部 open。
- 新建 `docs/qa/enterprise-security-real-e2e-acceptance.md`（带 AGENTS 要求的元数据表）：把 Spec §7 的 32 个场景及其显式子场景（含 SEC-15-FM-01～06）映射到「执行器 / 计划落地的测试文件 / 任务 ID」，每行都有执行器，不复制授权规则正文。
- 本任务不改任何业务代码。

验证：`git status --short`、`node --version`、`npm --prefix webui run e2e:selector-contract`（已知约 33 项失败，只记录到验收映射文档的 T09 待办，不修）、`npm run lint:spec`。
```

### T0A-1 · V-08：仅允许 YAML frontmatter（P0）

```text
【本会话任务】执行 Plan「T0A-1 · V-08 仅允许 YAML frontmatter」。规格见 Spec §4.6。

背景（已复现）：`webui/server/wiki.ts` 以默认参数调用 gray-matter，`---js` frontmatter 会被 eval；open 模式匿名请求与 required 模式 operator 都能经 `POST /api/wiki/upload/preview` 在服务端执行代码。复现脚本：@inbox/xv-20261018/gm-rce-probe.ts

实施要求：
1. RED：新建 `webui/server/__tests__/frontmatter-safety.test.ts`，用 `buildServer()` 与进程内探针 `globalThis.__LUCY_FM_PROBE`，对上传预览、上传提交、PUT 编辑（dryRun true/false）、GET 读取磁盘预置文件、版本恢复六个入口，分别发送 `---js`、`---javascript`、`---JS`、`--- js`、`---json` 载荷；先断言探针被设置，运行确认 RED。
2. 新建 `webui/server/markdown-frontmatter.ts`，导出 `parseMarkdownFrontmatter` 与 `stringifyMarkdownFrontmatter`：首行 `---` 后语言标记 trim+小写为空或 `yaml` 才用 `yaml` 包 parse，否则抛 `FRONTMATTER_ENGINE_FORBIDDEN`；边界规则与 `webui/server/proxy/wiki-acl.ts` 的 `parseFrontmatter` 一致；stringify 可继续委托 gray-matter（现 `wiki.ts:374` 的唯一用法）。
3. 替换 `wiki.ts` 中全部 8 处 `matter(...)`，`import matter from "gray-matter"` 只允许留在新入口文件。
4. `webui/server/index.ts` 错误映射：上传/保存 → 400 `WIKI_FRONTMATTER_UNSUPPORTED`（文案「仅支持 YAML 格式的文档属性」）；读取磁盘非法文件 → 422。登记到 API Spec。
5. `scripts/release/security-baseline.mjs` 增加 fail 检查：`webui/server/**/*.ts` 中出现 `from "gray-matter"` 且不是 `markdown-frontmatter.ts`。
6. GREEN：测试改为断言探针未设置、4xx、未写盘；合法 YAML 对照成功。检查全部模板 Wiki（`examples/*/project-template/wiki/**`、`customer-config.example/config/wiki/**`）解析正常，若失败修内容不放宽解析。
7. `security-findings.yaml`：V-08 → fixed，`verifiedBy` 填 SEC-15-FM-01～06（fixedIn 留空待提交后补）。

验证：
cd webui && npx vitest run --maxWorkers=1 server/__tests__/frontmatter-safety.test.ts server/__tests__/wiki.test.ts && cd ..
npm run security:baseline
webui/node_modules/.bin/tsx inbox/xv-20261018/gm-rce-probe.ts   # 三个 case 的 evaluated 必须为 null
cd webui && npm test
```

### T0A-2 · V-01 最小版：部署模式与默认非开放（P0）

```text
【本会话任务】执行 Plan「T0A-2 · V-01 最小版」。规格见 Spec §3.1 第 1–4、8 条（只做 A0 范围：持久限速、bootstrap 互斥、持久引导状态留给 T02，不要做）。

背景：`resolveAuthMode()` 在无启用管理员且未设 `LUCY_WEBUI_AUTH=required` 时返回 open；Helm Chart 不设置该变量，entrypoint 也不播种 admins.yaml，因此客户 K8s 新装即开放，且 `/api/auth/bootstrap` 可匿名创建 owner。

实施要求：
1. RED：新建 `webui/server/__tests__/webui-deployment-mode.test.ts`：customer 模式 + 空 admins.yaml + 未设 LUCY_WEBUI_AUTH 时，断言当前行为为 status=open、匿名 PUT Wiki 200、匿名 bootstrap 200；运行确认 RED 后改为期望值。
2. 新建 `webui/server/auth/deployment-mode.ts`：读 `LUCY_DEPLOYMENT_MODE`，缺省 customer，非法值抛错拒启动。customer 下 `resolveAuthMode` 永不返回 open（无管理员 → bootstrap）；`LUCY_WEBUI_AUTH=off` 仅 development 生效。
3. bootstrap（customer 模式）：要求 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE` 指向可读非空文件，否则 503 `BOOTSTRAP_NOT_PROVISIONED`；请求头 `X-Lucy-Bootstrap-Token` 用 timingSafeEqual 比对，不符 401。`webui/src/pages/Login.tsx` 增加引导密钥密码框，只在内存持有。错误码登记 API Spec。
4. `webui/test/setup.ts`：未显式设置时默认 `LUCY_DEPLOYMENT_MODE=development`、`LUCY_WEBUI_AUTH=off`，使现有依赖开放模式的 40 个 server 测试保持不变；显式设置的 suite 不受影响。
5. Helm：`deploy/k8s/helm/lucy/templates/_helpers.tpl` 的 `lucy.composeEnv` 写死 `LUCY_DEPLOYMENT_MODE=customer`；`values.yaml` 新增 `bootstrap.existingSecret`（默认空），`templates/deployment.yaml` 有值时挂载为文件并设置 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE`。
6. `scripts/runtime/docker-entrypoint.sh` + 测试：customer 且 `LUCY_WEBUI_AUTH=off` 时退出非 0。
7. Demo：`deploy/compose/docker-compose.{demo,postgres-demo,executive-poc,customer-config}.yml` 以 file secret 挂载 `deploy/compose/secrets/webui-bootstrap-token`（已被 .gitignore 忽略）；在 `npm run demo:upgrade` 的实际实现（先读 package.json 找入口）中，`--fresh` 时若文件不存在则生成 32 字节随机值（0600），只打印路径。
8. `security-findings.yaml`：V-01 保持 open，note「A0 最小修复已合入，完整修复见 T02」。

验证：
cd webui && npx vitest run --maxWorkers=1 server/__tests__/webui-deployment-mode.test.ts server/__tests__/webui-admin-auth.test.ts && npm test && cd ..
node --test scripts/runtime/docker-entrypoint.test.mjs
npm run gate:k8s-static
可选（Docker 可用时）：npm run demo:upgrade -- --fresh 后用生成的密钥在 /login 完成 bootstrap；再运行一次 npm run demo:upgrade，确认管理员保留且无需再次引导。不可用时在报告中注明未执行。
```

### T0A-3 · V-02 最小版：停用 Agent 全方法拒绝

```text
【本会话任务】执行 Plan「T0A-3 · V-02 最小版」。规格见 Spec §3.3 第一段（只做停用检查，不做会话绑定、发送屏障、角色解析，这些属于 T04）。

背景：`identifyRequestDetailed` 只校验 Token 存在、吊销、过期；`enabled:false` 只在 `acl.ts` `authorizeAndRewrite` 中检查。`mcp-proxy.ts` 的 resources/list、resources/read、prompts/list、prompts/get 分支不经过它，停用 Agent 仍能读出完整 Skill 正文。

实施要求：
1. RED：新建 `webui/server/__tests__/mcp-disabled-agent-all-methods.test.ts`，合成 access.yaml（enabled:false）与已发布 Skill canary，对 initialize、tools/list、tools/call(lucy_skill_read)、resources/list、resources/read、prompts/list、prompts/get 逐一请求；先断言当前至少 resources/read 与 prompts/get 返回 canary（参考 @inbox/e2e-security-audit-20261017/reproduce.ts 的夹具写法）。
2. 在 `handlePost` 以及 GET/DELETE 处理中 `identifyRequestDetailed` 成功之后，读取与 `authorizeAndRewrite` 相同来源的 access 配置（不新建缓存层），`enabled === false` 时返回 HTTP 403 + `{"jsonrpc":"2.0","id":<请求id>,"error":{"code":-32003,"message":"Access denied: agent_disabled"}}`，写 denied 审计，不转发上游。
3. GREEN：全部方法拒绝且响应无 canary；启用 Agent 对照组行为不变。
4. `security-findings.yaml`：V-02 保持 open，note「A0 入口拒绝已合入，完整准入见 T04」。

验证：cd webui && npx vitest run --maxWorkers=1 server/__tests__/mcp-disabled-agent-all-methods.test.ts server/__tests__/mcp-proxy-skills.test.ts server/__tests__/mcp-proxy-acl.test.ts server/__tests__/mcp-proxy-instructions.test.ts server/__tests__/mcp-proxy-upstream-session.test.ts
```

### T01 · 持久安全状态与账本基础

```text
【本会话任务】执行 Plan「T01 · 持久安全状态与账本基础」全部步骤。规格：Spec §2（表结构与权限）、ADR D1/D2。

要点：
- 只建存储层与恢复逻辑，不接入认证或 MCP 路由（那是 T02～T04）。
- `.ktx-ui/security.sqlite`：WAL + `synchronous=FULL`；目录 0700，db/WAL/SHM 0600；schema 带版本号，重复初始化幂等。
- 失败返回结构化 unavailable，绝不创建空 fallback；pending 操作恢复时不得把 pending 视为成功，也不得恢复为更宽权限。
- `fs-safe.ts` 拒绝把 security.sqlite 作为资产读取/导出；确认现有 `.ktx-ui` 相关导出与历史功能不回归。
- 同步 `webui/docs/04-data-model.md`。

验证：按 Plan T01 的 vitest 命令；另跑 `cd webui && npm test` 确认无回归。
```

### T02 · 默认强制认证、受控 bootstrap 与限速

```text
【本会话任务】执行 Plan「T02」全部步骤（含 v0.2 新增的步骤 6 Cookie Secure、步骤 7 部署模式篡改预检）。规格：Spec §3.1 全部条目。前置：T0A-2、T01 已合入。

要点：
- 在 T0A-2 的部署模式与引导密钥基础上，补：引导状态持久化到 security.sqlite（一次性消费）；进程内互斥覆盖「fresh read → 验证密钥 → 写管理员 → 消费引导 → commit」，并发第二个请求 409；限速桶按 Spec §3.1 第 5–6 条的阈值、TTL、上限实现并跨重启保留；未知账号与错误密码统一 401。
- 未知 / 损坏的管理员 role 拒绝解析，不得默认为 owner（当前 `normalizeWebuiAdminRole` 默认返回 owner，需要修正并补测试）。
- Cookie：customer 模式默认 Secure；customer 下 `LUCY_WEBUI_COOKIE_SECURE=0` 启动失败。
- 关闭 security-findings 中 V-06（status=fixed），V-01 在本任务完成后改为 fixed，verifiedBy 填 SEC-01/02/05/08 的协议用例 ID。

验证：按 Plan T02 的命令；外加 `cd webui && npm test`。
```

### T03 · v2 会话、退出 / 密码重置与恢复边界

```text
【本会话任务】执行 Plan「T03」全部步骤。规格：Spec §3.2、§2 的 admin_account_state / admin_sessions。前置：T01、T02 已合入。

要点：
- 注意现状：停用账户已即时失效（guard 每次请求检查 enabled），保留为回归用例；真正缺口是退出、改密、删除后同 id 重建三种情况，以及 v1 无状态会话。
- 会话 v2 载荷含 jti、account_uid、session_epoch；每请求查持久会话与账户状态，不使用 admins 5 秒缓存做安全判断。
- 顺序：先撤销 / 提升 epoch，再写配置；logout 在耐久吊销成功后才返回成功。
- 空闲 30 分钟 / 绝对 12 小时（R3 默认值）；敏感 API `Cache-Control: no-store`；安全库异常 503 `AUTH_STATE_UNAVAILABLE`。
- 写恢复 runbook（Plan T03 步骤 5），落在 `docs/runbooks/`，带元数据表。
- 完成后 V-03 → fixed。

验证：按 Plan T03 的 vitest 命令，必须包含「登出 → 重放 401 → 重启进程 → 重放仍 401」的真实 HTTP 用例。
```

### T04-1 / T04-2 / T04-3 · MCP 公共准入、会话绑定、撤销屏障

```text
【本会话任务】执行 Plan「T04」中的子提交 <T04-1 | T04-2 | T04-3>（每个会话只填一个）。规格：Spec §3.3。前置：T0A-3、T01～T03 已合入（T04-2 需 T04-1，T04-3 需 T04-2）。

T04-1（统一 admission，Plan 步骤 1–2）：把 T0A-3 的停用检查收敛进新建 `webui/server/proxy/admission.ts`，统一 Bearer / 吊销 / 到期 / 启用 / 角色解析 / 许可 / Origin；拒绝未知路径、未知方法、batch 与非对象 envelope，且不带内部 Token 转发。legacy direct-allow 身份数据面兼容，上下文能力留给 T05。
T04-2（会话归属，Plan 步骤 3）：上游 session 键从 userId 改为 (Agent id, Token hash, downstreamSessionId)；外来 sessionId 拿不到别人的状态；缺 session header 的客户端可重连。
T04-3（撤销屏障，Plan 步骤 4–5）：新建 `authorization-barrier.ts`，收窄操作先持久化、取消在途请求 / 流、清缓存，再返回成功；每个内容发送点复核授权版本；客户模式下关闭 `/mcp/skills` 旧 passthrough，开启则启动预检失败。

验证：每个子提交跑 Plan T04 命令中与本子提交相关的测试文件；T04-3 跑 T04 全量命令。T04-3 完成后 V-02 → fixed。
```

---

## 3. B / C 批次：模板提示词

B、C 批次任务内容已在 Plan 中写到文件与步骤级别。交付时把下面模板的尖括号部分按 §3.1 表格替换后，接在公共前言后发送。

```text
【本会话任务】执行 Plan「<任务或子提交 ID>」<全部步骤 | 步骤 a–b>。规格：Spec <章节>；ADR <条目，如适用>。前置：<依赖任务> 已合入。

本任务特别注意：
<从 §3.1 表格「特别注意」列粘贴>

完成后更新 security-findings.yaml：<条目与目标状态>。
验证：按 Plan 该任务的「验证」命令全部执行；外加 `cd webui && npm test`（涉及 webui 时）。
<C 批次追加：需要真实凭据 / runner / K8s 的步骤若环境不可用，交付代码与单测，真实执行状态记 BLOCKED，不得伪造或跳过。>
```

### 3.1 参数表

| 任务 | Spec 章节 | 前置 | 特别注意 | findings 更新 |
|---|---|---|---|---|
| T05 + T06（同一 PR，可分两个会话但一起审阅提交） | §4.1–4.5、§4.3 模板 ACL | T04 | 默认拒绝与 14 个模板 Wiki / 模板 Skill 的显式 ACL 必须同时合入；不从 `sl_refs` 推导授权；Role 删除检查上下文引用；`smoke:p0:demo` 加授权 / 拒绝断言；迁移工具只在合成夹具上运行 | D-01 → fixed；V-07 → fixed |
| T07-1 | §5.1 | T05/T06 | 只做非流式 JSON 响应的 admitted → prepared → 发送；审计失败 503 `AUDIT_UNAVAILABLE` | — |
| T07-2 | §5.1 流式 | T07-1 | SSE 有界缓冲（默认 8 MiB）；崩溃恢复标 interrupted，不伪造 delivered | — |
| T07-3 | §5.2 | T07-2 | projector 幂等、游标与目标库同事务；投影延迟显示 `complete=false` | D-02 → fixed |
| T07-4 | §5.1 性能预算 | T07-3 | 新建 `webui/scripts/audit-overhead-bench.mts`；p95 ≤ 20 ms、p99 ≤ 50 ms、零 BUSY 503；不达标不得放宽 `synchronous=FULL`，回报 | — |
| T08-1 | §5.2 | T07 | 缺口集中在 `wiki.ts` 4 处、`semantic-layer.ts` 2 处 `auditedWriteFile`；禁止已登录请求回退 `local-admin` | — |
| T08-2 | §5.3 | T08-1 | 写入前 allowlist 脱敏；`admins.yaml` 整文件 diff 剔除 `password_hash`；补认证事件 | V-04 → fixed |
| T08-3 | §5.3 历史与保留 | T08-2 | 清理工具只输出计数 / 摘要；先 dry-run → 受控备份 → 清理 | V-05 → fixed |
| T09 | §8.2、G-02～G-05 | T08 | `overrides.fast-uri` 升到已修复版本；blocked 不得 exit 0；dry-run 不计 passed；selector 33 项按真实漂移修复 | G-02/G-04/G-05 → fixed，依赖条目更新 |
| T10 | §6.2、§7 | T09 | catalog 冻结全部 required 变体（含 SEC-15-FM）；故障钩子只在测试控制面 | — |
| T11 | §6.5 J-01 | T10 | auth required、禁 API mock / KTX shim；Token / 密码不进 trace 与截图；1440×900 桌面，workers=1，retries=0 | — |
| T12 | §6.3、R7、R9、R10 | T11、R8 runner、R10 凭据 | Codex CLI + Cursor CLI Agent 为 required；先探测二进制与凭据，缺失即 BLOCKED；每产品每场景 3 次，3/3 才通过 | G-03 → fixed（需真实执行通过） |
| T13 | §8.1–8.4、§8.3a | T10～T12 | verifier 读取 `security-findings.yaml` 与 `npm audit` 实际结果交叉比对；只从有 schema 的产物判定 | — |
| T14 | §8.3、R8 | T13、R8 K8s | workflow 中 `demo-e2e` / `postgres-demo-e2e` 改名为 `demo-db-smoke` / `postgres-demo-db-smoke`；禁止 `docker buildx create --use`；amd64 单架构与 G1–G4 不弱化 | G-01 → fixed（需 K8s 实跑通过） |
| T15 | 全部 | 全部 | ADR 状态更新为已实施并补性能与迁移结果；Spec 状态四级分别标注 | 全部 P0/P1 为 fixed 且 verifiedBy 指向本次 release evidence |

---

## 4. 审阅检查清单（每条子提交合入前）

- [ ] 交付报告五项齐全，RED 与 GREEN 都有真实命令输出。
- [ ] `git status --short` 与基线对比，只多出本任务文件；无格式化漂移。
- [ ] 新增用户文案 / 错误码已登记术语标准与 API Spec。
- [ ] `security-findings.yaml` 状态与本次改动一致；标 fixed 的条目有 verifiedBy。
- [ ] 无真实凭据、私有配置或 canary 以外的数据进入仓库与 `inbox/` 产物。
- [ ] 涉及 Chart / entrypoint / 脚本的改动已跑 `npm run gate:k8s-static` 或对应 bash 3.2 测试。
