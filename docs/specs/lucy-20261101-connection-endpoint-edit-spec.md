# 连接服务器地址编辑 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.4.3 UX Dialog 补口文档定稿** |
| 日期 / 目标版本 | 2026-11-01（服务端）／2026-11-02（UX Dialog 补口）／不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P1**（连接运维主路径缺口）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.4.3 UX Dialog 补口已实施，功能合同未收口（2026-11-02）**。Codex r1–r4 见 [`docs/reviews/2026-11-02-codex-review-connection-endpoint-edit-dialog.md`](../reviews/2026-11-02-codex-review-connection-endpoint-edit-dialog.md)。服务端 SC 仍以 [`docs/reviews/2026-11-01-connection-endpoint-edit-closure.md`](../reviews/2026-11-01-connection-endpoint-edit-closure.md) 为准；UX SC-11–14／22／24–27 自动化已落（`edit-connection-dialog.test.tsx` 7/7），尚无逐条收口记录。本条收口不表示可上线 |
| 决策来源 | 连接概览无法改 host/port，只能删除重建；企业工具（如 Tableau）允许改服务器地址；场景为测库 ↔ 生产库切换（结构大体同构、数据不同）。2026-11-02：UAT 发现现实现用无 CSS 的 `pl-drawer-root`／`pl-drawer`，编辑表单掉到页底；委托人批准对齐 Tableau **Edit Connection dialog**（方案 A） |
| 需求来源 | 委托人产品评估与方案批准（2026-11-01）；交叉审阅 r1；2026-11-02 UX 补口批准（方案 A） |
| 实施主体 | WebUI：连接概览卡片入口 + **`EditConnectionDialog`**（居中 modal，替换失效的 inline Drawer）；服务端：`updateConnectionEndpoint` + `POST /api/connections/:connId/endpoint`（v0.3 已落地，本轮不改合同）；`decideEndpointEditGate`；`safeOverwriteSecretPassword` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **承接** Spec 124 开放项；**修正** Spec 26 / 160 / 127 Non-Goal（本条范围内）。Spec 184 / 181 不在本条。不修改 `createConnection` 测失败是否回滚的既有实现。v0.4 **只修订 UX 呈现**，不重开服务端写入合同 |
| 审阅 | 服务端 r1–r3（2026-11-01）；UX 补口：[`docs/reviews/2026-11-02-codex-review-connection-endpoint-edit-dialog.md`](../reviews/2026-11-02-codex-review-connection-endpoint-edit-dialog.md)（Codex CLI 三轮） |
| 实施计划 | [`docs/plans/lucy-20261101-connection-endpoint-edit-plan.md`](../plans/lucy-20261101-connection-endpoint-edit-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿：方案 A；测/生产同构；软结构警告 |
| v0.2 | 交叉审阅 r1：编辑专用门禁；锁内回滚基线；非 file: 密码拒绝；Drawer `current` 预填；secret 覆盖写合同；presence 三态强制；SC 扩至 SC-01–SC-22；手册同步范围 |
| v0.3 | 交叉审阅 r2：presence 绑定 live-tables；连通失败一律回滚（本条不做 failureKind）；`lucy-ops` 无条件禁改；门禁 reason 映射 / 校验码 / 信封 / 审计摘要等 P2 补口；SC-23；**服务端功能合同已收口**（SC-01–SC-23，见 §12.1） |
| v0.4 | UX 补口：对齐 Tableau Edit Connection **居中 Dialog**；废止 inline/`pl-drawer-root` Drawer 呈现；组件更名为 `EditConnectionDialog`；§9／Design System／SC-11–14／22 修订；新增 SC-24–SC-27（遮罩、居中、禁页底内联、提交中禁关） |
| v0.4.1 | Codex r1（UX-01–UX-08）：明确 jsdom＋生产 CSS 取证；表单必须在 Dialog 面板内且面板外零可编辑字段；submitting 守卫覆盖全部关闭入口；Toast 参数断言成功文案禁令；分范围 primary 计数；SC-14 逐项术语；收口镜像含 §12.2；收口前必须删除旧 Drawer 文件 |
| v0.4.2 | Codex r2：闭合 UX-01 残留（断言 `app.css` 中 modal 规则含 fixed／inset／居中，删改侧栏须失败）；焦点列入 SC-25；验收命令可从仓库根连续执行；残留扫描分源码／文档且错误失败 |
| v0.4.3 | Codex r3：遮罩 CSS 须含建立居中的布局方式（`flex` 或等价）；掏空 `flex` 夹具须失败；残留 `rg` 按退出码 0／1／其他三分 |

## 闭口层级

- 层级：功能合同
- 本条承诺：运维可在连接概览就地修改已有连接的服务器地址（及可选用户名；在约定 `file:` 密码来源下可选覆盖密码）；连通测试通过后落盘；连接 ID 与 Schema / 启用表范围 / 角色 / 语义 / Wiki 引用保持不变。**呈现**为对齐 Tableau 的居中 **编辑连接** Dialog（遮罩 + `aria-modal`），不得以内联页底表单呈现。
- 本条出口：分服务端与 UX 两层。
  - 服务端／API：SC-01–SC-10／15–21／23（**已关闭**，见 §12.1；本轮不重跑除非回归）。
  - UX／组件／术语：SC-11–14／22（**v0.4 重开**）＋ SC-24–SC-27（**新增**）；`lint:terminology` 无新增禁用词命中。
- 不在本条出口：浏览器 / Playwright E2E、移动窄屏、命名环境配置档、改 connection id / database / schemas / enabled_tables、读回密码、自动改 ACL、自动 ingest、列级/Manifest 对账、镜像构建与客户交付、修改 `createConnection` 既有回滚行为、Host 旁常驻「编辑」入口（可后续另开）。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Edit Connection | 编辑连接 | 修改数据源、换库、改链接、编辑联接 | 就地修改已有连接的服务器地址与可选凭据；不新建连接 ID |
| Connection Server Address | 服务器地址 | IP、Endpoint（作主标签）、主机端口（作主标签） | host 字段标签；卡片值仍可显示 `host:port` |
| Edit Connection Preview | 编辑预览 | — | dryRun：脱敏 diff + `current`；不含密码 |
| Keep Existing Password | 保留原密码 | 沿用密钥、不改 Token | 密码框留空且当前为约定 `file:` 时不覆盖 secret |
| Shared Endpoint Acknowledgement | 仍要改到相同端点 | 仍要新建连接、强制新建 | 编辑后与**其他**连接同端点时的显式确认 |
| Enabled Table Presence Warning | 启用表存在性提示 | 结构门禁失败、对象校验失败（作阻断主文案） | 提交成功后的软警告；不回滚 endpoint |

Forbidden:

- 把「编辑连接」写成「新建连接」或「删除连接」。
- 编辑冲突 UI 复用「仍要新建连接 / 添加 Schema / 新建连接」等 Spec 160 主术语。
- 成功文案声称「问数已切到新库」或「权限已恢复」。
- 在预览、审计或 Toast 中回显密码 / secret 内容。
- 用 primary 表示卡片上的「编辑连接」。

Protected DOM：Connection ID、driver/engine、host、port、username、`file:` 路径、`.ktx/secrets/…` → `translate="no"` + `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- `webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md`
- `webui/docs/124-connection-create-admin-spec.md`
- `webui/docs/127-connection-delete-spec.md`
- 参考实现：`webui/src/components/admin/RenewTokenDialog.tsx`（`pl-modal-backdrop` + `pl-modal-panel`）
- 业界参照：[Tableau Server — Edit Connections](https://help.tableau.com/current/server/en-us/connections_modify.htm)（Actions → Edit Connection → **dialog** → Save）

### What This Change Follows

- [ ] 「编辑连接」为卡片「更多」内次级 ghost / 菜单项；PageHeader「新建连接」为唯一实心 primary
- [ ] **居中 Dialog**（`pl-modal-backdrop` + `pl-modal-panel`，或等价 Radix Dialog Portal）；`role="dialog"` + `aria-modal="true"`；打开后焦点进入对话框
- [ ] Dialog 内确认写入（预览步「保存」）为 Dialog 内唯一 primary
- [ ] **禁止**使用未定义的 `pl-drawer-root` / 裸 `pl-drawer`；**禁止**把编辑表单以内联块插入连接列表文档流底部
- [ ] 选中态未误用 `primary` / `danger`
- [ ] 密码不进 Diff；成功后不残留
- [ ] 专业标识符翻译防御
- [ ] 无新增硬编码色值
- [ ] disabled 有前置说明（tooltip / `aria-describedby`）
- [ ] 文案符合术语标准；编辑冲突面板**不**复用新建动作文案
- [ ] 提交中（`submitting`）禁止 Esc／点遮罩关闭

### Exceptions (If Any)

- 「新建连接」继续用侧栏 Drawer（Spec 124）；「编辑连接」刻意用居中 Dialog 对齐 Tableau，二者壳层允许不同。

### Follow-up Needed

- 命名环境配置档另开 Spec。
- Host 旁常驻「编辑」入口另开体验补丁（本条 Non-Goal）。

---

## 1. 背景

1. Spec 124 交付新建连接，并推迟「编辑连接 / 轮换密码」。
2. 连接 ID 是稳定治理身份；测 ↔ 生产只换物理入口时，删除重建成本不对等。
3. 业界惯例允许编辑服务器地址并重测连通。
4. 产品场景：测试库 ↔ 生产库，结构大体同构、数据不同。
5. v0.1 交叉审阅指出：不可直接套用 Spec 160 新建决策器、回滚基线须锁内取得、非 `file:` 密码与 secret 覆盖写缺合同、`ConnectionInfo` 无 username。

## 2. 目标

1. `/connections` 适用卡片「更多」提供 **编辑连接** → **居中 Dialog**（对齐 Tableau Edit Connection dialog；非侧栏 Drawer、非页底内联表单）。
2. 可改 host、port、username；密码在约定来源下可选覆盖。
3. `POST /api/connections/:connId/endpoint`：默认 `dryRun:true`；`dryRun:false` 在写锁 + 展示屏障内落盘后强制连通测试，失败整单回滚。（v0.3 已落地）
4. 连接 ID、driver/engine、database、schemas、enabled_tables、access.yaml、语义目录、Wiki **不变**。
5. 编辑专用端点门禁（§5）；成功后强制启用表存在性抽检（三态，§8）。
6. 审计 `connection_endpoint_update`（脱敏）；响应含 `executionRuntimePending`（与同类写路由一致）。
7. 术语登记；历史 Spec 后继注记；手册结论性表述同步（v0.3 已做；本轮仅随组件更名核对）。
8. v0.4：消除「编辑连接打开后掉到页底」的呈现缺陷；组件契约名为 `EditConnectionDialog`。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 命名环境配置档 | 后续 Spec |
| 修改 connection id / database / schemas / enabled_tables | Spec 181 / 添加移除 Schema / 启用表 / Spec 184 |
| 硬阻断结构门禁 | 与大体同构冲突 |
| 列级 / Manifest / overlay 自动对账 | 语义漂移由运维切换后人工复核；见 §11 |
| 读回密码；自动 ACL / ingest | 安全与职责边界 |
| 把 `env:` / inline / 非约定 `file:` 密码改为 WebUI 可编辑 | §4.1 拒绝策略 |
| 修改 `createConnection` 测失败回滚行为 | 本条更严，不回潮 create |
| WebUI 登录鉴权；浏览器 E2E；移动窄屏 | 既有边界 |
| 成功即声称执行层已加载新 endpoint | Spec 191；仅 `executionRuntimePending` |

## 4. 适用范围与字段

### 4.1 可编辑

| 字段 | 规则 |
|---|---|
| host | 必填（有 host 的驱动）；规范化同 Spec 160 |
| port | 必填；1–65535；比较按整数；**写回保持磁盘原有标量类型**（字符串仍字符串） |
| username | 可改；去首尾空白后区分大小写比较 |
| password | 可选。留空 = 保留原凭据来源（不写 secret）。非空仅当当前 password 为约定路径 `file:.ktx/secrets/<connId>-password`（或项目相对等价解析结果）时允许覆盖；否则 `CONNECTION_PASSWORD_SOURCE_NOT_EDITABLE`，**不得**创建未被引用的 secret |

### 4.2 只读

Connection ID、driver、engine / wire_protocol、database、schemas、enabled_tables、readonly、密码文件相对路径文案（不展示内容）。

### 4.3 适用性拒绝（服务端）

| 条件 | `error.code` |
|---|---|
| 未知 `connId` | 既有连接 404 |
| driver 无经典 host:port（如 sqlite、athena） | `CONNECTION_ENDPOINT_UNSUPPORTED_DRIVER` |
| `lucy-ops`（`OPS_EVIDENCE_CONNECTION_ID`） | **一律** `CONNECTION_ENDPOINT_FORBIDDEN`；与删除守卫同源，无条件 |
| 无字段变更且密码留空 | `CONNECTION_ENDPOINT_NO_CHANGE`（仅 `dryRun:false`） |
| port 越界 / host 空 / username 空（适用驱动） | `CONNECTION_ENDPOINT_INVALID_FIELD`（进 detail 白名单） |

### 4.4 Drawer 预填数据

**不**扩展全局 `ConnectionInfo`。dryRun / 成功响应增加：

```ts
current: { host: string; port: number; username: string }
```

username 仅用于编辑预填与 diff；不改变列表 API。卡片「Host」标签可保留；Dialog 字段标签用「服务器地址 / 端口 / 用户名 / 数据库密码」。

## 5. 编辑路径端点门禁

**不得**调用 `decideEndpointGate` / `conflictSchema`。新增 `decideEndpointEditGate(root, connId, candidate, flags)`：

- 复用 Spec 160 的 `normalizeHost` / 端口整数比较 / `endpointMatches` / `sameServer` **键定义**。
- 匹配集合 **排除** `connId`。
- **不**检查 schemas 数量；**不**走「添加 Schema / 复用凭据」分支。

| 情况 | 行为 |
|---|---|
| 无其他匹配 | 通过 |
| 恰好一条其他连接 endpoint 匹配，未确认 | `ENDPOINT_EDIT_CONFLICT`，`detail.reason=shared_endpoint`；`detail.matches` 含该连接（id/host/port/username） |
| 两条及以上其他连接 endpoint 匹配，未确认 | 同上，`detail.reason=multiple`；`matches` 列出全部 |
| 上述且 `acknowledgeSharedEndpoint: true` | 允许写入（软门禁，非唯一约束） |
| 仅同服务器不同 database（PG/SQL Server/Oracle），未确认 | `ENDPOINT_EDIT_CONFLICT`，`reason=same_server_different_database`；需 `acknowledgeSameServerDifferentDatabase: true` |
| 候选端点与其他连接的冲突在编辑前已存在，且本次未改变 host/port（例如只改 username） | **仍需**确认（不豁免）；避免静默维持分叉身份而不提示 |

确认字段 **不得** 复用 `acknowledgeSeparateConnection` / `acknowledgeDifferentDatabase` 的新建主术语。UI 主术语：「仍要改到相同端点」。

`index.ts` 的 `endpointGateDetail` / `supportedErrorDetail` **必须**放行本条 code/reason（含 `ENDPOINT_EDIT_CONFLICT`、`CONNECTION_ENDPOINT_*`），否则前端拿不到 matches。

## 6. API 合同

### 6.1 路由

`POST /api/connections/:connId/endpoint`

### 6.2 请求体

```ts
type UpdateConnectionEndpointInput = {
  host: string;
  port: number;
  username: string;
  password?: string;
  dryRun?: boolean; // default true
  acknowledgeSharedEndpoint?: boolean;
  acknowledgeSameServerDifferentDatabase?: boolean;
};
```

### 6.3 响应

外层信封与既有写路由一致：`{ ok: true, data: { ... } }` 或 `{ ok: false, error: { code, message, detail? } }`。下列字段均在 `data` 内。

- dryRun：`{ diff, proposedYaml, current, passwordAction: "keep" | "replace", connection? }`；无密码。门禁未通过时走错误信封，**不**在成功体里放 `endpointGate`。
- 成功写入：`{ written: true, auditId?, current, connection, test: { status: "ok", message?, durationMs? }, presence: PresenceResult, executionRuntimePending: true, passwordAction }`。
- 测失败：回滚后错误信封；磁盘恢复锁内快照。
- 门禁 / 密码来源 / 无变更 / 校验：对应稳定 code + detail。

端口：以 `current.port`（number）为准渲染编辑表单；`connection` 若出现则沿用既有 `ConnectionInfo`（`port` 可能为 string），**不**承诺与 `current` 类型一致。

```ts
type PresenceResult =
  | { status: "ok"; missingEnabledTables: [] }
  | { status: "missing"; missingEnabledTables: string[] }
  | { status: "not_completed"; reason: string; missingEnabledTables?: string[] };
```

审计 `oldSummary` / `newSummary`（脱敏）至少含：`connectionId`、前后 `host`/`port`/`username`、`passwordAction`、`passwordBytes`（仅长度）、`testStatus`；**禁止**密码明文与 secret 内容。

### 6.4 写入、锁与回滚

1. **锁外** dryRun 仅服务展示；其 `oldText` **不得**作回滚基线。
2. `dryRun:false`：**必须** `withKtxYamlWriteLock` → `withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES)`（强制，非可选）。
3. 持锁后：重读磁盘 → 校验存在 / 适用性 / 门禁 → **锁内** dryRun 取得 `oldText` → 备份 secret 字节（若 replace）→ 写 secret（若有）→ 写 yaml → `ktx connection test`（超时与现网一致，约 30s；持锁期间会阻塞其他配置写，属已知影响）→ 失败则用**锁内** `oldText` + 旧 secret 字节恢复 → 成功则审计；审计失败同样回滚。
4. mutator **仅** patch 该连接的 host/port/username；replace 密码时 yaml 的 `password:` 行保持约定 `file:` 引用不变（已是约定路径时）。
5. 并发：预览与持锁之间另一请求修改**其他**连接时，本单失败回滚不得抹掉那次修改（SC-16）。

### 6.5 Secret 覆盖写入合同

新增 `safeOverwriteSecretPassword(projectRoot, relPath, plaintext)`（`fs-safe.ts`）：

- 复用 `resolveNewSecretPasswordTarget` 的路径 / 符号链接 / 越界校验。
- 同目录临时文件写入 → `rename`；模式 `0600`。
- 回滚 = 用备份字节原子写回同一路径（或在本单新建且原先不存在时删除——约定路径下原先应存在）。
- **不得**削弱 `safeWriteNewSecretPassword` 的 new-only / `SecretAlreadyExistsError` 语义。

## 7. 核心流程（伪代码）

```text
function updateConnectionEndpoint(root, connId, input, dryRun):
  // --- display-only path (no lock) when dryRun ---
  existing = readConnection(root, connId) or 404
  assertSupportedDriver(existing)
  assertNotForbidden(existing)
  validate host/port/username
  passwordAction = trim(password).length > 0 ? "replace" : "keep"  // 仅空白视为 keep
  if passwordAction == "replace":
    assertCanonicalFilePassword(existing) or CONNECTION_PASSWORD_SOURCE_NOT_EDITABLE
  if passwordAction == "keep" and driverNeedsSecret:
    assert credentials resolvable for test (canonical file exists or env/inline present)

  candidate = merge(existing, host/port/username)
  gate = decideEndpointEditGate(root, connId, candidate, ackFlags)  // excludes self; no conflictSchema
  if gate.blocked: return gate error

  if noChange(existing, candidate) and passwordAction == "keep":
    if dryRun: return no-op preview + current
    else: CONNECTION_ENDPOINT_NO_CHANGE

  if dryRun:
    preview = writeKtxYaml(patch mutator, dryRun=true)  // display only
    return redacted preview + current + passwordAction

  // --- commit path ---
  withKtxYamlWriteLock:
    withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES):
      re-read; re-validate; re-gate
      if noChange and keep: CONNECTION_ENDPOINT_NO_CHANGE
      lockPreview = writeKtxYaml(mutator, dryRun=true)  // oldText = rollback baseline
      oldSecret = passwordAction == replace ? readSecretBytes(relPath) : null
      try:
        if replace: safeOverwriteSecretPassword(relPath, password)
        writeKtxYaml(mutator, dryRun=false, lockHeld)
        test = testConnection(connId)  // connectivity/credentials; see §8
        if test.failed:
          restore yaml from lockPreview.oldText
          restore secret bytes if replace
          return error
        // presence 必须在审计前、且在回滚边界之外：异常只降级为 not_completed，永不回滚已成功写入
        presence = runPresenceCheck(enabled_tables, bypassCache=true)
          catch any → presence = { status: "not_completed", reason: "probe_error" }
        audit connection_endpoint_update (or rollback yaml+secret on audit failure; presence 结果仍附带若已算出)
        return success + presence + executionRuntimePending=true
      catch e:
        restore yaml + secret; throw e
