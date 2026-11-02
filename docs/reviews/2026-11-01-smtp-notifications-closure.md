# L25-05 可选 SMTP 通知 —— 功能合同收口记录

> 2026-11-02：SMTP-24 的离线启动、SMTP-25 的真实回滚、SMTP-26 整行已拆出功能合同。本文件里这些行的「部分通过／blocked」改以 [出口拆分记录](2026-11-02-functional-contract-exit-split.md) 为准。留下的本机断言仍然有效。

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261025-v0p25-smtp-notifications-spec.md`](../specs/lucy-20261025-v0p25-smtp-notifications-spec.md)（收口后 **v0.7-functional-contract-closed**） |
| Plan | [`docs/plans/2026-10-26-lucy-v0.25-l25-05-smtp-notifications-implementation-plan.md`](../plans/2026-10-26-lucy-v0.25-l25-05-smtp-notifications-implementation-plan.md)（收口后 **v0.1**） |
| 台账号 | **L25-05**（v0.25 登记册 §2.1） |
| 层级 | **功能合同** |
| 结论 | **SMTP-01–25 共 25 条关闭（其中 SMTP-24、SMTP-25 为「部分通过」并逐条列明未覆盖子项）；SMTP-26 保持 blocked。** 本条收口**不表示可上线**——镜像构建、部署、客户交付、客户环境验证与真实升级不在本条出口 |
| 授权 | PM 2026-11-01 批准 C 档功能合同收口批次 |

---

## 一、本次实际动了什么

S1–S3 的实现与自动化（`notifications-l25-05.test.ts` / `-smtp.test.ts` / `-helm.test.ts`）在收口前**已存在且全绿**。本次**没有直接采信那份「已实现」的登记**，而是按 §11 的 26 条矩阵逐条复核：**矩阵里有、仓里却没有任何断言的判据，一律补用例**（硬约束 5：只加测试，不改运行代码）。

复核结论：

| # | 位置 | 复核发现 | 本次处置 |
|---|---|---|---|
| ① | **SMTP-15** | 矩阵要求「测试接口返回 `NOTIFICATION_QUEUE_UNAVAILABLE`（503）而非 `NOTIFICATION_UNAVAILABLE`」——这是 F-15 的**两类 503 分码**合同。仓内只有「配置不可用 ⇒ `NOTIFICATION_UNAVAILABLE`」的用例；**队列满 ⇒ 503 队列错误这一半全仓无任何断言**。既有用例「SMTP-15 队列满时不阻塞，enqueue 报告 queue_full」**用例名写着 queue_full，函数体里根本没有制造队列满** | 新增 2 条：队列满 ⇒ 503 `NOTIFICATION_QUEUE_UNAVAILABLE`；pending 上限失效 ⇒ 同一用例转红 |
| ② | **SMTP-06** | 矩阵要求「无任意收件人输入」。`POST /api/admin/notifications/test` 的实现确实不读请求体，但**全仓没有任何断言证明这一点** | 新增 1 条：请求体里的 `recipients`／`to`／`bcc` 被忽略，落库收件人与配置逐个相等 |
| ③ | **SMTP-09** | 矩阵要求「事故 enqueue 失败……不发恢复」。既有用例只覆盖了「恢复要求事故行已持久化」这个**存储层**判据，**没有覆盖「事故根本没落盘」这个生产者路径判据** | 新增 1 条：先让存储拒绝写入（事故未落盘），**再把存储修好**，恢复仍不得补发 |
| ④ | **SMTP-10** | 矩阵整条（「未选择 auditHealth ⇒ 事故／恢复均不产生新行；测试邮件仍可按有效配置使用」）**全仓无任何断言** | 新增 1 条 |
| ⑤ | **SMTP-11** | 既有两条只覆盖「关闭时不投递」与「收件人快照」。**「关闭期间不产生新行」与「过期行不投递」**两个子项此前无断言 | 新增 2 条 |
| ⑥ | **SMTP-12／14** | 「成功后 sent，attempts 准确」与「SMTP 接受后未标 sent 的重复风险被测试」——既有用例只覆盖**首次**发送成功（attempts=1）与**租约**语义，**没有一次「失败后重试成功」的完整往返，也没有一次「已投递但未标 sent」的重复** | 新增 2 条 |
| ⑦ | **SMTP-19** | 矩阵要求「批量……上限生效」。仓内只有 pending=1000、payload/地址数与保留清理批量，**「每批最多领取 20 行」无断言** | 新增 1 条 |
| ⑧ | **SMTP-17／18／20／03／04／07／05／25** | 若干子项此前只有半个判据（详见 §二逐行「本次补」标记） | 新增 13 条 |

**合计新增 26 条用例、2 个测试文件**（`webui/server/__tests__/notifications-l25-05-closure.test.ts` 22 条、`webui/server/__tests__/notifications-l25-05-auth-boundary.test.ts` 4 条），另在既有 `scripts/upgrade/upgrade-lucy.test.mjs` 补 **1 条**（备份保留清单含 outbox 所在的 `audit.sqlite`）。

**运行代码一行未改**（`git diff --stat -- webui/server` 为空）。

## 二、出口矩阵结果（逐条 SMTP → 用例 → 文件）

**证据等级：本地自动化（vitest，本机进程内）＋ 本地工程门禁（`helm template` 真渲染、`node --test` 脚本套件、仓库门禁）。**
**无 CI job 证据，无客户环境证据，无浏览器实测证据。**

| 编号 | 结果 | 证据落点（文件 → 用例名） |
|---|---|---|
| SMTP-01 | 通过 | `server/__tests__/notifications-l25-05.test.ts`「SMTP-01 未配置时不启用，也不读任何文件」；**本次补** `server/__tests__/notifications-l25-05-closure.test.ts`「SMTP-01 未配置时不产生任何 SMTP 连接：worker 不领取、不发信」＋「SMTP-01 未配置时不读 profile／password／CA 任何文件」（`LUCY_SMTP_PASSWORD_FILE`／`LUCY_SMTP_CA_FILE` 指向不存在的文件时状态仍为 `disabled`，不是 `unavailable`） |
| SMTP-02 | 通过 | `notifications-l25-05.test.ts`「SMTP-02 状态摘要不含 host／username／from／收件人原文」＋「SMTP-02 owner 看到脱敏状态与队列计数」 |
| SMTP-03 | 通过 | `notifications-l25-05.test.ts`「SMTP-03 合法 profile 通过校验」「SMTP-03 非法形状一律被拒，且只抛封闭错误码」「SMTP-03 非法 profile 让通知不可用，但不影响其它东西」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-03 布尔与地址非法一律被拒：enabled／auditHealth 非布尔、from 非法或含 CR-LF」＋「SMTP-03 profile 非法时启动不被拖垮：initNotifications 不抛错，通知 unavailable」 |
| SMTP-04 | 通过 | `notifications-l25-05.test.ts`「SMTP-04 有 username 但缺密码文件时为 unavailable」「SMTP-04 没有 username 时不读密码文件」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-04 密码文件为空时 unavailable 且不连接；修复并重启后恢复 ok」＋「SMTP-04 CA 文件缺失或不是 PEM 时 unavailable；补上合法 CA 后恢复 ok」 |
| SMTP-05 | 通过 | **本次补** `server/__tests__/notifications-l25-05-auth-boundary.test.ts`「SMTP-05 认证与管理路由里没有忘记密码／验证码／许可入口」（枚举认证／管理员／通知三组真实注册路由，并断言枚举非空且含三条通知路径，作为反空转护栏）＋「SMTP-05 通知接口不是认证条件：三条路径都不在公开 API 白名单里」＋「SMTP-05 登录主键仍是账户 id：邮箱既不是合法账户 id，也查不到账户」＋「SMTP-05 只带邮箱的登录请求被拒：登录凭据仍是账户 id 与密码」 |
| SMTP-06 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-06 发送成功后标 sent，且收件人只在 Bcc」「SMTP-06 owner 提交测试邮件返回 202 queued，文案不说发送成功」「SMTP-06 真实投递后正文不含收件人列表，收件人只在 Bcc」（**本地 fake SMTP 真投递**）；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-06 测试邮件不接受任意收件人：请求体里的地址被忽略」 |
| SMTP-07 | 通过 | `notifications-l25-05.test.ts`「SMTP-07 非 owner 返回 403，未登录返回 401」；`notifications-l25-05-smtp.test.ts`「SMTP-07 未登录 401、非 owner 403，且不产生 outbox 行」「SMTP-07 状态与单行查询都不返回 payload 与收件人」「SMTP-07 不存在的通知 id 返回 404 NOTIFICATION_NOT_FOUND」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-07 未登录／非 owner 的响应不泄露配置信息，也不产生 outbox 行」（401／403 响应体逐字不含 host／收件人／username／profile 路径） |
| SMTP-08 | 通过 | `notifications-l25-05.test.ts`「连续失败才升级为事故，且只发一次」「ok／unavailable 抖动不产生任何事件」「SMTP-08／09 持续 60 秒无需额外 append 也产生事故与恢复」「SMTP-08 计时器早触发时重排窗口，不静默放弃通知」「SMTP-08 入队产生一行 queued，去重键命中时不重复入队」 |
| SMTP-09 | 通过 | `notifications-l25-05.test.ts`「恢复需要稳定成功，且复用同一个 incidentId」「没有事故就不产生恢复事件」「SMTP-09 恢复事件要求事故行已持久化」「SMTP-09 同批次事故与恢复按顺序持久化，不丢恢复事件」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-09 事故入队失败时不发恢复提醒：存储恢复后也不补发」 |
| SMTP-10 | 通过 | **本次补** `notifications-l25-05-closure.test.ts`「SMTP-10 未选择 auditHealth 时事故与恢复都不产生新行；测试邮件仍可入队」（`auditHealth: false` → 事故与恢复零行；`POST /test` 仍 202 且落一行 `smtp_test`） |
| SMTP-11 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-11 关闭时不投递，队列保持原样」「SMTP-11／21 历史行按 enqueue 时的收件人快照投递，不随配置变更」；`notifications-l25-05.test.ts`「SMTP-13 过期行不再投递，转 dead」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-11 enabled=false 时事故与恢复都不产生新行」＋「SMTP-11 重新启用并重启后：未过期的历史行按原收件人快照投递，过期行不投递」（历史行按**入队时快照**投递、过期行转 `dead` 且不投递） |
| SMTP-12 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-12 暂时失败按有界退避重排，并记录封闭错误码」「SMTP-12 SMTP 4xx 被服务端拒绝时映射为可重试的 smtp_rejected」「SMTP-12 超时映射为 smtp_timeout」「SMTP-12 连接失败映射为 smtp_unreachable」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-12 暂时失败后重试成功：状态转 sent 且 attempts 准确」（第一次失败 → `queued`／attempts=1／退避到 1m 后，第二次成功 → `sent`／attempts=2） |
| SMTP-13 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-13 永久失败直接 dead，不无限重试」「SMTP-13 达到最大尝试次数后 dead」「SMTP-13 SMTP 5xx 被服务端拒绝时映射为永久失败」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-13 永久故障只影响通知：行转 dead、错误码封闭，账本健康面不受影响」 |
| SMTP-14 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-14 租约过期的 sending 行可被重新领取（崩溃恢复）」「SMTP-14 活着的租约不会被抢走」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-14 SMTP 接受后未标 sent 的崩溃：租约过期后重发，重复是文档化的 at-least-once 语义」（模拟「已被 SMTP 接受但进程在标 sent 前崩溃」，行被**再投一次**，attempts=2） |
| SMTP-15 | 通过 | `notifications-l25-05.test.ts`「SMTP-15 队列达到上限时拒绝新通知，不影响主业务」；`notifications-l25-05-smtp.test.ts`「SMTP-15 配置不可用时返回 NOTIFICATION_UNAVAILABLE 而不是队列错误」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-15 队列满时测试接口返回 NOTIFICATION_QUEUE_UNAVAILABLE（503），不是 202 也不是 NOTIFICATION_UNAVAILABLE」（**此前全仓无断言**） |
| SMTP-16 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-16 security=tls 走直连 TLS，不带 requireTLS」「SMTP-16 security=starttls 必须升级，且绝不降级明文」「SMTP-16 私有 CA 只追加信任，且没有关闭校验的开关」「SMTP-16 证书错误按 originalCode 识别」「SMTP-16 认证失败映射为 smtp_auth_failed」＋**协议层真连接**「SMTP-16 直连 TLS：信任该 CA 时发送成功，明文服务器不被接受」「SMTP-16 不信任该 CA 时握手失败，绝不降级明文」「SMTP-16 STARTTLS 升级失败时不降级明文，且升级前不发送 AUTH」 |
| SMTP-17 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-17 主题是封闭值，只有三个」「SMTP-17 显示名的控制字符被去除并限长」「SMTP-17 事故 id 只披露 8 位短 id」「SMTP-17 CR/LF 无法进入正文形成 header 注入」；`notifications-l25-05.test.ts`「SMTP-03 非法形状一律被拒，且只抛封闭错误码」（含 `bad\r\nBcc:` 收件人）；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-17 发出的邮件只有纯文本正文，没有 HTML 部件」（消息字段恰为 `bcc/from/subject/text/to` 五项，无 `html`、无 `attachments`，正文无 header 行） |
| SMTP-18 | 通过 | `notifications-l25-05.test.ts`「SMTP-18 profile 不得内联密码」；`notifications-l25-05-smtp.test.ts`「SMTP-18 传输层不挂 logger，SMTP 对话不会进应用日志」「SMTP-18 配置了凭据时只传 auth，不把密码放进别处」；`notifications-l25-05-helm.test.ts`「SMTP-23 启用：…只出现文件路径 env」（渲染产物无密码值）；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-18 密码不出现在 outbox 行、审计登记与状态接口里」（行由**真实生产者路径**产生：outbox 行、audit_meta 登记、状态接口三处均无密码、无 `AUTH ` 对话） |
| SMTP-19 | 通过 | `notifications-l25-05.test.ts`「SMTP-19 收件人上限为 20 且去重」「SMTP-19 payload 与收件人快照有上限」；`notifications-l25-05-smtp.test.ts`「SMTP-19 保留期清理一次只删一批，不做无界删除」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-19 每批最多领取 20 行，其余留到下一批」（25 行 ⇒ 首批 20、次批 5、第三批 0） |
| SMTP-20 | 通过 | `notifications-l25-05-smtp.test.ts`「SMTP-20 正文只含显示名、时间、短 id、观测说明与恢复入口」「SMTP-20 正文不含 host、username、密码、收件人或原始错误」；**本次补** `notifications-l25-05-closure.test.ts`「SMTP-20 邮件正文与接口都不含查询、表数据、审计 diff、Token 或许可信息」（payload 里塞进查询／表数据／diff／Token／许可字样后，正文与状态、单行接口逐项不含） |
| SMTP-21 | 通过 | `notifications-l25-05.test.ts`「SMTP-21 配置只加载一次：改动文件不热生效」；`notifications-l25-05-smtp.test.ts`「SMTP-11／21 历史行按 enqueue 时的收件人快照投递，不随配置变更」（重启后用新配置、历史行仍按原快照与有效期处理） |
| SMTP-22 | 通过 | `notifications-l25-05-helm.test.ts`「SMTP-22 默认关闭：渲染产物里没有任何 SMTP 资源、挂载或 env」（**真跑 `helm template`**，渲染成功且产物里无 `LUCY_SMTP_*`／无 `smtp-profile`／`smtp-password`／`smtp-ca` 资源与挂载） |
| SMTP-23 | 通过 | `notifications-l25-05-helm.test.ts`「SMTP-23 启用：profile 走只读 ConfigMap，密码与 CA 走客户自有 Secret，只出现文件路径 env」「SMTP-23 渲染出的 profile 能被运行时的 profile 合同解析」「SMTP-23 有 username 但缺 Secret 时渲染失败」「SMTP-23 values 内联密码时渲染失败」「SMTP-23 明文 SMTP 与非法值渲染失败」「SMTP-23 extraEnvFrom 覆盖 SMTP env 或投影密码 Secret 时渲染失败」（**10 类 render 失败**均以渲染真的失败证明，不是读模板猜） |
| **SMTP-24** | **部分通过** | **已关闭子项**：`notifications-l25-05-helm.test.ts`「SMTP-24 probes 不访问 SMTP」——真 `helm template` 渲染出的 startup／readiness／liveness 三条探针行逐行不含 `smtp`。<br>**未覆盖子项**：「无公网可启动和本地登录」——需要**离线镜像在无公网环境启动并完成一次本地登录**，属真实部署／交付动作，仓内无可打假落点 ⇒ 归发布取证与交付层，**不构成把整条 Spec 挂成未收口的理由**（`DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」） |
| **SMTP-25** | **部分通过** | **已关闭子项**：① **审计存储迁移**——`notifications-l25-05-closure.test.ts`「SMTP-25 通知初始化只升审计库 schema，不触碰安全库」（audit schema＝4、`audit_meta` 登记 `system:notifier-init`、outbox 表与两条索引齐备、**安全库 `user_version` 前后不变**）；② **备份**——`scripts/upgrade/upgrade-lucy.test.mjs`「the upgrade preserve list keeps the audit database that now carries notification_outbox」（**本次补**，升级保留清单含 `.ktx-ui/audit.sqlite`）；③ **禁用合同**——`notifications-l25-05-smtp.test.ts`「SMTP-11 关闭时不投递，队列保持原样」＋本次补的 SMTP-11 两条；④ **无认证或审计语义回退**——本次补的「SMTP-05 登录主键仍是账户 id…」＋「SMTP-25 状态摘要仍只暴露脱敏字段，升级后不新增泄露面」。<br>**未覆盖子项**：「备份恢复」的**真实往返**（备份 → 还原 → 校验 outbox 行仍在）与「回滚到不识别 `notification_outbox` 的旧 Chart」的**真实 `helm rollback`**——两者都要真实部署，属发布取证与交付层。回滚口径本身已写进 [`ROLLBACK.md`](../../deploy/k8s/helm/lucy/ROLLBACK.md)「Optional SMTP notifications (chart 0.2.8+)」与 [`UPGRADE.md`](../../deploy/k8s/helm/lucy/UPGRADE.md) 同名段 |
| **SMTP-26** | **⛔ blocked** | **无证据，且不得写成通过。** 矩阵原文：「协议 fake SMTP 只能证明实现行为；真实交付验收需客户目标 SMTP 与 linux/amd64 K8s，环境不足记 `blocked`。」解除条件：客户提供目标 SMTP（账号、地址、端口、证书链）＋ linux/amd64 候选镜像与 K8s 环境。S4 不启动，**S1–S3 的单元／协议／交付证据一律不得记作 SMTP-26 通过** |

