# L25-01 Agent 与角色授权摘要 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md`](../specs/lucy-20261025-v0p25-access-authorization-summary-spec.md)（收口后 **v0.2**） |
| Plan | [`docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md`](../plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md)（收口后 **v0.2**；该 Plan 为六项 P1 Spec 共用，本批只收口其中的 **W2／P1-2／L25-01**） |
| 台账号 | L25-01（v0.25 登记册；§2.1 状态段已同步） |
| 层级 | **功能合同** |
| 结论 | **ASV-01–ASV-14 全部关闭。** 本条收口**不表示可上线**——浏览器实测与移动窄屏、镜像构建与部署、客户环境验证与客户交付不在本条出口 |
| 授权 | PM 2026-11-01 批准 C 档批次收口 |

---

## 一、出口矩阵结果（逐条 ASV → 用例 → 文件）

**证据等级：本地自动化（vitest）＋ 本地工程门禁。** 无 CI job 证据，无客户环境证据，无浏览器实测证据。

| ASV | 结果 | 证据落点（用例名 → 文件） |
|---|---|---|
| ASV-01 | 通过（**本次补 1 条**） | 新增「ASV-01 — 表数按规范源键去重；一句话、资源卡片与 capability 集合是同一个集合」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；既有「counts tables by 规范源键 de-duplication, never by grant path or tool×table tuple」→ `server/__tests__/p1-authorization-summary.test.ts`；既有「shows one headline with the readable connections, the deduped table count and the provable denominator」→ `src/__tests__/authorization-summary.test.tsx` |
| ASV-02 | 通过 | 「ASV-02 — 表数不重复、全部角色来源可见，OR 语义不变成 AND」→ `server/__tests__/p1-authorization-summary.test.ts` |
| ASV-03 | 通过 | 「ASV-03 — 表数不因工具数放大，每个工具×表×行边界仍可查」→ 同上 |
| ASV-04 | 通过 | 「ASV-04 — 分母只在可证明时展示；未知不填 0，也不保留陈旧数字」→ 同上 |
| ASV-05 | 通过 | 「ASV-05 — 最终行约束与运行时同一编译结果一致，且保留 OR-of-AND」→ 同上（与运行时 `resolveEffectivePermissionsBatchForAdmin` 的 `finalRowsBySource` 逐项比对 digest 与 OR 分支数） |
| ASV-06 | 通过 | 「ASV-06 — Role 不含 Agent 个人行限制，通用 Role 预览不冒充 Agent FinalRows」→ 同上 |
| ASV-07 | 通过 | 「ASV-07 — 摘要来自展开后编译产物；模板名仅作溯源，不改变摘要语义」→ 同上 |
| ASV-08 | 通过（**本次补 2 条**） | 新增「ASV-08 — 配置非法 → unavailable + access_invalid，不得以零值冒充无权限」「ASV-08 — 三类配置问题各自给出自己的问题码，互不串台」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；既有「场景1：配置缺失」「场景1b：配置路径不一致」「场景2：部分 Role 失败」「场景2c：全部 Role 失败」「场景2b／场景3／场景3b」→ `server/__tests__/p1-authorization-summary.test.ts` |
| ASV-09 | 通过（**本次补 1 条**） | 新增「ASV-09 — 候选摘要不落盘；草稿变化或基线变化都使旧预览失效」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；既有「marks a draft summary as a candidate that is not in effect yet」「场景8：草稿变化 → 旧候选摘要失效」→ `server/__tests__/p1-authorization-summary.test.ts` |
| ASV-10 | 通过（**本次补 4 条**） | 新增「ASV-10 — 深链只带预填参数，mode 恒为 dry-run，不带任何执行触发参数」「ASV-10 — Role 视图不提供 Agent 预填」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；新增「ASV-10 — 打开摘要只发一次只读请求，不会发任何调试台请求」「ASV-10 — 调试台入口是普通链接，不是一个会发请求的按钮」→ `src/__tests__/authorization-summary-closure.test.tsx`；既有「builds the MCP 调试台 deep link with agentId, mode, tool and url-encoded args」「offers the playground link on Agent resource rows only」「ASV-10 — the row-policy deep link points at the table that ACTUALLY has a row constraint」「ASV-10 — the deep link emits the row-policy view's own query parameter names」→ `server/__tests__/p1-authorization-summary.test.ts` |
| ASV-11 | 通过（**本次补 1 条**；L25-08 那一半由 **L25-08 自己的契约测试**承载，见下） | 新增「ASV-11 — 同快照下表身份一致，且同一 Agent 的最终行约束在两面完全相同」（与 R3 按表反查逐字段比对）→ `server/__tests__/p1-authorization-summary-closure.test.ts`；L25-08 半：「SC-14 — 同一快照下摘要表集合 = 授权路径表集合并集；四种计数分别表达」→ `server/__tests__/p1-access-map-contract.test.ts`；R3 另有一处：「RTV-06 — 同快照下三面表集合一致；授权路径数与去重表数分别表达、不混用」→ `server/__tests__/p1-row-policy-reconciliation.test.ts` |
| ASV-12 | 通过（**本次补 1 条**） | 新增「ASV-12 — 空能力与失败可分：零能力是 ok 的空集合，解析失败是 unavailable」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；既有「groups tools without changing their classification; AbsoluteDeny is never shown as grantable」「marks the legacy allow block as 旧 ACL without inventing a Role source」→ `server/__tests__/p1-authorization-summary.test.ts`；既有「never shows an AbsoluteDeny tool as a granted capability」「marks a legacy allow subject as 旧 ACL without inventing a Role source」→ `src/__tests__/authorization-summary.test.tsx` |
| ASV-13 | 通过（**本次补 3 条**） | 新增「ASV-13 — 响应不含 Token 明文、数据库密码或超授权内容，也没有任何凭据字段」「ASV-13 — 授权摘要没有写入口：preview 不落盘、不换入策略；写方法不存在」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；新增「ASV-13 — 页面（含属性）不含 Token 明文、数据库密码或超授权内容」→ `src/__tests__/authorization-summary-closure.test.tsx`；既有「never leaks token plaintext, database passwords or over-granted content」→ `server/__tests__/p1-authorization-summary.test.ts`；既有「leaks no token plaintext into the page」→ `src/__tests__/authorization-summary.test.tsx` |
| ASV-14 | 通过（**本次补 7 条**） | 新增「ASV-14 — 术语 lint 真实通过，且本条的新术语已在术语标准登记」→ `server/__tests__/p1-authorization-summary-closure.test.ts`；新增「ASV-14 — 连接、Schema、表、物理表、角色、工具与行分支都受翻译防御」「ASV-14 — 技术详情是原生可键盘操作的折叠控件」「ASV-14 — 资源表格有表题与列头作用域，不只靠颜色或位置表意」「ASV-14 — 分母不可证明时用文本说明，不用 0 也不用百分比」「ASV-14 — 配置非法时给出明确降级文案，并说清「不代表没有权限」」「ASV-14 — 行边界口径不同时，页面用文本说明是哪一种口径」「ASV-14 — 摘要区块是只读投影：面板里没有任何写控件」「ASV-14 — 读取失败时只报失败，不渲染一个空授权」→ `src/__tests__/authorization-summary-closure.test.tsx`；既有「Schema 值带 translate="no" + notranslate」→ `src/__tests__/authorization-summary.test.tsx`；**「既有页面行为无回归」**由既有页面测试承载：`src/__tests__/agent-detail.test.tsx`（25 条）、`src/__tests__/role-detail.test.tsx`（29 条）全绿 |

