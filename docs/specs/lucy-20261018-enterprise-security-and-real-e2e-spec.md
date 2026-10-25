# Lucy 企业安全整改与真实用户 E2E 上线门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 企业安全整改与真实用户 E2E 上线门禁 Spec |
| 文档类型 | Spec（Cross-module Security / Access Control / QA / Release） |
| 版本 / 日期 | v0.2 / 2026-10-18，Asia/Shanghai（v0.1 初稿；v0.2 对齐评估 v1.1，补 V-08、A0 热修复、R7–R9、可机器校验条件） |
| 撰写人 | Codex（v0.1）；Claude（v0.2 修订） |
| 委托人 | xingchen |
| 状态 | **已批准（2026-10-18，xingchen）；§10 R1～R10 按默认值生效；R8 基础设施负责人待指定。实施状态四级分别标注（见下表）：已实现 ✅｜本地通过 ✅（范围受限）｜目标 K8s 通过 ❌ BLOCKED｜可发布 ❌** |
| 实施 Plan | [2026-10-18-enterprise-security-and-real-e2e-plan.md](../plans/2026-10-18-enterprise-security-and-real-e2e-plan.md) |
| 架构决策 | [ADR — 安全账本与上下文对象授权](../access-control/adr-20261018-security-ledger-and-context-acl.md)（已于 2026-10-18 与本 Spec 同批批准） |
| 评估来源 | 2026-10-17 评估 v1.1 及其合成夹具运行证据（含 V-08 复现）；历史工作副本路径为 `inbox/e2e-security-audit-20261017/assessment.md` 与 `inbox/xv-20261018/`。这些临时文件未纳入 Git，不作为当前可访问证据；持久口径以本 Spec 的问题映射与验收定义为准，不依赖临时链接 |
| 输出位置 | `docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md` |
| 基线 | `lucy-v2.0`，HEAD `5c1e5cf`；工作区存在他人未提交改动，实施前重新确认源码与漏洞状态 |
| 范围 | 管理认证、MCP 统一准入、Wiki/Skill 授权、耐久审计、真实用户 E2E、客户上线门禁 |
| 部署边界 | 单实例/单副本；开发 Mac arm64；客户 linux/amd64 Kubernetes；只改 Lucy，不改 KTX 源码 |

## 0. 实施状态（T15，据实；四级互不替代）

| 级别 | 状态 | 依据与范围 |
|---|---|---|
| 已实现 | ✅ | T00～T15 代码、迁移工具、harness、verifier、归档、workflow 接线均已合入工作区（A0 热修复、A、B、C 批次） |
| 本地通过 | ✅（范围受限） | 开发机（arm64，无 KTX 上游/数据库/真实客户端）：security-integration 对真实 Lucy 进程执行的 case、真实桌面 Chromium 管理旅程（9 个用例）、证据 verifier 反向测试 GATE-01-V01～V16 全部通过；其余按 catalog 能力要求报 BLOCKED，数量与原因见 `docs/qa/enterprise-security-real-e2e-acceptance.md` §8 |
| 目标 K8s 通过 | ❌ BLOCKED | R8：受保护 runner 与 amd64 单副本 K8s 未提供；`real-e2e` job 从未被调度；N-1 PVC 升级、恢复、网络隔离未运行 |
| 可发布 | ❌ | 需 `customer-release-readiness` 在同一候选 digest 上通过：P0/P1 全部 fixed 且被本次 release 证据验证（当前 G-01、G-03 为 open）、自动分母（Claude Code + OpenClaw 各 3/3）passed、人工 GUI 清单（WorkBuddy + Cursor Agent）passed、无 blocked/skip/dry-run |

只有最后一级全部满足才可写 verified / GO；本表不是客户上线授权。

## 1. 目标、优先级与生效关系

目标是让“管理人员配置数据与上下文 → 签发访问凭据 → 多平台 Agent 问数 → 调查审计 → 客户上线”形成可重复且有安全边界的闭环。发布门禁必须依据当前候选版本的真实行为，禁止用代码审查、模拟服务或旧证据替代。

| 评估项 | 优先级 | 本 Spec 需求 | 验收 |
|---|---|---|---|
| **V-08 Wiki frontmatter 服务端代码执行** | **P0** | §4.6 仅允许 YAML frontmatter；A0 热修复（§9） | SEC-15（FM 子场景） |
| V-01 客户默认部署即开放管理面，可匿名抢占 owner | P0 | §3.1 默认认证与受控 bootstrap；A0 先行最小修复 | SEC-01/02/08 |
| V-02 停用 Agent 绕过 Resources/Prompts | P1 | §3.3 公共准入与发送屏障；A0 先行入口拒绝 | SEC-07/08/21 |
| V-03 退出/重置后旧 Cookie 有效 | P1 | §3.2 持久会话与账户代次 | SEC-03/04 |
| V-04 Wiki / 语义层写入的管理员归因缺失、无登录事件 | P1 | §5 请求身份与认证事件 | SEC-05/18/20 |
| V-06 bootstrap 并发覆盖 | P2（评估 v1.1 下调），随 §3.1 一并修复 | §3.1 单进程串行引导 | SEC-02 |
| D-01 / Spec 170 上下文全开放 | P1 | §4 显式对象授权与迁移 | SEC-09/10/13/14，UX-01/05 |
| D-02 审计写失败后仍释放数据 | P1 | §5 持久账本后释放响应 | SEC-19，GATE-01 |
| G-01～04 门禁误判/真实性/覆盖不足 | P1 | §6～8 真实链路、不可跳过、证据绑定 | 全部场景、GATE-01 |
| G-05 生产依赖风险 | P1 发布处置 | §8 扫描与依赖修复 | SEC-23 |
| V-05 密码哈希审计泄露 | 原 P2，本期一并修复 | §5.3 写入前脱敏与历史清理 | SEC-17/20 |
| V-07 Wiki symlink 越界 | 原 P2，本期一并修复 | §4.5 文件边界 | SEC-15 |

批准并实现后，本 Spec **仅在以下议题上**替代旧规定，实施任务必须同步原文引用；本草案本身不立即覆盖任何已批准规则：

- Spec 170 的上下文全开放：取消，恢复并统一 Spec 151 的对象授权、通道检查与同角色闭合；Wiki 采用 §4 的显式角色授权，不恢复旧的 `sl_refs` 隐式放行。
- Spec 07/171 的协议路由：加入所有方法统一准入；不改变数据面 capability、静态 Row Policy、Agent Constraints 的代数。
- WebUI auth 设计中的默认开放/无状态会话：由 §3 替代。
- Spec 137/151 的读取审计要求：schema 可用不再等于审计已持久，采用 §5 的耐久保证。
- QA / release 文档中 E2E “推荐”或未接线的强制项：由 §8 的客户上线阻断条件落实。
- 20261014 Release BOM 的变更口径覆盖率仍用于语义内容发布；**不得抵消客户版本安全/E2E 门禁失败**。本 Spec 不重写 BOM 的计算公式或未决阈值。

### 1.1 非目标与信任边界

不增加多副本、分布式锁、TokenScope、Dynamic RLS、多租户 claim、Active Role、完整 CLS、SSO/OIDC/MFA、SMTP 或新的查询语言。遵守 [权限路线图冻结](../access-control/adr-post-p15-roadmap-freeze.md)。同一 Agent 多 Token 仍同权；Token 级会话隔离不构成 Token 级行权限。可选 SMTP 与单点登录已记入 [Lucy 2.5 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) L25-05、L25-06，并分别形成 [可选 SMTP 通知 Spec](lucy-20261025-v0p25-smtp-notifications-spec.md)（已签核）与 [OIDC 单点登录 Spec](lucy-20261025-v0p25-oidc-single-sign-on-spec.md)（已签核）；只有独立 Spec 已签核的明确范围构成有边界例外，其他非目标不变。

保留当前 owner/operator 的职责合同：仅 owner 管理登录账户；operator 可做现有日常连接、语义、Wiki、Skill、Agent/Role/Token 与审计操作。两者都是受信任管理人员，本期不宣称实现双人授权审批或管理员职责分离。操作员能修改业务上下文，故其内容必须视为可能带有间接提示注入的输入，不能提升数据面权限。

数据库账户使用最小只读权限；PII 混合表通过脱敏 VIEW/拆表限制暴露列。接收合法数据后的客户端/模型供应商出站治理由客户部署策略共同负责。不能承诺仅靠 MCP instructions 阻止已授权结果被复制。宿主机 root/DBA 对存储与运行时的完全控制不在本应用防护边界，不能把本地日志称为不可篡改 WORM。

### 1.2 设计方案选择