## 三、本批补的东西（只加测试，**未改任何运行代码**）

| 文件 | 条数 | 每条打假的是哪条验收标准 |
|---|---|---|
| `webui/server/__tests__/notifications-l25-05-closure.test.ts`（新增） | 22 | **SMTP-01**（未配置 ⇒ 无 SMTP 连接、不读任何文件）×2／**SMTP-03**（布尔与地址非法被拒；启动不被拖垮）×2／**SMTP-04**（空密码文件；CA 缺失或非 PEM；修复后重启恢复）×2／**SMTP-09**（事故入队失败 ⇒ 存储恢复后也不补发恢复）／**SMTP-10**（未选 auditHealth ⇒ 零行；测试邮件仍可入队）／**SMTP-11**（关闭期间零行；重启后快照投递＋过期行不投递）×2／**SMTP-12**（重试后 sent、attempts 准确）／**SMTP-13**（永久故障只影响通知）／**SMTP-14**（崩溃后重发＝at-least-once 重复）／**SMTP-19**（每批 ≤20 行）／**SMTP-06**（不接受任意收件人）／**SMTP-07**（401／403 不泄露配置）／**SMTP-15**（队列满 ⇒ 503 `NOTIFICATION_QUEUE_UNAVAILABLE`）／**SMTP-17**（只有纯文本正文，无 HTML 部件）／**SMTP-18**（密码不落 outbox／audit_meta／状态接口）／**SMTP-20**（正文与接口不含查询／表数据／diff／Token／许可）／**SMTP-25**（只升审计库 schema、安全库不动；状态摘要仍脱敏）×2 |
| `webui/server/__tests__/notifications-l25-05-auth-boundary.test.ts`（新增） | 4 | **SMTP-05** ×4：认证／管理／通知三组真实注册路由里**没有**忘记密码／验证码／许可入口（并以「枚举非空且含三条通知路径」防空转）；三条通知路径**不在公开 API 白名单**；账户 id 文法**不接受邮箱**、邮箱查不到账户；只带邮箱的登录请求被拒（「需要管理员 id 与密码」） |
| `scripts/upgrade/upgrade-lucy.test.mjs`（既有，补 1 条） | 1 | **SMTP-25 备份**：升级保留清单 `PRESERVE_REL_PATHS` 必须含 `.ktx-ui/audit.sqlite`——outbox 就在这个库里，备份漏掉它等于静默丢掉已排队通知 |