```

**与 create 的规范差异：**

1. replace 允许覆盖约定 secret；create 仍 new-only。
2. 本条测失败 **必须** 回滚；不沿用 create 仅返回 `test.status=error` 的宽松行为。

## 8. 测 / 生产同构护栏

| 层级 | 行为 |
|---|---|
| `ktx connection test` | **硬门禁**：本条**不做** `failureKind` 结构化分类。凡 `testConnection` 返回非 ok（含上游 CLI 因对象缺失等意外失败）→ **一律回滚**。启用表缺失的产品层披露只走下方 presence，不依赖 CLI 归因 |
| 启用表存在性 | **强制软检查**（仅在硬门禁通过且 yaml/secret 已提交之后、审计之前）：数据源 = 现有 **live-tables**（按 `enabled_tables` 推断 schema 拉清单，本地比对，**不**另开临时 DB 连接）；**必须绕过** live-tables 缓存/TTL（endpoint 已变、connectionId 未变）；键对齐沿用 Spec 190 `LiveTableEntry` 物理名规则；单次最多 **3** 个 distinct schema（超出、总耗时 >10s、或驱动不支持表清单如 SQL Server/Oracle → `not_completed`，`reason` ∈ `budget_exceeded` \| `timeout` \| `unsupported_driver` \| `probe_error` \| `queue_busy`）；探测抛错只降级，**永不**回滚 endpoint |
| Schema / Manifest / 列 diff | 本条不做；切换后运维须人工复核 overlay（§11） |

成功 UI：**不得**写「问数已切到新库」；可提示执行运行时待重载（`executionRuntimePending`）。

## 9. UX

### 9.1 入口（对齐 Tableau Actions）

1. 仅在 **连接概览**（`/connections`）连接卡「更多」菜单内提供 **编辑连接**（次级 ghost / 菜单项）。
2. 不适用驱动 / `lucy-ops` / 无 host：入口 disabled + 前置说明（tooltip / `aria-describedby`）。
3. PageHeader「新建连接」仍为页内唯一实心 primary。
4. 本条 **不** 在 Host 展示旁加常驻编辑按钮（Non-Goal）。

### 9.2 弹层形态（对齐 Tableau Edit Connection dialog）

1. 组件名：`EditConnectionDialog`（替换／废除以 `EditConnectionDrawer` + `pl-drawer-root` 呈现的实现）。收口前必须删除旧文件、旧导入与旧测试路径；允许过程中短暂 re-export，**不得**带着旧文件勾销 Task。
2. 壳层：**居中对话框** = 全屏遮罩 + 居中面板。推荐类名：`pl-modal-backdrop` + `pl-modal-panel`（与 `RenewTokenDialog` 同构）；或 Radix `Dialog.Portal` 等价物。必须满足：
   - `role="dialog"` 且 `aria-modal="true"`
   - 遮罩节点带生产类名 `pl-modal-backdrop`（或 Radix Overlay 且测试能定位到等价遮罩）；**不得**仅用自定义 `data-testid` 冒充壳层合同
   - 相对视口 `fixed` 遮罩；面板在视口中央（非 `justify-end` 侧栏）
   - 打开时焦点进入对话框
   - 非 submitting：Esc、点遮罩、显式「关闭」按钮均可关闭
   - **`step === "submitting"`**：上述**全部**用户关闭入口（Esc／遮罩／关闭／取消／等价）均不得调用 `onClose`；失败后恢复可关闭；成功仅在 mutation `onSuccess` 路径关闭
3. **取证约束（防假阳性）**：
   - 组件测须挂载**真实** `EditConnectionDialog`（可经 ConnectionOverview「编辑连接」入口，或单测直接 open），禁止只断言空壳 testid。
   - 布局断言（两层，缺一不可）：
     1. **DOM**：遮罩／面板使用生产类 `pl-modal-backdrop`／`pl-modal-panel`（或已证明等价的 Radix 类）；**不含** `pl-drawer-root`／裸 `pl-drawer`／`pl-drawer-backdrop`。不得用 testid-only 或内联 style mock。
     2. **生产 CSS 文本**：测试读取 `webui/src/app/app.css`（或构建后仍保留这些工具类组合的同源样式文件）中 `.pl-modal-backdrop` 规则，断言其声明（含 `@apply` 展开前的源文本）同时包含：
        - 视口固定与覆盖：`fixed` 与 `inset-0`
        - **建立居中的布局方式**：现行实现为 `flex`（使交叉轴／主轴对齐生效）；若改用 grid 等等价方式，须在 Spec／测中同步改写判据，不得只留对齐类名
        - 双向居中：`items-center` 与 `justify-center`
        若规则被删除、改成 `justify-end`／侧栏、去掉 `fixed`／`inset-0`、或去掉使居中生效的 `flex`（对齐类名仍在但布局方式缺失），该断言**必须失败**。仅有 DOM 类名而 CSS 规则被掏空 ≠ 通过。
   - 焦点：打开后 `document.activeElement` 位于 Dialog 面板内（或面板内第一个可聚焦控件）。
   - 字段归属：打开后全局 `edit-connection-host|port|username|password` 可编辑控件有且仅有一套，且全部是 Dialog 面板子孙；面板外可编辑编辑字段数为 0。
4. **禁止**：
   - 使用仓库 CSS 未定义的 `pl-drawer-root` / 裸 `pl-drawer`
   - 将编辑表单作为连接列表文档流的内联块渲染（页底「多出一块表单」即合同失败）
   - 复用「新建连接」侧栏 Drawer 壳冒充本条 Dialog（允许共享表单字段子组件，但壳层合同是 Dialog）

### 9.3 对话框内容与步骤

1. 标题：**编辑连接**。副文说明：切换服务器地址；连接 ID、Schema、启用表范围不变。
2. 只读：连接 ID；可选展示打开时的当前 `host:port` 对照（只读文案，非第二套可编辑字段）。
3. 可编辑：服务器地址、端口、用户名、数据库密码（placeholder「留空则保留原密码」）。非约定密码来源：密码框 disabled + 说明须手工改 `ktx.yaml`/环境变量。
4. 打开时用 dryRun 响应的 `current` 预填（§4.4）；不得依赖列表 `ConnectionInfo` 的 username。
5. 步骤：`input` →（预览变更）→ `preview` →（保存）→ `submitting`。预览步展示脱敏 diff + `passwordAction`；冲突用**编辑专用**提示（「仍要改到相同端点」），**不**复用新建 `EndpointConflictPanel` 主按钮文案。
6. **Primary 分范围计数**：
   - **PageHeader 动作组**：页内唯一实心 primary 仍为「新建连接」（SC-13）。
   - **Dialog 动作组**：输入／冲突步唯一 primary 文案为「预览变更」；预览步唯一 primary 文案为「保存」（对齐 Tableau Save；技术上仍走 `dryRun:false`）。两组分别计数，互不替代。
7. 成功：Toast（禁止「问数已切到新库」「权限已恢复」）；关闭 Dialog；刷新连接列表相关 query。presence `missing` / `not_completed` 用 warning Toast／Notice。组件测须断言 Toast 调用参数（不得把 toast mock 成空函数后只查 DOM 无禁词）。失败路径不得调用成功 Toast。

## 10. 历史 Spec 与手册

后继注记已挂 124/26/160/127。实现轮须同步 **结论性** 表述，至少：

- `docs/SYSTEM_HANDBOOK.md` 中「修改 host/port…仅手工」「WebUI 不写入 host/port…」等（审阅 r1 所列多处）
- 视需要：`docs/design/design-db-connection.md`、`docs/webui/webui-feature-map.md`
- 术语标准登记本条 New terms
- `webui/src/lib/configAuditLabels.ts` 增加 `connection_endpoint_update`
- `webui/docs/03-api-spec.md` 路由行（若该表维护中）

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 误切到结构差的库 | presence 软警告 + 文案；不做假「语义已对齐」 |
| 语义层 / overlay 仍描述旧结构 | Non-Goal；风险明示；切换后人工复核 |
| 上游 `connection test` 因对象缺失等非连通原因失败 | 本条一律按硬门禁回滚；软警告层不可达。已知局限，不做 failureKind |
| 覆盖 secret 半成品 | 字节备份 + 原子写 + 锁内回滚 |
| 持锁测连接阻塞其他写 | 文档化 ~30s 预算 |
| 执行层仍用旧 endpoint | `executionRuntimePending`；禁止「问数已切换」文案 |
| WebUI 无登录 | 沿用 Spec 124 已知风险 |

## 12. 验收（SC）

| ID | 断言 | 证据 |
|---|---|---|
| SC-01 | dryRun 含新旧脱敏 diff + `current`（含 username），无密码 | 服务端 |
| SC-02 | 无变更 + keep：dryRun 无变更预览；false → `CONNECTION_ENDPOINT_NO_CHANGE` | 服务端 |
| SC-03 | 仅改 host/port，keep：yaml 更新、secret 字节不变、test ok | 服务端 |
| SC-04 | replace：覆盖后字节=新密码；test 失败后 secret **逐字节**回旧；create new-only 回归仍抛 `SecretAlreadyExistsError` | 服务端 + fs-safe |
| SC-05 | test 失败：host/port 保持锁内写入前值 | 服务端 |
| SC-06 | 撞其他连接无确认：`ENDPOINT_EDIT_CONFLICT`，matches 不含自身，不写入 | 服务端 |
| SC-07 | `acknowledgeSharedEndpoint: true` 允许同端点写入 | 服务端 |
| SC-08 | 写入后 id/schemas/enabled_tables 与调用前逐字相同 | 服务端 |
| SC-09 | 审计 `connection_endpoint_update`，摘要无密码；审计失败回滚 | 服务端 |
| SC-10 | 成功响应含 `presence` 三态之一；`missing` 时 yaml 仍为新 endpoint | 服务端 |
| SC-11 | 概览「更多」含「编辑连接」；点击后打开真实 Dialog；ID 只读；预填=响应 `current`；全局可编辑编辑字段仅一套且均在 Dialog 面板内 | 组件（**v0.4 重开**） |
| SC-12 | 留空密码 keep；预览→保存；断言 Toast 参数：成功／presence 警告不得含「问数已切到新库」「权限已恢复」；失败不得成功 Toast | 组件（**v0.4 重开**） |
| SC-13 | PageHeader 动作组唯一实心 primary＝「新建连接」；Dialog 动作组各步唯一 primary＝「预览变更」或「保存」（分范围计数） | 组件（**v0.4 重开**） |
| SC-14 | 术语标准含本条 **全部** New terms 六行（含 Edit Connection Preview／编辑预览）；`lint:terminology` 退出 0 | 文档 + lint（**v0.4 核对**） |
| SC-15 | 未知 connId → 404 | API（已关闭） |
| SC-16 | 并发：他连接在预览后写入；本单测失败回滚后他连接变更仍在 | 服务端（已关闭） |
| SC-17 | 非约定 password 来源 + 提交新密码 → `CONNECTION_PASSWORD_SOURCE_NOT_EDITABLE`，无新孤儿 secret | 服务端（已关闭） |
| SC-18 | sqlite/athena（或无 host 驱动）→ `CONNECTION_ENDPOINT_UNSUPPORTED_DRIVER` | 服务端（已关闭） |
| SC-19 | port 越界 / 必填空 → 400 | API/服务端（已关闭） |
| SC-20 | 错误 detail 白名单放行本条 gate code，前端可得 matches | API（已关闭） |
| SC-21 | 成功响应含 `executionRuntimePending: true` | API（已关闭） |
| SC-22 | 编辑冲突 UI 不出现「仍要新建连接 / 添加 Schema」主按钮文案 | 组件（**v0.4 重开**） |
| SC-23 | 编辑 `lucy-ops` → `CONNECTION_ENDPOINT_FORBIDDEN`；磁盘不变 | 服务端（已关闭） |
| SC-24 | DOM 使用 `pl-modal-backdrop`；不含 drawer 类；**且**读取生产 `app.css` 中该遮罩规则含 `fixed`＋`inset-0`＋布局方式 `flex`（或已登记等价）＋`items-center`＋`justify-center`；掏空／去 `flex`／改侧栏必须失败 | 组件（**v0.4 新增**） |
| SC-25 | 面板使用 `pl-modal-panel`；`role="dialog"` + `aria-modal="true"`；打开后焦点在对话框内 | 组件（**v0.4 新增**） |
| SC-26 | 打开后：可编辑 `edit-connection-*` 字段全局唯一且均为 Dialog 面板子孙；面板外可编辑编辑字段＝0（禁页底／列表旁内联回归） | 组件（**v0.4 新增**） |
| SC-27 | `submitting` 期间 Esc／点遮罩／关闭／取消均不调用 `onClose`；非 submitting 时 Esc／遮罩／关闭可关；失败后可再关 | 组件（**v0.4 新增**） |

### 12.1 执行记录（2026-11-01 服务端收口）

SC-01–SC-10／15–21／23 **已关闭**（当时含旧 Drawer 版 SC-11–14／22）。逐条落点与命令输出见 [`docs/reviews/2026-11-01-connection-endpoint-edit-closure.md`](../reviews/2026-11-01-connection-endpoint-edit-closure.md)。

| 命令 | 结果 |
|---|---|
| `cd webui && npx vitest run`（本条 5 个测试文件） | **81 passed** |
| `npm run lint:terminology` | exit 0 |
| `npm run lint:spec-docs` | exit 0 |

### 12.2 v0.4 UX 补口（待实施）

SC-11–14／22／24–27 **未关闭**。关闭证据写入新的收口／实施笔记；不得用 §12.1 旧 Drawer 组件测冒充 Dialog 通过。

状态转换（定稿／授权开发／收口）时，必须同次更新：Spec 头部「状态」、本小节文案、SC 表状态标注、Plan 头部「状态」、`docs/README.md` 与 `docs/plans/README.md` 索引句，使用同一句现值；收口时另挂证据链接。

## 13. 开放依赖

1. WebUI Admin 鉴权。
2. 命名环境配置档。
3. 对象级替换向导深化（Spec 184）。