| 方案 | 取舍 | 草案选择 |
|---|---|---|
| 显式对象角色 ACL + 角色通道，同角色闭合 | 可复用 151；默认拒绝；文档和数据独立授权，迁移需要逐项确认 | **采用** |
| 由 `sl_refs` / Skill prerequisites 推导授权 | 维护成本低，但引用变更会改变授权，无法清楚表达跨域公共 SOP；易泄漏元数据 | 不采用作授权事实源 |
| 保持全开放，靠提示词约束或按实例拆分 | 拆分实例可做额外隔离；单实例无法满足对象保密域要求 | 不作为本期默认策略 |

## 2. 数据与配置契约

以下为**拟新增**契约，不能在批准前写入真实私有配置。

| 事实源 | 契约与迁移 |
|---|---|
| `admins.yaml` | 增加不可变 `account_uid`；账号 id 可读标识不再作为会话唯一身份。缺少 UID 的旧账号在受控迁移时分配；未知 role / 损坏配置拒绝解析，禁止默认为 owner |
| `.ktx-ui/security.sqlite` | 新建耐久安全状态库：`admin_account_state`、`admin_sessions`、`bootstrap_state`、`auth_rate_buckets`、`role_id_tombstones`、`security_events`、`projection_cursors`。包含 schema version；目录 0700，数据库/WAL/SHM 0600；不得被普通资产导出或运维问数连接读取 |
| `admin_account_state` | `account_uid` 主键、显示 id、`session_epoch`、enabled/tombstoned、凭据指纹；删除后保留 tombstone，不复用 UID |
| `admin_sessions` | 随机会话 jti 的 SHA-256 主键、account_uid、签发 epoch、created/lastSeen/absoluteExpiry、revokedAt；不存原始 Cookie、密码或 Token |
| `security_events` | 唯一 eventId、operationId、事件阶段、真实 actor/actorType、可信网络信息、session/jti 指纹、server traceId、policy/context 版本、对象哈希、裁决/结果摘要、时间；无正文、凭据、过滤值。每操作可多事件，投影按 operationId 合并一次调用 |
| `.ktx-ui/audit.sqlite` | 保留现有 UI/CSV 查询模型；新增事件关联字段和幂等投影游标。既有历史保留，标明归因能力的生效日期，不猜补历史操作者 |
| Skill frontmatter | `roles_allowed` 仍为对象授权唯一事实源；`status` 的 draft/published/deprecated 不变 |
| Wiki frontmatter | `allowed_roles` 为对象授权唯一事实源；`visibility` 仅作旧文件兼容元数据，不授予权限；`sl_refs` 只作关联 |
| 角色配置 | 继续使用 `allow.tools` 表达 discover/read 通道；不新增第二套 `allowed_skills` 或 Wiki 白名单 |
| 上下文版本 | 新增服务端 `contextPolicyVersion = hash(规范化对象 ACL + 文件身份/版本 + 角色通道版本)`，与现有 policyVersion 一起进入缓存键和审计。安全收窄不等待 KTX reindex |

安全库和审计库不做伪跨库原子事务：安全库是新操作安全证据的事实源，审计库是可重建投影。数据查询不与日志事务组成数据库分布式事务；只保证敏感内容释放之前已有耐久授权/响应准备记录，见 §5。

## 3. 管理面和 MCP 的 P0/P1 修复契约

### 3.1 默认认证、受控首次引导和限速

1. 新增 `LUCY_DEPLOYMENT_MODE=customer|development`，默认 `customer`。默认必须认证；无有效管理员进入 bootstrap，配置损坏进入 unavailable，均不得进入 open。已有部署在升级后也适用。
2. `LUCY_WEBUI_AUTH=off` 只允许显式 development 且管理面实际绑定 loopback；客户 Chart、入口脚本及启动预检拒绝 customer+off。不能仅信任请求来源 IP、Host 或反代头来放开鉴权。
3. bootstrap 除 CSRF/Origin 检查外，还需部署侧一次性引导密钥。文件路径由 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE` 指定，使用受控 Secret 投射，不将明文写 ConfigMap、日志、命令参数或页面存储。未配置时 bootstrap 返回 503 `BOOTSTRAP_NOT_PROVISIONED`，不自动生成公开口令。
4. 创建首个 owner 的请求通过 `X-Lucy-Bootstrap-Token` 提交密钥；UI 增加密码型输入，仅在内存持有。校验密钥、重新读管理员配置、写入、消费引导状态在同一进程互斥区内完成；第二个请求返回 409 `ADMINS_ALREADY_CONFIGURED`，不能两次成功。
5. 登录/引导启用有界限速：提案默认每可信来源 30 次/5 分钟，登录账户+来源 5 次失败/15 分钟，bootstrap 来源 5 次失败/15 分钟；超限 429 + Retry-After。记录限制事件；成功登录可清除对应失败桶，不清除来源总量；不做可被他人触发的永久账户锁定。
6. 限速/认证审计存储不可用时返回 503，不能退回无限尝试。桶有 TTL、数量上限；进程重启不清零未到期桶。未知管理员、错误密码统一 401，不暴露是否存在。禁止记录密码/引导密钥。
7. break-glass 必须是受控维护操作，停止对外入口后修复配置；清空管理员文件不能自动重新允许任意人认领。已启用账户的默认角色解析失败必须拒绝，不能升为 owner。
8. 部署形态的固定取值（v0.2 补充，消除实施歧义）：

| 形态 | `LUCY_DEPLOYMENT_MODE` | `LUCY_WEBUI_AUTH` | Cookie `Secure` | 引导密钥 |
|---|---|---|---|---|
| 客户 Helm Chart | 模板写死 `customer`，不在 values 暴露；`extraEnvFrom` 注入的同名变量在启动预检中被检测并拒绝启动 | 不允许 `off` | `security.access=https`（默认）开启；`security.access=http` 是显式内网 HTTP，Cookie 不带 Secure，也不标测试 profile。实验室 `insecureHttpTestProfile` 仍可关闭并在 health 中标注 | Secret 挂载 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE` |
| 本地 demo compose（`deploy/compose/docker-compose.*.yml`） | `customer`（与客户一致，用于真实验收） | required | 关闭（HTTP loopback） | `npm run demo:upgrade -- --fresh` 在已被 `.gitignore` 忽略的 `deploy/compose/secrets/webui-bootstrap-token` 生成随机密钥（0600），各 demo compose 以 file secret 挂载并设 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE=/run/secrets/webui_bootstrap_token`；脚本只打印文件路径不打印内容。平滑升级保留已有管理员，不再要求引导 |
| Vitest / contract 浏览器夹具 | 全局 setup 默认 `development`（未显式设置时） | 默认 `off`，个别 suite 显式设 required 覆盖 | 不适用 | 测试 helper 生成临时文件 |
| 真实 E2E（§6） | `customer` | required | 按目标环境 | runner 受控注入 |

`LUCY_WEBUI_COOKIE_SECURE` 保留为显式覆盖：customer 模式下，`LUCY_WEBUI_ACCESS=http` 或实验室测试 profile 才可以关闭；其余情况设为关闭时启动预检失败。

### 3.2 可撤销持久会话

- 会话格式升级为 v2，签名载荷含 jti、account_uid、session_epoch、iat、exp；随机性至少 256 bit。HMAC 密钥不少于 32 byte，弱旧密钥迁移时轮换。每请求查询持久会话和当前账户状态，安全判断不使用 5 秒管理员展示缓存。
- 提案默认空闲 30 分钟、绝对 12 小时；延长空闲期不突破绝对期限。Cookie `HttpOnly; SameSite=Lax; Path=/`；客户 HTTPS 必须 `Secure`，敏感 API `Cache-Control: no-store`。旧 v1 会话一次性失效，管理员重新登录；不轮换业务 Agent Token。
- 退出先耐久吊销当前 jti，再清 Cookie 并返回成功。密码重置、账户停用/删除、owner/operator 权限变化，先提升 session_epoch 并封禁旧会话再完成配置写入；失败不得恢复更宽旧权限。
- 删除后重建同 id 使用新 account_uid。恢复旧 `admins.yaml` 或旧安全库快照不得复活已撤销会话：受控恢复必须轮换会话密钥/实例会话代次并要求重新登录。
- Session store 不可用返回 503 `AUTH_STATE_UNAVAILABLE`，不当成“没有管理员”。跨配置/安全库写入崩溃时，启动恢复到更严格状态；不报告未完成的操作成功。

### 3.3 MCP 所有方法共用准入与撤销边界

每个 HTTP 请求（包括 GET/DELETE、通知、Resources/Prompts）都验证 Bearer、吊销、过期、Agent enabled、角色解析。sessionId 不代替认证；WebUI Cookie 不代替 MCP Token。初次认证不通过为 401；已认证但停用/已声明角色无法解析为 403，MCP 方法授权失败使用 §4.4 的协议响应。既有合法 legacy direct-allow 身份可继续走其原数据面 ACL；仅上下文动作额外要求正式角色。空身份或未声明有效 direct-allow 不能冒充 legacy。这一区分同时适用于 initialize 的目录过滤，不得从 legacy 握手返回上下文摘要。

只接受明确的 `/mcp` 路径/方法集合，拒绝不支持的 batch/非对象 envelope、未知方法或不支持路径，不能原样带内部 Token 转发。`/mcp/skills` 的旧无对象 ACL passthrough 在客户模式必须保持关闭，启用配置导致启动预检失败。部署许可按 Spec 175 v0.2 删除：不因激活码拒绝任何 MCP 内容通道。将来若新 Spec 恢复许可，各内容通道仍须一致执行同一裁决，不另造授权例外。

下游会话绑定 `(Agent id, Token hash, downstreamSessionId)`，上游 transport session 不再只按 userId 共享。没有 session header 的兼容客户端按 Token 建立独立默认会话；推荐每客户端安装使用独立 Token，不新增 Token 行权限。外来 sessionId 不可复用别人的上游状态/事件。

停用、吊销、角色/对象 ACL 收窄在**成功响应前**提交新版本、取消受影响请求与流、清除相关缓存并关闭会话；内容发送前及 SSE 每块发送前检查授权版本。成功确认之后不再安排新的越权内容写入；已经发送或进入网络缓冲的数据无法撤回，不能宣称会被客户端抹除。扩权需完成有效策略编译后才生效；编译失败保持拒绝，不能回退到可能更宽的旧快照提供上下文。

## 4. Wiki / Skill 权限隔离策略

### 4.1 唯一对象授权与默认拒绝

```yaml
# Skill: 既有字段；域/name 仍是创建后不可变的文件身份
status: published
roles_allowed: [finance_reader]