**实测（2026-11-01 复跑）**：

| 组 | 文件数 | 用例数 | 结果 |
|---|---|---|---|
| 本批新增 | 2（`p1-authorization-summary-closure.test.ts` / `authorization-summary-closure.test.tsx`） | **23** | 全绿 |
| L25-01 既有 | 3（`p1-authorization-summary.test.ts` / `authorization-summary.test.tsx` / `authorization-summary-route.test.tsx`） | 63 | 全绿 |
| ASV-11 跨面证据 | 2（`p1-access-map-contract.test.ts` / `p1-row-policy-reconciliation.test.ts`） | 5 | 全绿 |
| 既有页面回归 | 2（`agent-detail.test.tsx` / `role-detail.test.tsx`） | 54 | 全绿 |
| **合计** | **9** | **145** | **全绿** |

## 二、本批补的东西（只加测试，不改运行代码）

**未改任何 `webui/src/`、`webui/server/` 下的生产代码。** 本批只补**矩阵里有、仓里却没有任何断言**的那几小句。

| 新增文件 | 条数 | 每条打假的是哪条验收标准 |
|---|---|---|
| `webui/server/__tests__/p1-authorization-summary-closure.test.ts` | 12 | ASV-01（单 Role／单连接／多表：表数按规范源键去重、资源卡片与 capability 集合是同一个集合）／ASV-08（配置**非法**这一类问题此前无任何断言；三类问题码互不串台）／ASV-09（dry-run **不落盘** 与 **基线变化使旧预览失效**）／ASV-10（深链参数集合恰好是预填四项、`mode` 恒为 `dry-run`、无执行触发参数；Role 视图不提供 Agent 预填）／ASV-11（与 R3 同快照的**行边界**逐字段一致）／ASV-12（**空能力与失败可分**）／ASV-13（响应无凭据字段、无 Token 明文、无数据库密码、无超授权内容；**无新写入口**）／ASV-14（术语 lint 真实跑一遍 ＋ 新术语已在术语标准登记）＋ 1 条探测器自检 |
| `webui/src/__tests__/authorization-summary-closure.test.tsx` | 11 | ASV-10（打开摘要**只发一次只读请求**，页面自己不发任何调试台请求；调试台入口是普通 `<a>` 而不是会发请求的按钮）／ASV-13（**含属性**的泄漏检查，`innerHTML` 层面）／ASV-14（完整标识逐个翻译防御／原生可键盘操作的折叠控件／表格表题与列头作用域／降级状态由文本表达／面板无写控件／读取失败不渲染空授权） |