**未改任何运行代码。** `git diff --stat -- webui/server` 为空；被测行为本来就正确，本批补的是**此前不存在的断言**。

### 变异验证：这些用例不是空转

对新补的断言逐条做了**变异测试**（改坏实现 → 对应用例必须转红 → 改回；脚本用完即删，工作树已复原）。**27 个变异全部命中**：

| # | 变异 | 转红的用例 |
|---|---|---|
| M1 | `POST /test` 接受请求体里的收件人 | SMTP-06 不接受任意收件人 |
| M2 | 队列错误返回 `NOTIFICATION_UNAVAILABLE` | SMTP-15 队列满分码 |
| M3 | 去掉恢复事件的「事故行已持久化」闸门 | SMTP-09 事故入队失败不发恢复 |
| M4 | 去掉 `auditHealth` 开关判断 | SMTP-10 未选 auditHealth |
| M5 | 事件处理不再判断 `enabled` | SMTP-11 关闭期间零行 |
| M6 | 每批领取上限 20 → 100 | SMTP-19 每批 ≤20 |
| M7 | 去掉 `auditHealth` 布尔校验 | SMTP-03 布尔非法 |
| M8 | 接受空密码文件 | SMTP-04 空密码文件 |
| M9 | 不再把过期行转 `dead` | SMTP-11 过期行不投递 |
| M10 | 消息多一个 `html` 部件 | SMTP-17 只有纯文本正文 |
| M11 | 不再执行 pending 上限 | SMTP-15 队列满分码 |
| M12 | 状态摘要多带 `password` | SMTP-18 ＋ SMTP-25 状态摘要 |
| M13 | 去掉 `enabled` 布尔校验 | SMTP-03 布尔非法 |
| M14 | 领取时不累加 `attempts` | SMTP-12 ＋ SMTP-14 |
| M15 | 把通知状态端点加进公开 API 白名单 | SMTP-05 不是认证条件 |
| M16 | 给认证路由加一条 `POST /api/auth/forgot-password` | SMTP-05 无忘记密码入口 |
| M17 | 账户 id 文法允许 `@` | SMTP-05 账户 id 主键 |
| M18 | 启动路径不再登记 `audit_meta` | SMTP-25 审计存储迁移 |
| M19 | 不再创建 outbox 索引 | SMTP-25 审计存储迁移 |
| M20 | worker 不再判断「禁用／不可用」 | SMTP-01 ＋ SMTP-03 ＋ SMTP-11 |
| M21 | 投递时改用当前配置的收件人而非入队快照 | SMTP-11 快照语义 |
| M22 | 把原始 payload 拼进邮件正文 | SMTP-20 内容最小化 |
| M23 | 生产者把密码写进 outbox payload | SMTP-18 秘密不落盘 |
| M24 | 登录改用 `email` 当主键 | SMTP-05 只带邮箱的登录被拒 |
| M25 | 去掉 CA 文件读取 | SMTP-04 CA 异常 |
| M26 | profile 非法时抛错而不是降级 | SMTP-03 启动不被拖垮 |
| M27 | outbox 初始化失败时向上抛错 | SMTP-03 启动不被拖垮 |