# Wiki: 显式对象授权；sl_refs 不产生授权
allowed_roles: [finance_reader]
sl_refs: [warehouse/fin/ledger]
```

| 配置 | 对象权限 |
|---|---|
| 字段缺失或 `[]` | 无人可见；管理台受信任管理员仍能维护 |
| 已存在的角色 ID 数组 | 只允许对应角色，同时需要该角色授予动作通道 |
| 精确 `['*']` | 所有有效已分配角色均可匹配；**不是匿名公开**；仍检查身份、通道及 Skill 状态 |
| `*` 与角色混用、非数组、非法元素 | 拒绝保存/导入；运行时对象拒绝，不把损坏解释为共享 |
| 未知/删除角色 ID | 不匹配任何角色；保留并提示修复，不扩权 |
| `visibility: public` 但无 allowed_roles | 无人可见；迁移时必须显式选择角色或 `*` |
| Wiki 目录名 `global` / Skill domain / prerequisites / sl_refs | 均不产生授权；对象共享不得自动授予表/行访问 |
| 无正式角色的 legacy direct-allow Agent | 上下文拒绝 `context_role_required`；提供受控迁移，不通过 `*` 静默绕过角色要求 |

上下文摘要与正文同样受保护。对象被刻意共享时，其内部包含的表名/样例也会被共享，管理员预检需提示正文分级责任；不实现从自然语言自动推断保密等级。表引用无法解析不应偷偷放宽数据权限。

### 4.2 discover / read 与同角色闭合

| 对象动作 | 对应 Role 工具 | 入口 |
|---|---|---|
| Skill discover | `lucy_skill_search` | initialize Skill 目录、resources/list、prompts/list、Skill search |
| Skill read | `lucy_skill_read` | resources/read、prompts/get、Skill read |
| Wiki discover | `wiki_search` | wiki_search 及任何 Wiki 目录/提示注入 |
| Wiki read | `wiki_read` | wiki_read 及任何全文注入/导出 |

存在**同一个角色**同时匹配对象授权与动作工具才允许。Role A 只有工具、Role B 只有对象授权，不能跨角色拼权。多角色只对完整授权分支做 OR。仅 discover 可看允许的摘要，不能取正文；仅 read 可按已知完整 URI/key 读取，不能列目录。initialize 仅注入 discover 允许的摘要，不注入 Skill/Wiki 正文或未经 read 裁决的内容。

不再无条件将四个上下文工具并入全部 Agent。角色工具预设可提供显式通道选择，通道开启不改变对象授权。Meta 降级可用必须以身份/角色/对象 ACL 均可证明为前提；无法证明时拒绝，不沿用 Spec 170 的降级全开放。

### 4.3 管理交互与迁移

- Skill 编辑页恢复“可访问角色”“无人可见”“所有角色可见”，Wiki 编辑页增加相同授权控件；默认无人可见。授权只在对象编辑页修改，Role 详情展示只读 discover/read 效果及通道配置。
- 全角色共享需独立开关及二次确认；预检展示旧/新角色、受影响 Agent、文件版本、是否扩权。未知角色不消失、不自动映射同名新角色。权限保存和内容保存均有版本冲突保护，Wiki 拟新增 `file_version / expected_version`，428 缺失、409 过期。
- 角色删除除既有 Agent 引用检查外，还检查 Wiki/Skill ACL 引用；有引用先显式移除。已删除 Role ID 写入持久退役表，不可复用（新建返回 409 `ROLE_ID_RETIRED`）；创建角色若命中历史未知角色引用则先要求受控清理/确认，不能因创建同名角色意外激活旧 ACL。该规则不增加新的权限类型。
- 现有受信任 operator 可按既有日常权限编辑对象 ACL；迁移批量提交只允许 owner。该设计不宣称双人复核。
- 一次性迁移先扫描合成/目标资产的元数据，输出“可保留 ACL / 缺失或损坏待确认 / 显式全角色 / legacy Agent 待迁移”，只提供 diff，不输出正文或秘密。不得把空 ACL、global 路径或旧 public 自动改成 `*`。
- owner 审阅带 inventoryDigest、角色图版本与每文件 expected_version 的迁移报告后才执行；任一过期拒绝整批预检。批量采用持久操作 journal；失败/崩溃后未确认对象保持 deny。不得称多个文件 rename 为整体原子事务。
- 迁移前备份加密受控保存，不纳入普通 E2E artifact。缺 ACL 在安全版本上立即 deny；客户上线门禁要求没有未处理的迁移项，并将无人可见的有意选择也记录为已确认。
- 安全版本不得提供“恢复 Spec 170 全开放”的兼容开关。不能直接回滚到会忽略 ACL 的旧镜像；只能回滚到通过相同安全回归的构建，或先隔离入口再恢复。

- 仓库内置模板（v0.2 补充）：当前 14 个模板 Wiki（`examples/{docker-demo,postgres-demo,executive-poc}/project-template/wiki/**`、`customer-config.example/config/wiki/**`）与模板 Skill 均无 `allowed_roles` / `roles_allowed`，R1 生效后全部无人可见，会导致 `smoke:p0:demo`、`smoke:p0:postgres-demo` 与 POC 演示失败。与 R1 同一提交为每个模板对象写入显式 ACL（按该模板 `access.yaml` 中实际角色逐一指定；仅确属公共口径的使用 `['*']` 并在提交说明中列出），并让上述 smoke 断言“授权角色可读 / 无授权角色不可读”各至少一例。模板 ACL 是仓库内容变更，不属于客户迁移，不经 §4.3 迁移工具。

迁移 pending 只表示尚未确认的 legacy 存量及其变动，不把正常新增资产永久列为迁移项。新 UI 的一次显式保存（包括确认无人可见）通过 expected_version 与可信审计后即有明确授权状态；只改正文、ACL 未变，不要求重新执行全库迁移。

### 4.4 非泄漏响应、缓存和导出

对按 key/URI 指定的未授权、不存在、草稿/停用对象，对外使用同形 `context_not_available`，JSON-RPC error `-32003`（工具兼容形态使用 `isError:true`）；具体内部原因只进受保护审计。合法 discover 可以显示其明确授权摘要，read 仍独立裁决。列表只按授权后集合计数/分页，不暴露全局总数、标题、版本或搜索命中。

所有方法只调用一个 `authorizeContext(identity, asset, action, snapshot)`。缓存键至少包含 Token/身份代次、完整角色通道权限版本、policyVersion、contextPolicyVersion、action；游标绑定同一权限快照。禁止先全局缓存敏感正文再只按 URI 命中。ACL 收窄、停用和文件版本变化即时失效；受保护响应 no-store。

Agent 侧导出、初始化目录、补全、错误建议和任何未来资源入口均走同一裁决。管理侧完整资产快照属于受信任管理员能力，必须认证、记录导出对象与操作者且排除凭据/安全状态库；不得把管理导出链接作为 Agent Token 的绕过通道。

### 4.5 文件读取边界

Wiki 与 Skill 读取、导出、导入后的读取统一使用 fs-safe realpath/lstat 防护；拒绝任一层目录/入口 symlink，拒绝遍历、编码变体与路径逃逸。读取使用安全打开与打开后身份检查，防止检查后被替换为链接；夹具中用根外合成 canary 验证，禁止测试真实 secret 内容。保持 Skill 身份不可变与并发版本规则。

### 4.6 Frontmatter 解析安全（V-08，P0）

现状：`webui/server/wiki.ts` 以默认参数调用 `gray-matter`，其内置 `javascript` 引擎会对 `---js` / `---javascript` frontmatter 执行 `eval`。上传预览、上传提交、编辑预览/保存、读取、版本标题/摘要、版本恢复、移动共 8 处调用均可触发；`previewWikiUpload` 无需写盘即执行。Skill loader 与 MCP `wiki-acl.ts` 已使用纯 YAML 解析，不受影响。

要求：

1. 全仓库只保留一个 frontmatter 解析入口 `parseMarkdownFrontmatter(text)`（建议位于 `webui/server/markdown-frontmatter.ts`），仅接受 `---` 后无语言标记或语言标记为 `yaml` 的块，用 `yaml` 包安全解析；其他任何语言标记（`js`、`javascript`、`json`、`coffee` 及大小写/空白变体）抛出 `FRONTMATTER_ENGINE_FORBIDDEN`。
2. API 面对上传/保存返回 400 `WIKI_FRONTMATTER_UNSUPPORTED`，用户文案为“仅支持 YAML 格式的文档属性”；读取已在磁盘上的非法文件时返回 422 并在管理端标记为需修复，**不得**回退到执行或忽略后继续解析正文中的属性。
3. `wiki.ts` 中所有 `matter()` 调用替换为该入口；保留 `gray-matter` 依赖仅当仍需其 `stringify` 时，且 stringify 不经过 JS 引擎。CI 增加静态检查：`webui/server` 中出现 `from "gray-matter"` 且不在该入口文件内即失败。
4. 配置包导入、版本恢复、`examples/*/project-template` 播种的 Wiki 同样经过该入口；播种遇到非法 frontmatter 时 entrypoint 失败并给出文件名，不静默跳过。
5. 验收：SEC-15 新增子场景 `SEC-15-FM-01～06`，分别覆盖上传预览、上传提交、编辑保存、读取、版本恢复、配置包导入；载荷集合含 `---js`、`---javascript`、`---JS`、`--- js`、`---json`；断言为服务端零执行（进程内探针未被设置）+ 明确 4xx + 无写盘。合法 YAML 对照必须成功。

## 5. 审计可靠性、身份与隐私

### 5.1 先持久、后释放

选用现有 SQLite 运行栈新增本地安全账本，WAL + `synchronous=FULL`，无新增队列服务。对所有 MCP 内容/元数据响应、管理敏感读/导出、认证成功、授权变更执行耐久记录。health/help/静态资源等明确公共恢复路径不依赖内容审计；审计不可用时的拒绝可降级到有界脱敏错误日志，但不允许返回敏感内容。

对读取：准入通过后写 `request_admitted`，执行真实调用并在有界缓冲区得到响应，重新验证授权版本，耐久写 `response_prepared`（outcome、行列摘要/响应摘要哈希、所用对象版本），再发出内容。该事件表示“已准备并获准发送”，**不假装证明客户端已经收到**。正常发送后追加 terminal 事件；崩溃留下未完成操作，重启补记 interrupted，不重发原内容。

v0.25 增补：每个逻辑入口登记 `endpoint_id`、传输类型、监听地址与用途；MCP 与管理端口并存是合法部署形态。恢复扫描以 canonical ledger 的持久前缀为准；上游可能已执行而结果无法核验时保留 `indeterminate` 并进入只读凭据核对，禁止为补日志自动重放业务。SEC-19 的耐久屏障与性能预算不变。

流式响应若无法在块发送前完成对应持久记录与版本检查，本期不得直接透传敏感 SSE；采用有界缓冲后输出协议 SSE。超限/超时明确失败，不静默截掉后声称完整。所有支持客户端必须用真实传输验证；客户端协议兼容不能成为跳过审计的理由。

草案初始上限：MCP 请求 1 MiB、单响应缓冲 8 MiB、上游墙钟 30 秒、安全账本单次提交等待 2 秒；测试覆盖恰好上限和超限。配置可以收紧，放宽必须在 release profile 预先冻结并通过资源/拒绝场景，不接受请求参数覆盖。管理 CSV/zip 沿用既有条数/大小约束，先生成并校验安全文件及摘要，再以有界块发送，不为导出把全部文件无界载入内存。

审计 prepare/commit 失败返回 503 `AUDIT_UNAVAILABLE`（未发 headers 时），终止已开始流且不再发送内容；已有 query 可能已在只读数据库执行，但数据不得继续释放。不得 fallback 到无审计成功。日常可用性取舍在 §10 确认。

性能预算（v0.2 补充，T07 验收条件）：在开发机与客户目标规格各自基线下，审计前置使 MCP `tools/call`（不含上游执行时间）与 `resources/read` 的 p95 额外延迟 ≤ 20 ms、p99 ≤ 50 ms；并发 16 个客户端持续 5 分钟无 `SQLITE_BUSY` 导致的 503。超出预算时先优化（单事务合并 admitted/prepared、预编译语句、WAL checkpoint 策略），不得以放宽耐久语义达标；仍无法达标须回到 §10 R2 重新决策。

### 5.2 写操作、认证事件与投影

配置写：带可信 actor 的 durable intent → 安全文件写/策略编译 → durable committed/failed → 成功响应。跨文件失败启动恢复并阻断受影响范围，禁止将 pending intent 算成成功。密码重置/撤销先落安全收窄状态，文件失败也不恢复旧会话。

认证事件至少覆盖 bootstrap、login success/failure/rate-limit、logout、密码轮换、账户停用/删除、角色/Token/上下文 ACL 变更。身份取 request 的已验证 context，不能取 body.actor、User-Agent、设备名或转发头。保存 socket peer 与仅供展示的 forwarded chain；只有来自配置的可信代理地址且入口剥离外来 forwarded 头时，才接受可信 client IP。不再仅以全局 `LUCY_TRUST_PROXY=1` 信任任意来源。

现有 access_log/config_change_log/trace/CSV/zip 由幂等 projector 更新。投影失败不会丢失已提交 ledger 事件，游标和目标更新以目标库事务提交，重试不重复计数；UI/API 显示 `complete=false` 与延迟，不能把旧结果说成完整。敏感读依赖 canonical ledger 健康；上线验收要求 projection backlog 清零、导出对账一致。内部库不能通过通用 SQLite 连接配置或运维问数被读出会话状态。

### 5.3 最小记录、历史与保留

- 写入前按事件 allowlist 脱敏；禁止密码/密码哈希、完整 Token/Cookie、引导密钥、连接秘密进入 Diff、summary、错误栈、trace 或导出。密码轮换只记布尔状态。不能只在 CSV 展示时掩盖数据库原文。
- 普通配置审计记录脱敏 diff、对象版本/内容摘要；不重复存完整敏感 Wiki/Skill 正文。SQL hot store 默认显示脱敏文本；确需原始 SQL 诊断走现有加密 cold store 的显式管理流程，不能让普通查询参数绕过脱敏。
- 历史 scrypt/凭据副本扫描先给数量与摘要，受控备份后清理；记录维护事件和前后摘要，旧备份按保留策略隔离/销毁，禁止声称清理当前库就清除了全部历史备份。
- 提案安全事件默认保留 180 天，可按客户合同提高；会话过期记录按到期后 30 天清理；问题原文沿用现有更短脱敏保留规则，不扩大为 180 天。过期维护不得删除未完成迁移/未投影事件。
- 导出附清单、条数、过滤条件、时间窗、文件哈希与可信 runner 来源；可发现缺件/篡改，不宣称能够抵御已控制主机者重写所有本地文件。客户若要求 SIEM/WORM，在部署验收 profile 中显式列为 required，未接通为 blocked。

## 核心流程（伪代码）

```text
handleBootstrap(request):                                 # SEC-01/02/05
  enforceCustomerModeAndOrigin(); throttle(request)
  with bootstrapMutex:
    cfg = loadAndValidateAdminsFreshOrUnavailable()
    if cfg has enabled account: return 409
    verifyOneTimeDeploymentSecretOrDeny()
    persistIntentAndBootstrapInProgress()
    createOwnerWithNewAccountUID(); durableConsumeBootstrap()
    commitOperation(); return createDurableSession()
  # crash/partial write => recovery-required, never reopen or report success