**补的是此前不存在的断言，不是改实现去凑门禁。** 逐条说明：

- **ASV-08 的 `access_invalid` 此前无任何断言。** 既有服务端用例覆盖了「配置缺失」（`access_unreadable`）与「配置路径不一致」（`access_config_path_mismatch`），**唯独「配置非法」这一类没有落点**——而它是 §2.1 枚举的第三类问题。实现本身正确（`server/admin/permission-display.ts:80` 正确产出 `access_invalid`），补的是断言。
- **ASV-09 的「不落盘」此前是空断言。** 既有「marks a draft summary as a candidate…」里的「已提交配置没有被改写」读的是**源码里的常量字符串**，与磁盘上的文件无关——它对着空气断言。新用例改为**逐字节比对磁盘上的 `access.yaml`**。
- **ASV-10 的「只触发既有 ACL 预览，不自动执行查询」此前只断言了 URL 形状。** 既有用例名写着「and no live-call trigger」，但函数体里没有一句断言与「不自动执行」有关。新用例从两头堵：① 服务端断言深链的查询参数集合**恰好**是 `agentId/mode/tool/args`、`mode` 恒为 `dry-run`（绝不 `live-smoke`）、`args` 只有表坐标；② 前端断言打开摘要页**只发一次 GET**、不发任何调试台请求，且调试台入口是普通链接。
- **ASV-13 的「无新写入口」与「数据库密码」此前无断言。** 新用例把写方法（PUT／PATCH／DELETE）在四条摘要路径上逐一打过去，并断言 preview 端点调用后 `access.yaml` **逐字节不变**、已提交配置的摘要**不变**。「数据库密码」此前从未被构造过：新夹具把密码标记同时写进 `access.yaml` 的 Role allow 块与 `ktx.yaml` 的连接块（`parseAccessConfigText` 不做字段白名单，这些标记**真的会留在运行时配置对象里**），再断言摘要响应里既没有这些字面量，也**没有任何形如凭据的属性名**。
- **ASV-11 的「行边界一致」此前无跨面断言。** 既有 `p1-row-policy-reconciliation.test.ts`（RTV-06）与 `p1-access-map-contract.test.ts`（SC-14）比的是**表集合与计数**；行边界这一半此前只有 ASV-05 拿摘要与**运行时自己**比。新用例把摘要的 `rowSummary` 与 **R3 按表反查**里同一个 Agent 的 `finalRows` 逐字段比对（digest、OR 分支数、分支文本），并断言两面发布同一个 `configVersion`。