> **首轮变异跑出 3 条空转断言并已修正**（不是事后补说）：M3（恢复闸门）首版仍绿——因为存储被破坏时恢复事件**也**写不进去，测试分不清「被闸门挡下」与「写失败」；改成**先让存储拒绝事故写入、再把存储修好**，闸门一去掉恢复就会落库，测试转红。M22（payload 泄漏）首版仍绿——变异拼的是**解析后**的 payload（只有 3 个字段），本就没东西可泄；改成拼**原始 `row.payload_json`** 后转红。M23（密码进 payload）首版仍绿——首版用**手写 payload**造行，绕过了真实生产者；改成由**审计健康适配器**产出该行后转红。**收口记录里记的是修正后的最终结果。**

## 四、工程门禁（2026-11-01 实测，干净 PATH）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 本条定向测试 | `npx vitest run --maxWorkers=1 <5 个文件>` | **5 文件 / 99 条全绿**（既有 3 文件 / 73 条 ＋ 本批新增 2 文件 / 26 条） |
| 升级脚本套件 | `node --test scripts/upgrade/upgrade-lucy.test.mjs` | **16/16 通过**（既有 15 条 ＋ 本批补 1 条） |
| Spec/Plan 形态门禁 | `node scripts/lint-spec-docs.mjs` | **exit 0** |
| 形态门禁自测 | `node --test scripts/lint-spec-docs.test.mjs` | **23/23，exit 0** |
| 术语 lint | `npm run lint:terminology` | **exit 0** |
| Spec lint | `npm run lint:spec` | **exit 0** |
| IA 边界 lint | `npm run lint:ia-boundary` | **exit 0** |
| 版本 lint | `npm run lint:version` | **exit 0** |
| 根契约测试 | `npm run test:root-contracts` | **exit 0** |
| CI workflow 契约 | `npm run test:ci-workflow-contracts` | **exit 0** |
| 构建 | `npm --prefix webui run build` | **exit 0** |
| selector contract | `npm --prefix webui run e2e:selector-contract` | **exit 1**（既有基线：fail 集 201 ＋ warn 57），**本批新增 0 条 issue** |