authenticateAdmin(cookie):                                 # SEC-03/04/08
  claims = verifyV2Signature(cookie) else 401
  session, account = securityStore.lookupFresh(claims) else 503
  if revoked/expired/idleExpired/tombstoned/disabled/epochMismatch: 401
  cfg = freshValidatedAdminByUID(account.uid) else deny/unavailable
  return trustedRequestActor(cfg, session)

admitMcp(request):                                        # SEC-07/08/12/21
  validatePathMethodAndSingleRpcEnvelopeOrReject()
  identity = verifyBearerFresh() else 401
  if disabled or declared role resolution failed: return 403
  if no assigned role and no valid existing legacy direct-allow: return 403
  bindSessionToTokenAndAgentOrDeny()
  enforceConfiguredLicenseAndOrigin()
  return identity + pinnedPolicyAndContextGeneration

authorizeContext(identity, asset, action, snapshot):        # SEC-10/13/14
  assert identity still enabled, token active, roles valid
  if asset missing/unsafe/invalidACL or unpublishedSkill: deny internalReason
  grants = canonicalExplicitRoleList(asset)  # missing/empty => deny
  tool = requiredChannel(asset.kind, action)
  for role in identity.assignedRoles:
    if (role.id in grants or grants == ['*']) and role grants tool:
      return allow(matchedRoleId=role.id, version=snapshot.version)
  deny internalReason; outwardResponse = context_not_available