### 变异验证：这些用例不是空转

对新补的断言逐条做了**变异测试**（改坏实现 → 对应用例必须转红 → 改回）。全部命中：

| # | 变异 | 转红的用例 |
|---|---|---|
| M1 | 深链 `mode=dry-run` 改成 `mode=live-smoke` | 服务端「ASV-10 — 深链只带预填参数，mode 恒为 dry-run」 |
| M2 | `headline.tableCount` 从 `countTables(canonicalRefs)` 改成 `capabilities.length`（工具×表元组数） | 服务端「ASV-01 — 表数按规范源键去重」 |
| M3 | `permission-display.ts` 的 `access_invalid` 改成 `access_unreadable` | 服务端两条「ASV-08」 |
| M4 | `rowSummaryForTable` 一律用有效行授予、忽略 Agent 的 `FinalRows` | 服务端「ASV-11 — 同快照下表身份一致，且同一 Agent 的最终行约束在两面完全相同」 |
| M6 | 零能力主体（`capabilities.length === 0`）被判成 `unavailable` | 服务端「ASV-12 — 空能力与失败可分」 |
| M7 | 摘要返回值里多一个 `password` 字段 | 服务端「ASV-13 — 响应不含 Token 明文、数据库密码或超授权内容，也没有任何凭据字段」 |
| M8 | preview 端点把候选配置写回 `access.yaml` | 服务端「ASV-13 — 授权摘要没有写入口：preview 不落盘、不换入策略；写方法不存在」 |
| M9 | 给摘要路由加一个 `DELETE` 端点 | 同上 |
| M10 | 资源卡片去掉表名的 `translate="no"` | 前端「ASV-14 — 连接、Schema、表、物理表、角色、工具与行分支都受翻译防御」 |
| M11 | 摘要面板里加一个写按钮 | 前端「ASV-14 — 摘要区块是只读投影：面板里没有任何写控件」 |
| M12 | 摘要区块挂载时自动发一次 ACL 预览请求 | 前端「ASV-10」两条（并连带其余断言全红） |

另有一条**探测器自检**（「凭据探测器自检：它真的能认出凭据字段」）保证 ASV-13 的递归键名扫描本身不是空转：它先证明探测器能命中 `bearerToken`／`dbPassword`／`credentials.password`，且不会把 `tokenCount` 这类计数字段误报。

## 三、工程门禁（2026-11-01 实测）

| 门禁 | 结果 |
|---|---|
| `node scripts/lint-spec-docs.mjs` | **exit 0**（343 files scanned，879 baseline exemptions——收口前 881，本批净减 2 条） |
| `node --test scripts/lint-spec-docs.test.mjs` | **exit 0**（**23/23**） |
| `npm run lint:terminology` | **exit 0**（1094 files scanned；另在服务端用例里真实跑一遍 `webui/scripts/lint-terminology.mjs`） |
| `npm run lint:spec` | **exit 0** |
| `npm run lint:ia-boundary` | **exit 0** |
| `npm run lint:version` | **exit 0**（`VERSION=0.20.0`） |
| `npm run test:root-contracts` | **exit 0**（**326 pass / 0 fail**） |
| `npm run test:ci-workflow-contracts` | **exit 0**（**62 pass / 0 fail**） |
| `npm --prefix webui run build` | **exit 0**（vite build ＋ precompress 94 assets） |
| `cd webui && npx tsc --noEmit` | 全仓 **86** 个既存错误（与收口前一致），**本条涉及文件 0 错** |
| `npm --prefix webui run e2e:selector-contract` | **exit 1**（既有基线），但**本批新增 0 条 issue** |

