# Lucy v0.25 可选 SMTP 通知 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | 功能设计基线（Notification / Audit / Customer Deployment） |
| 文档版本 / 日期 | v0.5-final-review / 2026-10-26，Asia/Shanghai（v0.2-requirements-review 联合需求审查 → v0.3-pm-signoff PM 签核 → v0.4-implementation 实施 S1 → v0.5-final-review S1 最终复审签核） |
| 功能编号 / 目标版本 | L25-05 / v0.25 |
| 优先级 | P2、可选能力；不改变既有 P0／P1 验收与交付阻断状态 |
| 状态 | **需求审查、PM 签核与 S1 最终复审签核均已通过（2026-10-26）；S1 自动化覆盖全绿；SMTP-01–26 仍未按验收口径执行。S2–S4 未开始，本轮不连接任何 SMTP 服务器、不发信。实现完成不等于验收通过** |
| 需求来源 | [Lucy 2.5 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.1 L25-05 |
| 审查记录 | [L25-04／L25-05 Spec 审阅记录](../reviews/2026-10-25-lucy-v0.25-l25-04-05-spec-review-record.md)（F-01–F-08 已关闭；F-13–F-17 已回写本文；F-18–F-22 最终复审发现已修正关闭） |
| 现有基础 | 单实例 WebUI、审计账本健康状态、审计存储迁移、owner-only 管理门、Helm Secret 文件模式 |
| 实施主体 | Lucy；不修改 KTX，不引入外部邮件服务依赖 |

> 本文件定义拟实现行为，不代表功能已经实现或验收通过。本文经 PM 签核后，仅在企业安全 Spec §1.1 的 SMTP 非目标上形成有边界的例外；登录、恢复、权限与失败关闭合同继续有效。

## 0. 设计决议摘要

| 编号 | 决议 |
|---|---|
| D01 | SMTP 默认关闭。未配置、配置无效、服务器不可达或发信失败时，登录、bootstrap、break-glass、MCP 和既有审计失败关闭行为均不变。 |
| D02 | 客户在自己的网络提供 SMTP；Lucy 不自建邮箱、不代管收件人目录、不依赖公网邮件 SaaS。 |
| D03 | 首批只有「审计账本不可用／恢复」提醒和 owner 发起的测试邮件。不恢复部署许可，不编造许可证、备份成功或审计完整性事件。 |
| D04 | 通知走持久 outbox 和有界异步 worker；请求线程不等待 SMTP。交付语义为 **at-least-once**，极少数崩溃点可能重复，不承诺恰好一次。 |
| D05 | 非敏感 profile 与密码分离；密码只从独立 Secret 文件读取。强制 TLS 或 STARTTLS，禁止明文 SMTP 和关闭证书校验。 |
| D06 | profile／secret 启动时一次加载并缓存，变更重启生效；未认证公开接口不读配置、不返回 SMTP 状态。 |
| D07 | 通知不改成账户邮箱模型，不提供忘记密码、验证码、OIDC 邀请或自助订阅；收件人来自部署配置，测试邮件也发给已配置收件人。 |
| D08 | 单实例／单副本，单 worker、单封在发；pending 队列、重试、payload、地址数和错误文本均有上限。 |
| D09 | 邮件只含固定模板和最小事件元数据，不含查询、表数据、审计 diff、原始异常、凭据或秘密。 |

## 1. 现状证据与复用边界

### 1.1 已存在的能力

| 现有能力 | 本 Spec 的处理 |
|---|---|
| 当前依赖中没有 SMTP 客户端 | 实施 Plan 选择维护中的 SMTP 库，审许可证、lockfile、SBOM 与 amd64 离线镜像；不手写 SMTP 协议 |
| Helm 尚无 SMTP values／挂载 | 新增默认关闭的受控接线；预留 OIDC 模式只作参考，不混用配置 |
| 登录账户以 id 为主键，无邮箱找回流程 | 保持原样；通知收件人独立于登录账户 |
| `recordLedgerAppend(ok)` 记录 canonical ledger 成功／失败转换 | 在状态转换后产生审计健康事件；不从 UI 计数或历史失败总数伪造新事故 |
| `readAuditWriteHealth()` 明确 `scope=current_process` | 邮件同样披露当前进程观测边界；重启不重放未观测到的历史事故 |
| canonical ledger 使用 `security.sqlite`，配置／访问审计使用独立的 `.ktx-ui/audit.sqlite` | outbox 进入既有 `audit.sqlite`，复用 `getAuditDb` 初始化；不新建数据库，不把通知写入 canonical ledger 所在的 security store |
| `requireOwner` 与受保护管理 API 已存在 | 测试邮件和通知状态仅 owner；不进入公开 API 白名单 |
| Helm 已支持只读 Secret 文件、固定 env 与单副本 Recreate | 复用交付模式；probes 不连接 SMTP |
| Spec 175 已移除部署许可、激活码和许可 API | 本 Spec 不新增许可提醒；建议书旧例子由本次状态同步修正 |

### 1.2 已知限制

- 当前审计健康是进程内观测，不能证明重启前或另一环境曾发生事故。
- canonical ledger 与 outbox 分库，security store 故障不必然阻断 enqueue；但 `audit.sqlite` 不可用或整盘故障时，outbox 也可能无法持久化。SMTP 不是替代审计通道，不能保证在所有故障下一定发出提醒。
- 邮件服务器接受信件不等于最终投递到收件箱；Lucy 只记录 SMTP 提交结果，不追踪阅读、退信或外部投递回执。

## 2. 目标与非目标

### 2.1 目标

1. 默认部署完全不启用 SMTP，也不产生网络连接。
2. 客户可用静态配置选择一个审计健康通知类别和明确收件人。
3. owner 可验证配置是否具备发信条件，并异步提交测试邮件、查看脱敏状态。
4. 审计账本进入不可用和随后恢复时产生可去重、可重试、可观测的提醒。
5. SMTP 故障不扩大为主业务故障，秘密不进入 values、ConfigMap、普通环境变量、日志、审计或邮件正文。

### 2.2 非目标

- 忘记密码、邮件验证码、登录 Magic Link、OIDC 邀请或账户 id 邮箱化。
- 部署许可、激活码、席位到期提醒；Spec 175 不被重开。
- 备份、升级、查询失败、预算、业务数据、审计投影延迟或通用 Webhook 通知。
- 用户自助订阅、按 Skill 负责人通知、邮件组管理、HTML 编辑器、附件或富文本模板。
- 多 SMTP provider、故障切换、多副本争抢、分布式队列或公网邮件中继服务。
- 精确一次、最终收件箱投递证明、退信解析或邮件阅读回执。

## 3. 配置合同

### 3.1 profile 与秘密

profile 只从 `LUCY_SMTP_PROFILE_FILE` 指定文件读取；密码只从 `LUCY_SMTP_PASSWORD_FILE` 读取；可选私有 CA 从 `LUCY_SMTP_CA_FILE` 读取。不得新增 `LUCY_SMTP_PASSWORD` 或接受 profile 内联 `password`／`pass`／`secret`。

```yaml
enabled: true
host: smtp.example.internal
port: 587
security: starttls
from: lucy@example.internal
username: lucy-notifier
recipients:
  - data-ops@example.internal
notifications:
  auditHealth: true
```

| 字段 | 规则 |
|---|---|
| `enabled` | 缺省／false 为关闭；关闭时其余字段不用于建立连接，公开行为与当前一致 |
| `host` | 非空主机名或 IP，不含 scheme、路径、端口、空白或用户info；最长 253 字符 |
| `port` | 1–65535 整数；必须显式配置，不用端口隐式推断安全模式 |
| `security` | 仅 `tls`（直连 TLS）或 `starttls`（明文连接后在发送任何凭据前升级，升级失败即终止） |
| `from` | 单一邮箱地址，禁止 display name、换行和 header 注入；最长 254 字符 |
| `username` | 可选，最长 256；设置时必须有非空密码文件，未设置时密码文件不得被读取 |
| `recipients` | 1–20 个去重邮箱地址；每个最长 254，禁止换行；启用时必填 |
| `notifications.auditHealth` | 布尔，缺省 false；只控制审计账本事故／恢复提醒，不控制测试邮件 |
| 私有 CA | 可选；只追加信任，不替换系统默认以外的验证规则，不允许 `rejectUnauthorized=false` |

启用且 profile 无效、secret 缺失／不可读／为空、CA 不可读或认证字段不完整时，通知状态为 `unavailable`；应用进程继续启动，通知 worker 不连接 SMTP。修复文件后重启恢复。

### 3.2 启动缓存

- 启动期读取并验证一次 profile／必要的 secret／CA，形成只含运行时必要字段的缓存。
- worker、测试接口和状态接口只读缓存；未认证请求不得触发文件读取。
- 文件变更不热加载，重启生效；配置摘要不包含密码、username、host、from 或收件人原文。
- `enabled=false` 时不读取密码，不创建 worker 网络任务；历史 outbox 保留但不投递，重新启用后再处理未过期任务。

## 4. 事件与邮件内容

### 4.1 审计健康事件

| 事件 | 产生时机 | 去重与边界 |
|---|---|---|
| `audit_ledger_unavailable` | 满足稳定窗口的 ledger 失败（见下「抖动抑制」）使 ledger 从 ok 转为 unavailable | 同一事故只 enqueue 一次；持续失败不重复刷屏 |
| `audit_ledger_recovered` | 同一进程随后满足恢复稳定窗口、使 unavailable 转为 ok | 仅当同 incident 的 unavailable 行已持久化时 enqueue；否则跳过，避免只有恢复没有事故；无事故的启动成功不发恢复邮件 |

实现可在健康模块与通知模块之间增加事件适配器；从 ledger 调用路径看，适配器只同步提交内存任务，**不得**在 `recordLedgerAppend` 中等待文件、数据库或 SMTP I/O。适配器内部必须串行处理异步事件，确保事故行落盘后才检查并入队对应恢复事件；outbox 异步落盘失败仅记录通知自身故障，原审计结果不变。

**抖动抑制（必须）**：事故与恢复必须建立在**稳定窗口**上，不得把每一次 ok／unavailable 翻转都当作事件。既有 ledger 在批量场景下会逐事件调用 `recordLedgerAppend`（`webui/server/security/ledger.ts:113`、`:125`、`:133`），一次批次内即可出现 ok→unavailable→ok 的翻转；若照直翻译为事件，同一次瞬时故障会产出一对事故＋恢复邮件，多次抖动即成刷屏。因此：

- **事故判定**：连续 3 次 ledger append 失败，或失败持续满 60 秒，才升级为 `audit_ledger_unavailable`；稳定窗口内的翻转不发事件。
- **恢复判定**：连续 3 次 append 成功，或成功持续满 60 秒，才判定为 `audit_ledger_recovered`。
- **窗口计时**：首次失败／恢复成功分别启动可取消、`unref` 的 60 秒计时器；持续满窗口后无需后续 append 即可触发，后续相反结果会取消对应计时器。
- **incident 语义**：一次事故从升级时刻起算，到恢复判定成立为止共用同一个 `incidentId`；窗口内的重复失败不新建 incident。
- 上述常量为固定口径，不进入 profile 配置面，不产生额外 Helm 参数。

事故使用随机 `incidentId`；通知行以 `incidentId:eventType` 唯一。状态转换先更新健康事实，再尝试通知。恢复事件的异步 enqueue 先按 incidentId 查询事故行；查询不到或存储不可用均不声称恢复提醒已排队。进程重启不清空未发送 outbox，但当前进程健康状态按现合同重新观测，不补发重启前未知事故。

### 4.2 测试邮件

- `POST /api/admin/notifications/test` 不需要请求体收件人；收件人固定为当前缓存 profile 的全部 `recipients`。
- 配置有效且 enabled 时返回 `202 {ok:true,notificationId,status:"queued"}`；不表示 SMTP 已接受。
- 测试事件使用随机 id，不参与审计事故去重；每个请求最多创建一行。
- owner 通过状态接口查看 queued／sending／sent／dead，不提供重新发送同一行的写接口。

### 4.3 固定模板

主题只使用以下封闭值：

- `Lucy 审计账本不可用`
- `Lucy 审计账本已恢复`
- `Lucy SMTP 测试邮件`

正文为纯文本，仅含实例显示名（若既有品牌配置可提供）、事件时间、事故短 id、当前进程观测说明和恢复入口说明。实例显示名去除控制字符并限长；不包含错误原文、host、username、密码、收件人列表、审计 diff、查询或表内容。邮件以 `from` 为 To、全部 recipients 为 Bcc，避免向收件人互相暴露地址；不得把地址列表写入正文。

## 5. outbox 与交付语义

### 5.1 数据模型

在既有 `.ktx-ui/audit.sqlite` 增加 `notification_outbox` 表和所需索引；不修改 security schema 版本。

**创建责任与版本口径**：

- outbox 表必须由 **notifier 自身的初始化路径**幂等创建（`CREATE TABLE IF NOT EXISTS` 及索引），不依赖 `admin/audit.ts` 的 `getAuditDb` 是否已被别处调用过：既有审计库存在两个独立连接句柄（`webui/server/admin/audit.ts:338` 的 `getAuditDb` 与 `webui/server/proxy/audit.ts:378` 的 `getDb`），各自执行自己的 DDL；worker 若在 admin 句柄首次被调用前启动并写库，会命中 `no such table`。worker 必须在开始领取任务前完成该初始化；初始化失败按 §5.3「outbox 不可用」处理，不得进入半可用状态。
- `audit.sqlite` 有**独立于 security store 的 schema 版本**（`webui/server/proxy/audit.ts:222` 的 `AUDIT_DB_SCHEMA_VERSION`，当前为 4，约定与 `audit_meta` 条目同增）。本次新增 outbox 表已将版本从 3 升为 4，并由 notifier 自身初始化路径以 `INSERT OR IGNORE` 同步登记 `audit_meta`；「不修改 security schema 版本」与「audit schema 版本递增」是两件事，不得互相替代。

| 字段 | 合同 |
|---|---|
| `id` / `dedup_key` | 内部 id；dedup key 唯一 |
| `event_type` | 三个封闭事件之一 |
| `incident_id` | 测试邮件为空；事故／恢复共享同一随机 id |
| `payload_json` | 已脱敏固定字段，最大 4 KiB |
| `recipients_json` | enqueue 时配置快照，最大 8 KiB |
| `status` | `queued`／`sending`／`sent`／`dead` |
| `attempts` / `next_attempt_at` | 最大 8 次；有界退避 |
| `lease_until` | sending 租约；崩溃恢复后可重试 |
| `expires_at` | 创建后 7 天；到期未 sent 的行转 dead，reason=`expired`，不再投递 |
| `created_at` / `updated_at` / `last_error_code` | 时间与封闭错误码；不存原始异常 |

`audit.sqlite` 初始化或迁移失败时通知不可用，但不得因此绕过 security store 的既有启动／认证合同。outbox 不是审计事实源，不替代 `security_events` 或 `config_change_log`；其分库只降低故障耦合，不构成持久化保证。

### 5.2 有界策略

- 单 worker、单封在发，轮询间隔 5 秒；同进程定时器 `unref`，关闭时停止领取新任务。
- connect／greeting／TLS／发送各阶段和总耗时必须有界；默认连接 10 秒、总发送 20 秒，实施可更低但不可无界。
- 每批最多领取 20 行；pending（queued＋sending）最多 1000 行，达到上限拒绝新通知并记录 `queue_full`，不影响主业务。
- 网络、超时和 SMTP 4xx 使用 1m／5m／15m／1h／4h／8h／12h／24h 上限退避；永久 5xx 可直接 dead。总尝试不超过 8 次，且不得超过 `expires_at`。
- sent 保留 7 天，dead 保留 30 天；清理分批有界。到期 queued／sending 先转 dead 再按 dead 保留，不发送过期事故或测试邮件。
- 发送成功后才标 sent；若 SMTP 已接受但进程在标 sent 前崩溃，租约恢复后会重发，因此可能重复。

### 5.3 故障语义

| 故障 | 主业务 | 通知行为 |
|---|---|---|
| SMTP 不可达／证书错误／认证失败 | 不变 | 有界重试或 dead；状态显示封闭错误码 |
| outbox 不可用 | 不变；原审计失败仍按原合同失败关闭 | 丢弃本次 enqueue 尝试并记录通知故障，不伪称已排队 |
| 队列满 | 不变 | 新事件不入队，不阻塞审计或登录 |
| enabled=false | 不变 | 不产生新事件行，不发送历史行；测试接口返回不可用 |
| security store 整体不可用 | 遵循既有认证／审计失败关闭 | `audit.sqlite` 可用时仍可 enqueue，但不改变主业务失败；不得另开认证旁路 |
| `audit.sqlite` 或整盘不可用 | 遵循既有审计失败关闭 | outbox 可能无法持久化，不声称通知可靠 |

## 6. 核心流程（伪代码）

```text
startup:
  cached = loadAndValidateSmtpFilesOnce()
  start single outbox worker with cached config
  // failure only disables notifier; never changes login or MCP mode

onLedgerAppend(ok):
  transition = updateAuditHealthAndReturnStableTransition(ok)  // 稳定窗口见 §4.1
  if transition is none: return
  if not cached.enabled or not cached.auditHealth: return
  enqueueAsync({
    dedupKey: transition.incidentId + ":" + transition.eventType,
    payload: fixedMinimalPayload(transition),
    recipients: cached.recipients
  })  // never awaited by recordLedgerAppend

enqueue(event):
  require cached.enabled and event allowed
  validate fixed payload and recipient snapshot
  if event is recovery:
    require persisted unavailable row with same incidentId; otherwise skip
  INSERT OR IGNORE outbox row with bounded fields and expiresAt=createdAt+7d
  if duplicate: return existing id without another email
  if store unavailable or queue full: report notifier failure only

workerPass:
  if not cached.enabled: return
  mark expired queued/sending rows dead(reason=expired)
  rows = transactionally claim due unexpired rows, max 20, one sending lease at a time
  for row in rows:
    result = smtpSendWithFixedTemplateAndTimeouts(row, cached, to=from, bcc=recipients)
    if accepted: mark sent
    else if now >= row.expiresAt: mark dead(reason=expired)
    else if retryAllowed(result): mark queued with bounded next attempt
    else: mark dead with closed error code

POST test as owner:
  require valid enabled cached config      // 无效或未启用 → 503 NOTIFICATION_UNAVAILABLE
  id = enqueue(test event to cached recipients)
  if enqueue rejected (queue full / store unavailable): return 503 NOTIFICATION_QUEUE_UNAVAILABLE
  if not persisted: return 503 NOTIFICATION_QUEUE_UNAVAILABLE
  return 202 with id and queued

mark sent after SMTP acceptance:
  commit status
  if process crashes before commit:
    expired lease may be claimed again  // documented at-least-once
```

## 7. API 与权限

| API | 权限 | 响应／边界 |
|---|---|---|
| `GET /api/admin/notifications/status` | owner | enabled、state、auditHealth、recipientCount、队列计数、最近封闭错误码；不返回 host、username、from、收件人或 secret |
| `POST /api/admin/notifications/test` | owner | 202 queued；配置不可用 503；不等待 SMTP |
| `GET /api/admin/notifications/:id` | owner | id、eventType、status、attempts、时间、lastErrorCode；不返回 payload 或收件人原文 |

- 这些路径不得加入公开 API 白名单；非 owner 返回 403 `OWNER_REQUIRED`，未登录沿用 401。
- **403 文案归属已定稿为方案②**：`requireOwner(request, reply, ownerMessage?)` 增加可选第三参数，默认仍为「仅所有者可管理管理员账户」，既有调用方行为不变；通知路由统一传入「仅所有者可管理邮件通知」。该共享签名改动及既有路由已纳入 S1 全量回归，后续 S2 通知 API 沿用同一合同。**不得**让通知接口显示「管理管理员账户」。
- 状态 `state` 封闭为 `disabled`／`unavailable`／`ok`／`degraded`；degraded 仅表示通知队列或发信异常，不改变 `/api/health` 的主服务健康定义。
- 通知 API 和配置不是认证条件，不出现在登录页，不新增「忘记密码」。
- 本期不新增 SMTP 设置页；部署人员通过 profile／Helm 管理，owner 通过 API 或后续最小 UI 调用测试。系统手册必须给出配置和排障方法。

## 8. 安全与隐私

1. 使用维护中的 SMTP 库；禁止手写协议、shell 调用 sendmail 或加载远程脚本。
2. TLS 证书 hostname 必须校验；STARTTLS 升级前不得发送 AUTH，升级失败不得降级明文。
3. 地址和主题使用结构化 API；所有输入拒绝 CR／LF，固定模板避免 header／HTML 注入。
4. 日志只含 notificationId、eventType、attempts 和封闭错误码；不得记录 SMTP 对话、AUTH、密码、完整地址或原始服务器响应。
5. outbox、备份和证据包包含收件人，按内部通知配置数据保护；导出状态 API 默认不暴露原文。
6. 不主动跟踪打开、不加载远程图片、不添加跟踪像素或外部链接。
7. 测试接口需 owner 和既有认证限速／审计上下文；不能用通知接口伪造审计成功。

## 9. 用户可见错误

| 场景 | 码 | 用户主文案 | HTTP |
|---|---|---|---|
| 未启用或配置不可用 | `NOTIFICATION_UNAVAILABLE` | 邮件通知当前不可用，请检查通知配置后重启 | 503 |
| 非所有者 | 既有 `OWNER_REQUIRED` | 仅所有者可管理邮件通知 | 403 |
| outbox 满或不可用 | `NOTIFICATION_QUEUE_UNAVAILABLE` | 通知队列暂不可用，请稍后重试 | 503 |
| 通知 id 不存在 | `NOTIFICATION_NOT_FOUND` | 未找到该通知记录 | 404 |
| 查询状态 | 不报错 | queued／sending 不代表已送达；dead 不自动重发 | 200 |

SMTP 原始响应不得直接成为用户可见错误。测试接口返回 202 不得显示「发送成功」，只能显示「测试邮件已加入发送队列」。

## 10. Helm、升级与回滚

### 10.1 Helm 接线

- `smtp.enabled=false` 默认；关闭时不生成有效运行时配置、不挂载密码、不注入文件路径 env。
- 启用时非敏感 profile 由只读 ConfigMap 挂载，密码由独立 `existingSecret` 挂载；Pod env 只出现 profile／password／可选 CA 文件路径。
- values 禁止 `password` 字段；无 username 时不要求 Secret，有 username 时缺 Secret／key 必须 render 失败。
- Chart 校验 host、port、security、from、recipients 和通知布尔形状；不信任 `extraEnvFrom` 覆盖固定 SMTP 文件路径。
- probes 不访问 SMTP；离线安装不连接邮件服务器。客户网络策略需另行允许到其 SMTP 地址和端口。
- Chart、Lucy 产品、镜像 digest 和捆绑依赖版本独立编号；本 Spec 不要求当前立即改 Chart 版本。

### 10.2 升级与回滚

1. 升级由 notifier 自身初始化路径调用 `ensureNotificationOutbox()`，经 `getAuditDb` 幂等增加 outbox 表和索引，并同步登记 `audit_meta`；audit schema 从 3 升为 4，不提升 security schema 版本。升级前备份必须包含 outbox 所在的 `audit.sqlite`，既有 security store 备份合同不变。
2. 未启用 SMTP 的现有实例除 `audit.sqlite` 新增空 outbox 表外无行为变化，不新增外连。
3. 设置 `smtp.enabled=false` 后停止新投递，历史 queued 保留；回滚到不识别该表的旧版本前必须按交付 Runbook 清理或保留兼容，不得假装旧版会发送。
4. 回滚不影响登录账户、审计账本、权限或恢复密钥；密码不进入备份明文附件。
5. 配置修改重启生效，重复／死信处置和保留期须在系统手册可查阅。

## 11. 验收矩阵

所有用例初始状态均为未执行。协议 fake SMTP 只能证明实现行为；真实交付验收需客户目标 SMTP 与 linux/amd64 K8s，环境不足记 `blocked`。

| 编号 | 验收场景 | 通过标准 |
|---|---|---|
| SMTP-01 | 默认未配置 | 无 SMTP 连接；登录、bootstrap、break-glass、MCP 和审计行为与基线一致 |
| SMTP-02 | 有效配置 | 启动缓存可用；status 仅含脱敏字段，recipientCount 正确 |
| SMTP-03 | 无效 profile | host／port／security／地址／布尔非法均只使 notifier unavailable，应用继续可用 |
| SMTP-04 | secret／CA 异常 | 缺失、不可读、为空或认证不完整时不连接、不泄露；修复重启恢复 |
| SMTP-05 | 登录与恢复边界 | 无忘记密码、验证码或许可入口；账户 id、所有者和运维职责不变 |
| SMTP-06 | owner 测试邮件 | 202 queued 后 worker 投递到全部已配置收件人，固定主题正文，无任意收件人输入；recipients 仅在 Bcc |
| SMTP-07 | 未登录／非 owner | 401／403，无 outbox 行、无 SMTP 连接、无配置读盘信息泄露 |
| SMTP-08 | 账本首次不可用 | 满足稳定窗口（连续 3 次失败或失败持续 60 秒）才生成一条事故行；窗口内的翻转不生成行；同一事故的持续失败不重复；主审计失败语义不变 |
| SMTP-09 | 账本恢复 | 仅事故行已持久化时生成一条恢复行，且恢复同样需满足稳定窗口（连续 3 次成功或成功持续 60 秒）；事故 enqueue 失败或无事故启动成功均不发恢复 |
| SMTP-10 | 未选择 auditHealth | 事故／恢复均不产生新行；测试邮件仍可按有效配置使用 |
| SMTP-11 | 关闭期间事件 | enabled=false 不产生新行，也不在重新启用后补发关闭期间事件；重新启用并重启后，关闭前已排队且未过期的历史行按原收件人快照投递，过期行不投递 |
| SMTP-12 | 临时故障重试 | fake SMTP 4xx／超时按有界退避重试；成功后 sent，attempts 准确 |
| SMTP-13 | 永久故障 | 5xx 或达到 8 次后 dead，无无限重试；主业务不受影响 |
| SMTP-14 | 崩溃恢复 | sending 租约过期可重领；SMTP 接受后未标 sent 的重复风险被测试并记录为 at-least-once |
| SMTP-15 | outbox 故障／队列满 | enqueue 不阻塞原请求；不伪报 queued；测试接口返回 `NOTIFICATION_QUEUE_UNAVAILABLE`（503）而非 `NOTIFICATION_UNAVAILABLE`；原审计失败关闭不被改成放行 |
| SMTP-16 | TLS 与 STARTTLS | 证书／hostname 校验；升级前无 AUTH；失败不降明文；无关闭校验开关 |
| SMTP-17 | 地址与模板注入 | CR／LF、非法地址、控制字符实例名被拒绝或规范化；无 HTML／header 注入 |
| SMTP-18 | 秘密扫描 | values、ConfigMap、env、日志、审计、API、邮件正文和证据包无密码／AUTH／完整 SMTP 对话 |
| SMTP-19 | 容量与保留 | payload、地址数、pending=1000、批量和保留清理上限生效，无无界增长 |
| SMTP-20 | 内容最小化 | 邮件不含查询、表数据、审计 diff、原始异常、登录凭据、Token 或许可信息 |
| SMTP-21 | 配置重启 | 文件变更不热生效；重启后使用新配置；历史行按原收件人快照和有效期处理 |
| SMTP-22 | Helm 默认关闭 | render 无 SMTP ConfigMap／Secret 挂载／固定 env，无网络行为 |
| SMTP-23 | Helm 启用接线 | 只读挂载与文件 env 正确；缺 Secret、内联密码、非法值和 extraEnvFrom 覆盖被拒绝 |
| SMTP-24 | 离线与 probes | 无公网可启动和本地登录；startup／readiness／liveness 不连接 SMTP |
| SMTP-25 | 升级与回滚 | 审计存储迁移、备份恢复、禁用和回滚合同通过；无认证或审计语义回退 |
| SMTP-26 | linux/amd64 真实链路 | 同一候选镜像向客户目标 SMTP 完成测试、事故、恢复、重试与重启证据；否则 blocked |

## 12. 实施拆分与状态（2026-10-26 已授权实施并复审 S1）

实施 Plan 见 [L25-05 实施 Plan](../plans/2026-10-26-lucy-v0.25-l25-05-smtp-notifications-implementation-plan.md)。

| 阶段 | 内容 | 退出条件 | 状态 |
|---|---|---|---|
| S1 配置与 outbox | profile／secret 启动缓存、`audit.sqlite` 表与索引、固定事件、队列与状态模型；**F-13 抖动抑制**（稳定窗口）、**F-14 建表责任**与四项最终复审修正 | SMTP-02～05／08～11／15／19／21 的单元用例 | **已实施并通过最终复审签核**，24 项定向测试全过；**不连接任何 SMTP 服务器** |
| S2 SMTP worker 与 API | 库选型、TLS、固定模板、超时重试、owner API；新增 API 复用 S1 已落地的 `requireOwner` 可选文案参数 | SMTP-06／07／12～18／20 的协议与 API 用例 | **未开始**（需先落定 SMTP 库的许可证、维护状态、lockfile、SBOM 与 amd64 离线镜像） |
| S3 交付接线 | Helm、Compose 示例、系统手册、升级回滚、依赖与 SBOM | SMTP-01／22～25 | **未开始** |
| S4 真实验收 | linux/amd64 K8s、客户目标 SMTP 与证据包 | SMTP-26；环境不足保持 blocked | **未开始** |

> **实现完成不等于验收通过。** SMTP-01–26 仍**未按正式验收口径执行**；本轮没有发出任何邮件，也没有建立任何出网连接。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（已同步登记到术语标准 §4.12）:

| Canonical Term | UI 主术语 | 禁止文案／边界 |
|---|---|---|
| Email Notification | 邮件通知 | 不写成「邮箱登录」「找回密码」；只承载选定通知 |
| SMTP Configuration | SMTP 配置 | 密码只称 SMTP 密码／Secret，不写入普通配置 |
| Notification Queue | 通知队列 | queued 不称已送达；不是审计账本 |
| Test Email | 测试邮件 | 202 只称「已加入发送队列」，不称「发送成功」 |
| Audit Health Alert | 审计健康提醒 | 只指本 Spec 的账本事故／恢复，不泛化为完整审计保证 |

既有「所有者」「登录账户」「配置审计」「操作者」「单实例」保持不变。SMTP、TLS、STARTTLS、CA、Secret、文件名、路径和 URL 的 DOM 必须添加 `translate="no"` 与 `notranslate`。

## 13. 评审检查点

- [x] 认可默认关闭、首批仅审计健康提醒与测试邮件、无忘记密码和部署许可通知。
- [x] 认可自由配置收件人而非账户邮箱模型，测试邮件也不接受任意收件人。
- [x] 认可持久 outbox、at-least-once、可能重复和有界重试，而非同步或恰好一次。
- [x] 认可审计／审计存储整体故障下通知可能不可靠，不以邮件替代原审计失败关闭。
- [x] 认可强制 TLS、Secret 文件、启动缓存、默认无外连和真实环境证据边界。
- [x] PM 签核设计基线（2026-10-26）：设计基线成立，暂不开发；开发授权与验收另行决定。
- [x] 2026-10-26 取得开发授权并实施 S1（见 §12）；验收（SMTP-01–26）仍未执行，S2／S3／S4 未开始。
- [x] S1 最终复审签核（2026-10-26）：F-18–F-22 已修正关闭；定向 24／24、全量 336 文件／3981 项通过（1 项跳过），类型无新增错误。仅签核 S1，不改变 SMTP 正式验收与 S2–S4 的未完成状态。