releaseSensitiveResponse(operation):                      # SEC-17/18/19/21
  durableAppend(request_admitted) else 503
  response = executeAuthorizedReadWithBoundedBuffer()
  with authorizationSendBarrier(operation.identity):
    recheckCurrentAuthorizationAndAssetVersions() else discard+deny
    durableAppend(response_prepared, sanitizedSummary(response)) else discard+503
    sendAuthorizedContent(response)
  appendTerminalOrRecoverAsInterrupted(); projectIdempotently()

narrowAuthorization(change):                              # SEC-04/07/13
  with affectedIdentitySendBarrier:
    durableIntent(); persistNarrowingEpochOrRevocation()
    cancelAffectedRequestsAndStreams(); invalidateSessionsAndCaches()
    commitValidNarrowedPolicyOrBlockAffectedScope()
    durableCommit(); acknowledgeSuccess()
```

## 6. 真实用户 E2E 设计与脚本契约

### 6.1 三层证据不可互替

| 层级 | 执行方式 | 能证明什么 |
|---|---|---|
| contract | 单测、模拟 API 浏览器、KTX shim | 组件/规则/脚本回归，不能签用户 E2E |
| security-integration | 当前 Lucy + 真实 HTTP/SQLite + 合成真实 DB；安全攻击直接调用协议 | 控制不可由 Agent 的自律替代，能稳定测所有拒绝分支 |
| user-e2e | 真实桌面浏览器管理 + 实际产品客户端/模型 + Lucy/KTX + DB + 持久审计 | 本次 UI 配置能被真实用户使用并得到有权限的正确结果 |

安全直接协议测试与真实 Agent 负例都要做；只让模型说“拒绝”不算服务器控制通过。gold 不得注入 Agent prompt，也不让 Agent 直接读数据库、测试源码/gold 或测试控制端。

### 6.2 合成数据与环境身份

新增正式夹具目录 `examples/security-e2e/`，包括 project-template、受限 DB seed 和独立 gold 计算器；运行目录为 `inbox/e2e/<runId>/`。严禁复制私有真实配置/生产数据，禁止从真实 `.ktx/secrets/` 取材。所有 CLI/本地脚本兼容 stock bash 3.2。

基础 fixture 含 finance/sales 两域、owner/operator、独立 Agent 与 Token、同名 source 的两个连接、East/West 授权行、PII 合成列、共享/限制/无授权 Wiki、已发布/草稿/停用 Skill。每 run 随机种子产生唯一 canary 和金额，checker 用固定算法计算 gold，测试可复现；输出只保留 seed/hash 与脱敏摘要，不泄漏有效凭据。

checker 按每个 case 的身份与对象定义 allowed/forbidden canary 集合：合法对照必须能返回其授权 canary，越权变体禁止返回域外 canary；不能把“全部请求都失败/全删内容”判成零泄漏通过。生产业务 gold、fixture seed 与原始测试数据库只可被隔离 checker 读取，不进入客户端工作目录。

隔离必须由独立 OS 身份/VM 或等效权限与网络规则落实，不能只靠 prompt 要求 Agent 不读文件；在正式题前用同一客户端实际探测 gold/DB/测试控制端不可达，失败即 blocked。原始敏感采集只在内存处理，脱敏后才写 disk artifact。

每次先核对实例 id、candidate digest、content root、fixture digest 与 runId。禁止复用未知现有服务；fixture 重置只允许本 run 目录且校验 realpath。变更场景每 suite 独立数据卷或串行执行，不能多个浏览器共享可写 fixture。客户 release 在实际候选 **linux/amd64、单副本 K8s** 上跑；Mac/Compose 只提供开发证据。

真实 RLS 必须在当前候选 KTX+真实 DB 上证明行集/聚合 gold，不能靠 mock AND 或单个 `PROVEN=true` 环境变量。只读账号、出站网络与客户端隔离由测试部署验证。

### 6.3 多平台与真实客户端

新增版本化 `docs/qa/real-e2e-clients.yaml`，列出产品客户端、真实接入方式、版本、OS、adapter、支持的协议/认证、required 与用例集合。**首发 required（2026-10-18 owner 确认 v5）**：
- **自动分母**（`execution: automated`）：Claude Code CLI + OpenClaw CLI（`transport=cli`），由 runner 执行，每产品每场景 3/3。Codex CLI 已放弃自动验收，仅 optional。
- **人工分母**（`execution: manual`）：WorkBuddy GUI + Cursor Agent GUI，**永远人工执行**；客户 GO 仍 required，证据为 checklist pack（缺包 = blocked）。
不能在 CI 失败后删 required 来变绿。

同一 Hermes 的两个 profile 不算两个产品；直接 HTTP 脚本不算真实客户端；CLI adapter 仅能证明其实际执行的 CLI 路径，不能冒充桌面 UI。认证方式不支持时报告 blocked，不绕到 KTX stdio/7878。

GUI 客户端用其真实 UI 操作/受控自动化导入从 WebUI 复制的配置并发问；可保留受信任执行者记录作为 GUI 证据，但必须同时有服务端 Trace、随机 gold 和签名采集记录。配置中每客户端独立测试 Token，Agent 权限仍由各自 Role/Constraints 决定。

### 6.4 拟新增脚本与接口（均尚未实现）

| 入口 | 责任 / 不可省略的参数 |
|---|---|
| `scripts/e2e/prepare-environment.mjs` | 校验/部署隔离 fixture；写 run.json；release 必须 `--candidate <identity.json> --profile <profile.yaml> --run-id <id>`，拒绝真实私有项目目录 |
| `webui/playwright.real.config.ts` | 只连已核实实例，1440×900 桌面 Chromium，auth required，禁用 API mock/KTX shim；后续浏览器兼容按 profile 明确加入 |
| `webui/tests/real-e2e/management-journey.spec.ts` | 从受控 bootstrap/登录开始，UI 接入、启用表、维护上下文/权限、同步索引、建 Agent/签发 Token、复制配置、检查审计；敏感步骤关闭截图/trace 参数采集或可靠脱敏 |
| `scripts/e2e/run-security.mjs` | 执行 SEC-01～23 的机器可重复攻击与故障变体；采集明确 deny、DB 只读执行计数及输出 canary 扫描 |
| `scripts/e2e/run-agent-journey.mjs` | 驱动已登记真实客户端；每客户端跑 UX-02～05，各 3 次独立运行；收集多轮/失败/版本体验。参数不允许传 gold 或命令明文 Token |
| `scripts/e2e/adapters/<client>.mjs` | 固定受审阅 adapter，与实际客户端原生配置匹配；报告 binary/version、model、session 与退出状态；任意可执行 shell 字符串不作为真实性证明 |
| `scripts/e2e/collect-server-evidence.mjs` | 使用隔离实例受控管理员身份读取本 run 服务端账本/trace，核对 Token 指纹、case/时窗/版本；本工具无 API mock 和自造 trace fallback |
| `scripts/e2e/verify-evidence.mjs` | 校验完整 schema、候选身份、固定分母、每 case 关联、权限/正确性/隐私断言及产物哈希；只能对通过的 execution 产出可消费 pass |
| `scripts/gates/customer-release-readiness.mjs` | 唯一客户上线聚合门禁，消费上述证据及既有 runtime/架构/K8s/依赖 gate；不根据 stdout 关键词判状态 |
| `scripts/e2e/archive-evidence.mjs` | 脱敏、哈希、可信 runner 签名/来源归档；临时 inbox 不作为唯一长期凭证；不得下载/打包未审查原始 trace |

建议 npm 入口：`e2e:real:prepare`、`e2e:real:management`、`e2e:real:security`、`e2e:real:agent`、`e2e:real:verify`、`gate:customer-release`。旧 `e2e:release` 明确改名/标注为浏览器 contract 回归，避免误认为已包含真实 Agent。旧 Agent harness 更新默认 content root、Role Set 与新 ACL，无真实查询时不得通过。

### 6.5 标准用户剧本 J-01

1. owner 从受控引导创建账户；添加 operator，operator 通过正常登录进入。未经认证的并行浏览器不可读写管理数据。
2. operator 在 UI 新建合成 DB 连接、真实连接测试、选择 Schema/启用表、读取/上传 Manifest；失败探测不写坏原配置。
3. 在 UI 维护一个比率度量、Wiki 口径、已发布 Skill，设置 finance/sales 的对象 ACL；保存预检、冲突检查、同步索引；发布记录需关联真实操作者。
4. 在 UI 建正式角色和 Agent，签发两套客户端 Token。测试控制器只在内存接收一次性明文，复制真实 MCP 配置至登记客户端，敏感步骤不得写入未经脱敏的 Playwright trace。
5. 两个真实产品客户端分别新开会话，以用户原话提问“最近获客成本是多少、默认口径是什么”；由 Agent 自主检索 Wiki/Skill、查语义数据，返回正确 SUM/SUM、日期与来源，不由 runner 代替选择工具。
6. 在同会话追问、跨域请求、注入文档指令、空/NULL/零、超时/截断、版本恢复情形下检查答案与服务端裁决；随机数据不得来自 prompt 或旧缓存。
7. UI 收窄权限/停用 Agent/吊销其中一个 Token；旧新会话所有通道按 §3/§4 失败，另一个同权有效 Token 按现行授权正常使用。
8. owner/operator 查询访问日志与配置审计并导出 CSV/zip，对上本 run 的服务端事件、版本与结果；执行故障恢复、清理测试 Token、归档脱敏证据。

## 7. 完整验收矩阵

以下沿用评估中的 32 个场景 ID，批准后成为版本化必测清单。每行必须展开为具体 case/协议/身份/客户端/引擎变体，在运行前冻结 case IDs 与分母；不是“32 条断言通过”即完成全部组合。原评估中的待写用户旅程必须映射到这些可执行用例，不留下 ADM 撤销/审计占位。

执行器：B=真实浏览器；P=直接协议/HTTP；D=真实 DB；A=真实 Agent 产品客户端；O=运维/故障；V=证据校验器。P/O 的合成攻击不伪装为用户自然问答。

| ID | 场景 / 执行器 | 必须成立的核心断言 |
|---|---|---|
| SEC-01 | 默认管理认证 B/P/O | 空/缺失/损坏/无启用账户不进入 open；匿名实际写入无副作用；客户 off 拒启动 |
| SEC-02 | 引导密钥与并发 B/P | 无/错/已消费密钥拒绝；两个同时首建恰好一个成功、其余 409；崩溃不重新公开引导 |
| SEC-03 | 管理职责 B/P | operator 不能增删/重置登录账户；日常已授权操作成功；body.actor 无法冒充 owner |
| SEC-04 | 会话回收 B/P/O | 退出、密码/角色变化、停用、删除再建、重启/恢复后旧 Cookie 均拒绝；idle/absolute 到期；缓存无旧内容 |
| SEC-05 | 认证失败/限速 P/O | 统一错误、达到阈值 429、Retry-After、重启不清桶、无口令日志、真实 actor/IP 与 rate-limit 事件可查 |
| SEC-06 | Token 一次性展示 B/P/V | 明文只在受控一次响应出现；再次加载不返回；URL、存储、argv、日志、截图/trace、导出不泄露 |
| SEC-07 | 过期/吊销/停用 B/P/A | 先 allow 后从 UI 收窄；旧新会话 tools/resources/prompts/GET/DELETE/通知均正确拒绝或关闭；无新 canary 发出 |
| SEC-08 | 错误身份 P | 匿名/假 Token/管理 Cookie/外来 sessionId 不可充当 MCP 身份；JSON-RPC 非法/batch 不被转发 |
| SEC-09 | 连接/表/同名 source P/D/A | 合法控制查询成功；连接别名、物理名、跨库同名均不越权；拒绝建议无域外目录/数据 |
| SEC-10 | Role Set P/D | 同角色闭合；工具×来源不放大；A 有通道/B 有对象不可拼权；多角色正确 OR/Constraints AND |
| SEC-11 | 真行集 P/D | 复用 BY-01～19；当前 KTX/DB 的行集与聚合均落在强制域；mock 或 proven 标志不代替 gold |
| SEC-12 | 绕过输入 P/D | raw SQL/expr/字符串 filter/join/别名/子查询/Unicode/注释/伪 forced/envelope；明确拒绝原因、未授权上游执行数为 0 |
| SEC-13 | 策略/启用表变化 B/P/O | 新表不自动扩权；收窄发送屏障有效；ACL 损坏/编译失败不回退全开放；恢复不扩权 |
| SEC-14 | 上下文隔离 B/P/A | ACL 缺失/空/单多角色/未知角色/*/legacy/public；发现/读取分离；所有通道、元数据、导出结果一致 |
| SEC-15 | 文件内容供应链 P/O/B | 多层 symlink/检查后替换/路径编码/恶意 frontmatter/Markdown/XSS/超大对象均受控；只用合成外部 canary；`SEC-15-FM-01～06` 按 §4.6 验证非 YAML frontmatter 零执行 |
| SEC-16 | 间接提示注入 A/P/D | 在 Wiki/Skill/数据单元格放注入；不能读取域外 canary、秘密或调用未授权工具；受控出站 sink 无未授权内容 |
| SEC-17 | 全载体泄漏 V/P | JSON/SSE/错误/SQL hot/cold/日志/浏览器/CSV/zip/测试产物扫描；无密码哈希、凭据或域外 canary |
| SEC-18 | 可问责审计 B/P/V | 两管理员、两客户端/Agent 的事件身份、session、server trace、policy/context 版本、时间对得上；UA/forwarded 伪造不改权限/可信 actor |
| SEC-19 | 审计故障 O/P | 磁盘满/只读/锁/提交失败/崩溃；内容释放前必有 durable prepared；投影断开可恢复、不漏不重；不伪造 delivered |
| SEC-20 | 导出/保留/历史 B/P/O/V | 同时间窗过滤分页与 UI/双 CSV/zip 一致，无孤儿；公式注入受控；历史哈希清理、保留维护与备份恢复可验证 |
| SEC-21 | 会话跨 Token/客户端 P/A | A 不能取 B 的 session/事件；同 Agent 不同 Token 同权但 transport/问询不串；取消、重连、丢 session header 正确 |
| SEC-22 | 客户网络 O/P/B | TLS/Secure/HSTS/Origin/CSRF/可信代理；7878 无直接入口，旧 skills passthrough 关闭；合法 native 无 Origin 兼容且仍鉴权 |
| SEC-23 | 依赖与交付 O/V | 当前生产依赖 high/critical 未处置数为 0；Secret 不入包；安全库不被通用 SQLite/运维连接读取；G1–G4 ELF/架构契约不弱化 |
| UX-01 | J-01 管理到使用 B/A/D | 全链路同实例、真实写入/索引/查询；UI 用 auth required，不 mock；发布版本与问答来源一致 |
| UX-02 | 业务正确性 A/D | 独立 gold 校验金额/行数/比率/SUM-SUM、日期锚/时区、实际预测和版本；不只查数字短语 |
| UX-03 | 空/NULL/0/失败 A/D/O | 区分结果类别、不得编造或静默换题；超时/重试/截断/取消可理解；部分结果不冒充完整 |
| UX-04 | 多轮/发布与恢复 B/A/D | 同会话日期粒度不漂移；发布后新旧会话按实际版本查数；恢复后语义/hash/gold 对得上 |
| UX-05 | 多产品一致性 A/V | 每个 required 产品 3 次独立运行；相同角色/问题满足相同业务及安全断言，不要求措辞相同 |
| UX-06 | 离线 Eval B/P/D | 下载→指定角色真实跑批→上传完整结果→趋势；hash mismatch/不完整/错误 runner/无角色阻断，版本变化待复核 |
| UX-07 | 现场提问/安全候选 B/P | 真实权限拒绝与口径失败进入各自池；角色绑定、审定/晋升可追溯，无客户过滤值泄露 |
| OPS-01 | amd64 K8s 新装/升级/恢复 O/B/P/A | 同一候选 digest；N-1 PVC 升级保留 Token 吊销/权限/审计，管理员按迁移重新登录；恢复不复活已撤销会话 |
| GATE-01 | 门禁反向测试 V | 500/超时/blocked/skip/dry-run/缺真实 query/伪 Trace/旧证据/错 digest/缺客户端/被篡改分母全部禁止 READY |

为避免把最新功能藏在大场景标题下，下列 required 子场景必须在 case catalog 显式编号并进入分母：

- **SEC-09/12**：`discover_data`、`dictionary_search`、`entity_details`、物理表别名与歧义修复提示逐一检查，拒绝建议只能含当前授权对象；未知 tool 仍 AbsoluteDeny。
- **UX-02/04**：内建度量 `count(*)/count(1)` 引导、嵌套聚合拒绝、同名字段消歧、中文度量；认证路径与报告模板使用原查询 ACL，不扩大来源，模板/口径/实际预测版本与审计 appliedVersion 一致；模板错误/权限拒绝不静默改题。
- **UX-03**：问询预算耗尽、一次继续、查询并发上限、取消、超时重试、空结果与慢调用；不能绕过预算无限循环，失败后释放执行槽，合法后续请求可继续。既有阈值沿用 Spec 162，不在测试中临时调宽。
- **SEC-18/20、UX-07**：Spec 172/173 的“先调用后上报问题”补绑、不同客户端/会话不并簇、一次原始问询不重复生成为推断问询、初始化/发现探测不虚增业务问询；调用监控/使用概况的窗口、慢标记、eval 排除与真实事件对账。
- **SEC-15/17/22**：品牌图片/Markdown 的脚本载荷不执行；管理快照、Skill 客户端导出与下载链接权限/过期行为按 API 契约验证；正常品牌与导出功能有 allow 对照。Spec 175 v0.2 删除部署许可后，激活码缺失或过期不列入拒绝分母。将来若新 Spec 恢复许可，inactive/expired/invalid 仍须在全部 MCP 内容通道一致，不能只测 tools/call。

## 8. 上线强制门禁与证据

### 8.1 固定证据契约

新增 `lucy-real-user-e2e-v1` schema，至少包含以下结构；占位示意不是已生成的通过证据：

```json
{
  "contract": "lucy-real-user-e2e-v1",
  "executionMode": "release",
  "stub": false,
  "runId": "<server-correlated unique run>",
  "candidate": {"gitSha":"<full>","treeDigest":"<sha256>","imageDigest":"sha256:<digest>","platform":"linux/amd64","ktxVersion":"<actual>","chartVersion":"<actual>"},
  "environment": {"instanceId":"<actual>","topology":"single-replica-k8s","fixtureDigest":"<sha256>","profileDigest":"<sha256>","caseCatalogDigest":"<sha256>"},
  "clients": [{"product":"<required product>","version":"<actual>","adapterDigest":"<sha256>","model":"<actual>","transport":"<actual>","required":true}],
  "summary": {"required":1,"executed":1,"passed":0,"failed":0,"blocked":1,"skipped":0,"dryRun":0},
  "cases": [{"id":"<catalog variant>","status":"blocked","serverTraceIds":[],"queryEventIds":[],"policyVersion":"<actual>","contextPolicyVersion":"<actual>","assertions":[],"artifacts":[]}],
  "status": "blocked",
  "releaseReady": false
}
```

真实 case 还须记录开始结束时间、授权 Token 指纹/Agent、gold 与结果摘要哈希、上游调用证据、发现/读取版本、评分明细/失败类别、artifact digest、canonical 审计 eventId 及投影关联。数据题至少一个真实成功 query 与最终答案对应；拒绝题必须符合批准的 deny 原因、未授权上游执行为 0、全响应无泄漏。未调用查询而答对不算通过。

serverTraceIds 必须去同一实例账本/Trace 读取并核对 Token/case/时窗/版本，禁止 runner 补造 ID、用 requestId 冒充 Trace 或只信任 Agent 文本。caseId/runId 仅相关信息，不参与授权。

case catalog 在运行前冻结全部 required 变体，分母不可剔除。安全负例和关键业务题均要求全部通过；Agent 每 required 产品/业务场景固定 3 次，保留首跑与全部重试，不能靠重试到成功抹去失败。数值容差逐题指定（金额默认分、整数精确、排序 tie 规则固定），无全局宽容匹配。

### 8.2 状态与退出码

| 状态 | 退出码 | 可作为上线通过 |
|---|---|---|
| `passed` | 0 | 仅完整 release execution，且所有条件满足 |
| `failed` / schema 或契约错误 | 1 | 否 |
| `blocked`（环境/客户端/凭据缺失等） | 2 | 否 |
| `skipped` / `dry_run` / 仅收集计划 | 3 | 否 |
| `--list` | 0，独立输出 | 只列清单，不写 release evidence |

CLI 返回码与 JSON 不一致即契约失败；不以 stdout 词语识别状态。`--allow-blocked` 只兼容映射为 collect，不得返回可发布 0；最终发布入口拒绝 collect/dry-run 证据。静态 lint 等旧 gate 如无统一 JSON，由有 schema 的 wrapper 记录退出码/产物身份，不能把访问 401 当业务执行通过。

### 8.3 CI / 发布接线

```text
spec/unit/selector/dependency + existing platform checks
        -> build candidate once (linux/amd64; record digest)
        -> G1–G4 + ELF + G4b/G8 + Helm/PVC gates on same digest
        -> deploy candidate to isolated single-replica K8s
        -> security-integration + real desktop management journey
        -> all required actual product clients + business/negative journeys
        -> collect server evidence + leakage scan + verifier
        -> customer-release-readiness
        -> promote exact tested digest + attach signed evidence + customer package