**证据等级说明**：按 `DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」，功能合同收口**不需要**客户环境证据——只有客户目标服务／真实升级／现场实例才能取得的结论归发布取证与交付层。因此本条**无 CI job 证据、无客户环境证据**这两点**不构成**把本条挂成未收口的理由；反过来，本条**不得**被读成「客户现场已验证」。本条也**不得**因为收口而放宽发布取证层的判据。

**selector contract 口径（本批实测）**：门禁当前输出 **201 条 fail**（`UNREGISTERED` 143 ＋ `UNREGISTERED TEMPLATE` 56 ＋ `SPEC-DANGLES-IMPL` 2），另有 **57 条 warn 级 `ORPHAN`** 不计入 fail 集。判据是「**不新增 issue**」，已用「把本批新增的两个用例文件临时移走复跑门禁、issue 行集合逐条 diff」证明——**diff 为空**（with-new 与 without-new 的 issue 行集合完全相同）。原因是本批新增文件全部落在 `webui/server/__tests__/` 与 `webui/src/__tests__/`，而门禁只扫 `webui/src/`（跳过 `__tests__/`）与 `webui/tests/e2e/specs/`，**未新增任何 `data-testid`**。

## 四、残余

1. **浏览器实测与移动窄屏验证未执行**——按 Spec §1.2 与「闭口层级」**不在本条出口**，不构成收口阻塞。
2. **ASV-11 的 L25-08 那一半，证据落在 L25-08 自己的契约测试文件里**（`p1-access-map-contract.test.ts`「SC-14」）。本批**没有**关闭 L25-08 的验收矩阵（Spec 187 的 SC-01–SC-14 仍为未执行）——本条只借用那个测试作为「同快照表集合一致」的行为证据。同理，R3（P1-1／L25-14）的 RTV-06 仍按其自身状态登记，**本批不回开也不改写它**。
3. **ASV-09 的「用旧摘要确认新草稿」这条禁令，在本条没有确认动作可打。** L25-01 是**只读投影**：摘要面板里**没有任何按钮**（本次新增用例专门断言这一点）。它做的是——草稿变化与基线变化都会让 `candidateDigest` 变（旧预览的令牌失效），并把该令牌随响应下发。真正「拿摘要去确认草稿」的动作在 Spec 150 的 diff／确认 Drawer 合同里，**不在本条出口**。
4. **全仓存在既有跨文件隔离 flake**（`context-policy-invalidation.test.ts` 等，聚集在 ktx.yaml／project-root／connections 线），与本条无关，未修也未计入本条失败数。

## 五、不在本次收口里

- **镜像构建、部署、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级**——归发布取证层。
- **L25-08（访问关系图）自身的验收矩阵**（Spec 187 的 SC-01–SC-14）——本批**不碰**。
- **P1-1／P1-3／P1-4／P1-5 的 Spec、Plan 与验收矩阵**——本批**不碰**；共用 Plan 只改了「版本／状态」一行，并写明本批只收口 W2。
- **E2E／real-e2e 目录下的用例**（`webui/tests/e2e/specs/p1-authorization-summary.spec.ts`、`webui/tests/real-e2e/authorization-summary-v025.spec.ts`）——按 Spec 自身约定**不属本条出口**，**未**被当作验收证据引用。
- **客户交付状态、Wave 0b、`blocked_delivery`、V01–V22、D-03**——本条**不改**这些状态。

## 六、复现命令

```bash
cd /private/tmp/ktx-c-tier/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  server/__tests__/p1-authorization-summary-closure.test.ts \
  server/__tests__/p1-authorization-summary.test.ts \
  server/__tests__/p1-access-map-contract.test.ts \
  server/__tests__/p1-row-policy-reconciliation.test.ts \
  src/__tests__/authorization-summary-closure.test.tsx \
  src/__tests__/authorization-summary.test.tsx \
  src/__tests__/authorization-summary-route.test.tsx \
  src/__tests__/agent-detail.test.tsx \
  src/__tests__/role-detail.test.tsx
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。

## 七、发现但**没有修**的真实实现缺口

**本批未发现真实实现缺口。** 逐条核对下来，ASV-01–14 涉及的运行行为与 Spec 一致；补齐的是**此前不存在的断言**，不是用改实现去凑门禁。上面 §二的变异验证反过来说明这一点：如果实现与 Spec 不符，被变异打坏的那条用例就会转红——它们全绿。

> 说明：ASV-08 的 `access_invalid` 在本批之前**没有断言**，但实现本来就是正确的（`server/admin/permission-display.ts:80`）。这是**覆盖缺口**，不是实现缺口。