**selector contract「不新增 issue」的证明**：把本批新增的两个用例文件临时移走复跑门禁，issue 行集合**逐条完全相同**（261 行 ↔ 261 行，`diff` 为空）。原因是本批新增文件全部落在 `webui/server/__tests__/`（门禁不扫该目录），且**未新增任何 `data-testid`**。

## 五、残余

1. **SMTP-24 的「无公网可启动和本地登录」**——需要真实离线部署，按「闭口层级」归发布取证与交付层，**不在本条出口**。
2. **SMTP-25 的「备份→恢复真实往返」与「回滚到旧 Chart 的真实 `helm rollback`」**——同上，需要真实部署。
3. **SMTP-26 保持 ⛔ blocked**——需客户目标 SMTP ＋ linux/amd64 K8s；S4 不启动。**S1–S3 的单元／协议／交付证据一律不得记作 SMTP-26 通过。**
4. **fake SMTP 只是协议级替身**：仓内 `smtp-server@3.21.1` 起的是**本机进程内** fake server，能证明 TLS／STARTTLS 升级顺序、「升级前不发 AUTH」、4xx／5xx 分类与真实收件人投递等**协议行为**；**它不能证明**客户目标 SMTP 的兼容性、真实投递或客户网络策略。**本条不得被读成「客户现场已验证」。**
5. **SMTP-18 的「证据包」半项**：证据包本身由取证／交付层生成，本条不生成。本条能证明的是**密码从未落盘**（outbox 行、`audit_meta`、状态接口三处均无密码 ＋ 传输层只在 `auth.pass` 持有），因此任何包含 `audit.sqlite` 的证据包都不含密码／AUTH 对话。
6. **全仓 selector contract fail 集 201 条**：既有欠账，属跨条治理，不在本条出口。
7. **全仓既有跨文件隔离 flake**（`context-policy-invalidation.test.ts` 等，聚集在 ktx.yaml／project-root／connections 线）：与本条无关，未修也未计入本条失败数。