```

候选镜像可先进入受限 staging registry 供验证；客户发布 tag、正式包和 verified 状态只能在最终门禁后产生，不能门禁后重建。`.github/workflows/lucy-release.yml` 中所有客户发布分支（含 native amd64 与 release-package）都需依赖统一 release-readiness；protected runner 可执行 GUI/真实模型，未准备好即 blocked，不能退化为 headless smoke。

现有 workflow 中名为 `demo-e2e` / `postgres-demo-e2e` 的 job 实际只运行 `smoke:p0:demo` / `smoke:p0:postgres-demo`，须改名为 `demo-db-smoke` / `postgres-demo-db-smoke`，避免被误读为 E2E 门禁（v0.2 补充）。

新增 required check `customer-release-readiness`。PR 默认跑快速 contract/安全回归；安全相关变更增加协议集成。完整真实客户端 E2E 是**每个客户候选版本上线前必过**，不强迫每次普通开发任务启动浏览器/模型；nightly 提早发现问题但不替代候选验收。版本/Chart/安全配置或候选镜像变化，证据失效重新执行。

长期归档：可信 CI artifact 存储或客户受控离线 evidence 目录，默认 180 天或合同更长；manifest 覆盖所有产物 SHA-256，附可信 runner 签名/CI provenance，验证受信任签发者。顺序固定为内存采集→脱敏持久化→泄漏扫描→生成文件哈希→验证→签名归档；签名后禁止继续修改/脱敏文件，变化即重算并复验。仅在文件里写 `stub:false` 或客户端自报名称不构成真实性。旧 SOW 打包器也必须调用同一 verifier，拒绝混装不同 runId/候选的 inbox 文件。

### 8.3a 安全缺陷登记（机器可校验事实源，v0.2 补充）

§8.4 中 `P0/P1 unresolved == 0`、`dependencyHighCriticalUnresolved == 0`、`contextMigrationPending == 0` 必须由版本化文件裁决，不靠人工口述：

```yaml
# docs/qa/security-findings.yaml
version: 1
findings:
  - id: V-08
    severity: P0          # P0 | P1 | P2
    status: open          # open | fixed | accepted_risk
    spec: "§4.6"
    fixedIn: null         # 修复提交 SHA（status=fixed 必填）
    verifiedBy: []        # 证据中的 case variant id（status=fixed 必填，须出现在本次 release evidence 且为 passed）
    acceptedBy: null      # 仅 P2 可 accepted_risk，需 owner 姓名与日期
dependencies:
  - package: fast-uri
    severity: high
    status: open          # open | fixed | not_reachable
    rationale: null       # not_reachable 必填可复核说明
```

规则：P0/P1 只能 `open` 或 `fixed`，不得 `accepted_risk`；`fixed` 的 `verifiedBy` 必须全部在本次 release evidence 中为 passed；依赖 high/critical 只能 `fixed` 或附可复核说明的 `not_reachable`。verifier 读取该文件与 `npm audit --omit=dev --json` 的实际结果交叉比对，文件缺项即 FAILED。初始内容按评估 v1.1 的 V-01～V-08、D-01～D-02、G-01～G-05 与依赖条目填写。

### 8.4 决策算法

```text
verifyRelease(candidate, frozenCatalog, evidence):          # GATE-01
  validateSchemaAndTrustedRunnerProvenance() else FAILED
  assert executionMode == release and stub == false
  assert candidate identity == deployed identity == all evidence identity
  assert customer platform == linux/amd64 and topology == single-replica-k8s
  assert caseCatalogDigest/profileDigest match approved frozen inputs
  assert expectedRequiredVariantIDs == executedRequiredVariantIDs (no omission/dup)
  assert requiredCount > 0 and every required client/product executed
  assert no required status in [failed, blocked, skipped, dry_run]
  verifyEveryArtifactHashAndEveryServerTraceBinding()
  verifyActualQueriesGoldDenyReasonsNoLeakageAndAuditReconciliation()
  assert P0/P1 unresolved == 0 and dependencyHighCriticalUnresolved == 0
  assert contextMigrationPending == 0 and projectionBacklog == 0
  assert all existing customer runtime/ELF/K8s gates passed on same digest
  return {status: passed, releaseReady: true}
  # any absent dependency => BLOCKED; behavior/assertion/identity mismatch => FAILED