## 六、不在本次收口里

- **镜像构建、部署、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级**——归发布取证层。
- **SMTP-01／08／15 里「登录、bootstrap、break-glass、MCP 与审计行为与基线一致」「主审计失败语义不变」「原审计失败关闭不被改成放行」这几个跨模块子句**——它们断言的是**别的模块**的行为，在本条只能证明「通知层自身失败被隔离」（SMTP-03／09／13 的用例）；跨模块基线的整体比对属发布取证层，**登记为不在本条出口**，不写成「已通过」。
- **浏览器实测与移动窄屏验证**——本条未获授权执行。
- **E2E／real-e2e 目录下的用例**——按各 Spec 自身约定不属本条出口，**未被引用为验收证据**。
- **L25-06（OIDC）等邻条**——不碰。

## 七、发现但**没有修**的真实实现缺口

**0 处。** 本批 27 个变异全部被新用例打红，说明本条所依赖的行为**在仓内已经正确**；复核期间未发现行为与 Spec 不符的实现。

需要说明的是**两处「不构成缺口」的既有事实**（如实登记，避免被误读为已验证）：

1. **通知路由不读请求体**（`webui/server/admin/notifications.ts:49-70`）：`POST /api/admin/notifications/test` 只用缓存 profile 的收件人，请求体被整体忽略——这正是 SMTP-06「无任意收件人输入」的实现基础。本次**补了断言**把它钉住，**没有改实现**。
2. **`notification_outbox` 只在 `webui/server/notifications/` 内被读写**（全仓检索确认）：审计导出与证据包路径不读该表，所以「证据包无密码」在结构上成立；代价是 outbox 行**不会**出现在审计导出里——这是 Spec §8.5「按内部通知配置数据保护」的有意取舍，不是缺陷。

## 八、复现命令

```bash
cd /private/tmp/ktx-c-tier/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  server/__tests__/notifications-l25-05.test.ts \
  server/__tests__/notifications-l25-05-smtp.test.ts \
  server/__tests__/notifications-l25-05-helm.test.ts \
  server/__tests__/notifications-l25-05-closure.test.ts \
  server/__tests__/notifications-l25-05-auth-boundary.test.ts
```

```bash
cd /private/tmp/ktx-c-tier
node --test scripts/upgrade/upgrade-lucy.test.mjs
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。

**预期输出**：`Test Files 5 passed (5)` ／ `Tests 99 passed (99)`；`node --test` 侧 `ℹ pass 16`。