```

## 9. 安全迁移、分批交付与回滚

0. **A0 热修复（v0.2 新增，不依赖安全账本）**：在任何新存储建立前先止血，三项可在一天内完成并独立回归：
   - V-08：按 §4.6 替换全部 frontmatter 解析；
   - V-01 最小版：引入 `LUCY_DEPLOYMENT_MODE`（默认 `customer`），customer 下无管理员时进入 bootstrap 而非 open；Chart 写死 `customer`；bootstrap 在 A0 阶段临时要求引导密钥文件存在（未配置返回 503），持久限速与完整引导状态留给批次 1；
   - V-02 最小版：`mcp-proxy.ts` `handlePost` 在身份识别成功后统一拒绝 `enabled:false` 的 Agent（403，JSON-RPC `-32003`），覆盖全部方法。
   A0 可作为内部修复候选或客户紧急补丁候选，但不改变下面“全部 P0/P1 关闭才可客户 GO”的规则。
1. 第一批先关闭默认开放、统一停用准入、引导竞态与旧 Cookie 重放，并建立最小耐久安全状态。可生成内部修复候选，**不能在后续 P1 未完成时签客户 GO**。
2. 第二批恢复上下文隔离、可靠审计、可信归因，随迁移预检、历史敏感信息清理和完整本地攻击回归交付。所有角色/上下文收窄优先于兼容可用性。
3. 第三批完成真实管理/Agent/离线 Eval 脚本、schema/verifier、反作弊测试、候选 digest 绑定、K8s 接线与正式证据归档。
4. 升级前做受控备份和磁盘容量检查，确认 `admins.yaml` override 读写路径一致；安全库位于持久卷，新 schema 必须幂等。老会话统一过期，Token hash/业务语义不静默改写，旧上下文无 ACL 立即拒绝并提示管理员修复。
5. 在保留 safe-deny 状态下恢复备份；旧安全库丢失/不完整不可重新开放入口。已撤销 Token 的权威吊销状态必须从最新受控备份/记录恢复，不能拿旧快照直接上线。会话密钥和引导密钥按恢复流程轮换；新旧数据形状不兼容时保持维护状态。

## 10. 请审阅确认的设计决策

以下均有草案默认值，待本 Spec 审阅后才生效，不需要先填调查问卷才可评审：

| 决策 | 草案默认 | 影响 |
|---|---|---|
| R1 上下文隔离 | 显式角色 ACL + 同角色通道；无 ACL 拒绝；`*` 显式确认；legacy Agent 先迁移 | 推翻 170 的全开放；部分旧文档在迁移确认前不可用 |
| R2 审计失败策略 | 内容返回前 durable prepared；故障停止敏感内容释放 | 选择安全可追溯优先，会在安全存储不可用时降低服务可用性 |
| R3 会话 | 空闲 30 分钟/绝对 12 小时；旧会话一次失效；恢复强制重新登录 | 管理员需更频繁登录；Agent Token 不受会话迁移影响 |
| R4 客户端首发矩阵 | 自动 required：Claude Code + OpenClaw；人工 required：WorkBuddy + Cursor Agent GUI（2026-10-18 owner v5；放弃 Codex CLI 自动验收） | 缺自动 CLI 证据或缺人工 GUI 清单均不签发布；不能用 Hermes / Codex 代替 |
| R5 保留/归档 | 安全事件与 release evidence 180 天，原文维持短保留；客户合同更长从其规定 | 需容量预算、受控 artifact 存储；不默认建设 WORM/SSO |
| R6 分批上线 | A0 热修复先行；P0/P1 可分批合入/内部验证，全部关闭后才客户 GO | 首批热修复不代表全产品企业安全验收已完成 |
| R7 Cursor / WorkBuddy 接入形态 | WorkBuddy 与 Cursor Agent GUI 为 **manual required**（checklist，永不自动化）；自动路径为 Claude Code + OpenClaw。Codex / Cursor Agent CLI 仅 optional | 人工缺包 = GO blocked；不得用自动化假造 GUI 证据 |
| R8 测试基础设施 | 指定负责人提供：①可运行真实模型与 CLI 客户端的 protected self-hosted runner（macOS 或 Linux 均可，凭据存 CI secret）；②一套 linux/amd64 单节点 K8s（k3s 即可）供候选 digest 部署。两者就绪前 T12/T14 状态为 BLOCKED，客户 GO 不可签 | 无此基础设施则批次 C 无法完成；不得以本地 Compose 或 arm64 结果替代 |
| R9 LLM 波动容忍 | 安全负例：零容忍（任何一次越权即 FAILED）。业务正确性：每 required 产品 × 场景固定 3 次，**3/3 通过**；任一失败须给出根因分类（产品缺陷 / 语义口径 / 模型波动），模型波动类仅允许 owner 书面豁免单次重跑一轮且原失败保留在证据中 | 严格口径会提高发布阻断概率；放宽为 2/3 需在此显式改决策 |
| R10 模型凭据与预算 | 使用测试专用账号与 Key，不复用个人生产配置；每次候选完整运行的调用量上限在 `profiles/customer-release.yaml` 冻结 | 未提供凭据即 BLOCKED |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

提案恢复 Spec 151 既有“可访问角色 / 所有角色可见 / 无人可见”，须在实施时同步术语标准中 Spec 170 的撤回说明。新增概念在本节登记：

| 概念 | UI 主术语 / 用途 | 禁止混淆 |
|---|---|---|
| Durable security ledger | 持久安全账本（运维/审计说明） | 不可篡改账本、WORM 已交付 |
| Real user E2E release gate | 真实用户 E2E 上线门禁 | 模拟 API 通过即用户 E2E 通过 |
| Audit projection lag | 审计同步延迟 | 无记录、完整审计（实际尚未同步时） |
| One-time bootstrap secret | 一次性引导密钥 | 默认密码、公开注册码 |

`Skill`、`Wiki`、`Role`/`Agent`/`Token` 标识、URI、文件路径、字段/原因码、镜像 digest DOM 均需 `translate="no"` + `notranslate`。新错误码实施时在 API Spec 登记，用户文案按本术语说明，内部细节不直接回显。

## Design System Compliance

引用 `webui/docs/design-system/10-components-button.md`、`11-components-data-grid.md`、`13-components-toast.md`、`20-patterns-page-layout.md`。复用现有表单、角色复选组、保存确认 Drawer、warning/danger token 和 no-store 错误反馈；不引入新的视觉 token 或新导航组。只要求 1440×900 桌面基线与键盘操作，本轮无移动/窄屏验收。新视觉模式若无法复用，应先按 `99-governance.md` 登记，不能在代码里临时发明。
