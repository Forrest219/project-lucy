# 2026-10-28 P1 预发布 UAT：L25-01 授权摘要 / L25-08 访问关系图

本轮只做预发布验收取证。未改产品代码、规格或配置，未提交 git，未构建镜像，未清 volume。结论词汇只用 `passed_automation` / `failed` / `blocked` / `not_run`。本报告不给出 UAT 通过。

## 结论

L25-01（授权摘要）与 L25-08（访问关系图）在本轮允许的聚焦 Vitest 里没有失败用例，也没有新的实现缺陷。摘要、资源卡片与访问关系图的授权表集合，在已跑的同源夹具上一致；行边界与运行时编译结果一致。这只证明点名夹具可重复，不证明两条规格已经验收完成。

签核规格的状态行仍是「已实现，未验收」，矩阵仍写「全部未执行」。这个「未执行」与本报告不记 UAT 通过是一致的，本轮不回写规格。桑基规格里仍有「本轮只做设计 / 组件未实现」的句子，与已经落地的实现冲突，记为规格漂移。

`http://127.0.0.1:55176/api/health` 连接被拒绝，不是 200。浏览器与 Docker 演示栈记 `not_run`。没有启动构建。

## 范围

| 项 | 取值 |
|---|---|
| 仓库 | `/Users/forrest/GitHub/project-lucy` |
| 分支 / HEAD | `lucy-v0.25` / `17fdaf0850e27dbb724cf932f9d51e9af5d72815` |
| 功能提交 | `28780eae`（两份规格状态行所引的实现提交） |
| L25-01 | `docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md` §8 ASV-01–ASV-14。实现 `webui/server/admin/authorization-summary.ts` 及摘要页面 |
| L25-08 | `webui/docs/187-access-relation-sankey-spec.md` §1.3 / §10 SC-01–SC-14。实现 `webui/server/admin/access-map.ts`、`webui/src/pages/admin/AccessMap.tsx` |
| 工作区 | 上述实现文件与两份规格相对 HEAD 无未提交改动。未提交的 L25-16 / 运维控制面文档按指令忽略。工作区另有未提交的 `reconciliation.ts`、`audit-classification.ts`、`mcp-proxy.ts`，不纳入本功能结论 |
| 环境 | Node `v24.14.1`，Vitest `4.1.9`。`KTX_PROJECT_ROOT=/tmp/lucy-uat-ktx-hZYgfH` |
| 明确不做 | 全量 Vitest、Playwright、浏览器、镜像重建、清 volume、改授权 |

合同：不打开 YAML，同一张表的允许 / 拒绝在摘要、资源卡片、访问关系图和 capability dry-run 上应当一致，且本功能不改授权。

## 命令与结果

工作目录 `webui/`。一次命令，`--maxWorkers=1`。没有失败，因此没有按 inbox 碰撞再单跑某个文件。

```bash
KTX_PROJECT_ROOT=$(mktemp -d) npx vitest run --maxWorkers=1 \
  server/__tests__/p1-authorization-summary.test.ts \
  server/__tests__/p1-access-map.test.ts \
  server/__tests__/p1-access-map-contract.test.ts \
  server/__tests__/p1-access-map-conservation.test.ts \
  src/__tests__/authorization-summary.test.tsx \
  src/__tests__/authorization-summary-route.test.tsx \
  src/__tests__/access-map.test.tsx
```

开始于 2026-10-28 22:44:26，耗时 3.06s，退出码 0。`Test Files 7 passed`，`Tests 118 passed`，失败 0。

| 文件 | 结果 |
|---|---|
| `server/__tests__/p1-authorization-summary.test.ts` | 37 passed |
| `server/__tests__/p1-access-map.test.ts` | 37 passed |
| `server/__tests__/p1-access-map-contract.test.ts` | 4 passed（SC-11、SC-06、SC-12 旁路、SC-14） |
| `server/__tests__/p1-access-map-conservation.test.ts` | 2 passed |
| `src/__tests__/authorization-summary.test.tsx` | 22 passed |
| `src/__tests__/authorization-summary-route.test.tsx` | 4 passed |
| `src/__tests__/access-map.test.tsx` | 12 passed |
| 合计 | **7 文件 / 118 passed / 0 failed** |

健康检查：

```bash
curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:55176/api/health
```

`curl: (7) Failed to connect to 127.0.0.1 port 55176`，HTTP 状态不是 200。Docker 演示栈记 `not_run`。

## ASV 矩阵

判定：本轮命令里直接断言该条通过标准的用例已通过，记 `passed_automation`。签核方式要求全量套件或实机页面、而本轮没有跑，整条记 `not_run`。片段通过不升格成 UAT 通过。

| ID | 本轮 | 说明 |
|---|---|---|
| ASV-01 | passed_automation | `p1-authorization-summary`：单连接多表按规范源键去重，表数不随工具×表放大。页面用例一句话为「可读 1 个连接、13 张表中的 2 张」，并带授权路径数 |
| ASV-02 | passed_automation | 命名用例：同表两 Role，表数 1，角色来源两条，OR 不被收成 AND |
| ASV-03 | passed_automation | 命名用例：多工具覆盖同表不放大表数；每个工具仍带行边界 |
| ASV-04 | passed_automation | 分母可证明才展示；未知不填 0，也不沿用上一轮已证明的数字。页面未知分母写「启用表总数暂不可用」 |
| ASV-05 | passed_automation | Agent 最终行约束 digest / OR 分支与 `resolveEffectivePermissionsBatchForAdmin` 的 `finalRowsBySource` 一致，保留 OR-of-AND |
| ASV-06 | passed_automation | Role 行摘要 basis 为 `effective_row_grant`，不含 Agent 个人行限制；`__role_preview__` 不冒充 FinalRows |
| ASV-07 | passed_automation | 摘要来自展开后的编译产物；模板名只作溯源 |
| ASV-08 | passed_automation | 缺失与路径不一致为 `unavailable` 且无「0 张表」；部分 Role 失败为 `partial` 并列出失败角色；全部失败不为零值。`access_invalid` 没有单独夹具，与前两类共用 `!runtimeConfig → unavailable` |
| ASV-09 | passed_automation | 草稿 `basis=draft`、`candidateOnly`，候选表变为 `fin_budget`；已提交 `tableSelectors` 仍是 `fin_ledger`。`candidateDigest` 随草稿变 |
| ASV-10 | passed_automation | 深链含 `agentId`、`mode=dry-run`、`tool=lucy_query`，`args` 为卡片上的 `connectionId` 与 `sourceName`。行权限深链指向真正有行约束的表。实机调试台未开，见 not_run |
| ASV-11 | passed_automation | 与 L25-08 的表集合对账在 SC-14；路径数、去重表数、访问路径数、调用数分列。与 R3 的行边界对账在 ASV-05 |
| ASV-12 | passed_automation | legacy 标「旧 ACL」且不编造角色来源；空能力与失败可分；AbsoluteDeny 不出现在可授予工具里 |
| ASV-13 | passed_automation | 响应与页面夹具不含 Token 明文与 hash；未授予表 `fin_budget` 不出现。草稿预览不落盘。访问关系图 POST/PUT/DELETE 为 404 |
| ASV-14 | passed_automation | 术语 lint 在 SC-11 用例里真实执行，输出含 `Terminology lint passed`。Schema 值有 `translate="no"` 与 `notranslate`。技术详情默认折叠。键盘实机走查与既有页面全量回归未做，残留见 not_run，本条不升格为 UAT 通过 |

## SC 矩阵

| ID | 本轮 | 说明 |
|---|---|---|
| SC-01 | passed_automation | 服务端构图含 Agent、角色、连接、表（SC-08 夹具 40+1+1+200）。页面夹具挂载四层节点；副行函数为「N 个 Agent · M 条路径」。组件用例没有单独断言这句副行文案。浏览器 E2E 未跑 |
| SC-02 | passed_automation | `p1-access-map-conservation`：随机权限下非凭证节点入流授权路径数等于出流，误差 0；篡改一条边宽后判定变红 |
| SC-03 | passed_automation | 访问数为 0 的边 `state === "dormant"`，`accessPaths === 0`；有访问的边内核取访问路径数而不是调用次数。未量 SVG 像素宽度 |
| SC-04 | passed_automation | Token 挂在 Agent 下，带 label、状态、统计期调用次数。按 Token 过滤后授权骨架的边与 `grantPaths` 不变，页面出现「过滤访问层，授权层不受影响」 |
| SC-05 | passed_automation | 默认 `association_status=confirmed` 不计入候选；`include_candidate` 后计入。图例组件随页面夹具挂载并读取 `meta.access.trust`；组件用例未单独断言「已确认口径」五字 |
| SC-06 | passed_automation | Agent 深链 `agent=<id>`，Role 深链 `role=<id>`，解析后图内只保留对应骨架。这是规格允许的单测替代。从详情页点击的浏览器路径未跑 |
| SC-07 | passed_automation | 服务端对 `access_unreadable` / `access_invalid` / `access_config_path_mismatch` 均为 `unavailable` 且节点为空。页面对路径不一致不渲染画布，并给出配置审计入口 |
| SC-08 | passed_automation | 242 节点超过预算时 `meta.folded.nodes > 0`，渲染子集出现「其他（N）」，全量表节点仍为 200。页面折叠徽标为「已折叠 3 个节点」 |
| SC-09 | passed_automation | 表格视图行数等于全量边；节点清单不含 Token 仍可数。非 normal 边有可聚焦按钮。图区 `svg` 带 `aria-label`。屏幕阅读器实机未跑 |
| SC-10 | passed_automation | 需复核档按钮与说明不含「越权」；确凿越权档含「调用当时授权亦不覆盖」与「调用当时的授权快照」 |
| SC-11 | passed_automation | 术语标准 §4.8「访问权限升级」含附录 A 的 6 个词；`scripts/lint-terminology.mjs` 在用例内执行并通过 |
| SC-12 | not_run | 签核方式是 `cd webui && npm test` 全绿，以及 Agent / 角色 / 审计页快照无变化。本轮禁止全量套件。同文件里的只读旁路断言已通过（配置字节与 `snapshotHash` 不变，无新增写方法），片段不升格为本条通过 |
| SC-13 | passed_automation | 披露可关联数、需复核记录数、缺失数与覆盖率。缺失快照不升为确凿越权。页面写明「快照覆盖率低不代表越权率低」 |
| SC-14 | passed_automation | 同一快照下 `a_two` 的摘要表集合等于关系图表节点：`warehouse::fin::fin_budget`、`warehouse::fin::fin_ledger`。`a_overlap` 授权路径数 2、去重表数 1；重复访问为访问路径数 1、调用数 2 |

## 同源一致性

同一张已授权表，本轮夹具里的四条读路径没有互相矛盾：

- 一句话与资源卡片来自同一次 `deriveAuthorizationSummary`。ASV-01 的表数是规范源键去重，不是授权路径数，也不是工具×表元组数。
- 资源卡片上的 capability 与行边界来自现有编译：Agent 走 `resolveEffectivePermissionsBatchForAdmin`，Role 走 `previewSubjectPermissionsForCandidate`，角色归因走 `compileRoleForAdmin`。ASV-05 把摘要行边界 digest 对上运行时 `finalRowsBySource`。
- 访问关系图的授权表集合在 SC-14 上等于该 Agent 的摘要表集合。授权路径数、去重表数、访问路径数、调用数四个数分开。
- 调试台深链把卡片上的 `connectionId` 与 `sourceName` 放进 `mode=dry-run` 的 `args`。`McpPlayground` 对 `mode=dry-run` 进入 table 任务，不进入 `live-smoke`。运行中的调试台没有发 HTTP，实机 capability dry-run 对照记 `not_run`。
- 拒绝不写成允许。关系图只有 `outcome === "allow"` 进入访问内核，deny 单独计数。摘要夹具不包含未授予表。没有在活的调试台上把「摘要没有这张表」和「dry-run deny」再对一次。
- 授权没有被本功能改写。ASV-09 预览后已提交选择器仍是 `fin_ledger`。SC-12 的旁路断言里 `access.yaml` 字节与权限快照 hash 不变。这不覆盖既有页面回归。

## 缺陷

| ID | 分类 | 对象 | 说明 |
|---|---|---|---|
| — | implementation_bug | — | 本轮 0。118 个用例没有失败，没有据此要求改摘要或关系图实现，也不改授权 |
| SD-1 | spec_drift | 桑基规格设计轮残留 | 见下一节。本轮不改规格 |
| SD-2 | spec_drift | 桑基规格状态栏节号 | 见下一节 |
| SD-3 | spec_drift | 桑基规格 §12.3 第 3 行 | 见下一节 |
| SD-4 | spec_drift | 授权摘要 §8 导语 | 见下一节 |
| — | out_of_scope | — | 本轮 0。未提交的 `reconciliation.ts`、`audit-classification.ts`、`mcp-proxy.ts` 与 L25-16 文档不记入本功能缺陷 |

## 规格漂移

**SD-1。** `webui/docs/187-access-relation-sankey-spec.md` 状态行已经写「已实现，未验收」，实现落点也写了 `access-map.ts` 与 `AccessMap.tsx`。同文件仍有三处把本轮说成只做设计：

- 第 10 行授权来源：「本轮只做设计与需求审查材料」
- 第 736 行：「本轮已完成设计登记（不代表组件已实现）」
- 第 744 行：「本轮仅完成需求与验收设计」

这三句与已落地的实现冲突。同段「SC-01–SC-14 全部未执行」仍然符合「未验收」，不要改成已通过。

**SD-2。** 同一规格第 9 行把验收矩阵指到「§9」。§9 是 Design System Compliance。成功标准在 §1.3，验收映射在 §10。

**SD-3。** §12.3 第 3 行仍写「路由与导航实现待办」。`webui/src/app/App.tsx` 已挂 `/admin/access-map`，`webui/src/app/navigation.ts` 已有 `admin-access-map`。

**SD-4。** `docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md` 状态行是「已实现，未验收」，§8 导语仍写「以下验证在未来明确授权后实施」。后半句与提交 `28780eae` 冲突。同节「ASV-01–14 全部未执行」作为验收证据状态仍然成立，本报告不把它改成通过。

## blocked / not_run

| 项 | 状态 | 原因 |
|---|---|---|
| 浏览器（Playwright 与实机点击） | not_run | 本轮没有浏览器。未执行 `webui/tests/e2e/specs/p1-authorization-summary.spec.ts`、`p1-access-map.spec.ts`、`webui/tests/real-e2e/authorization-summary-v025.spec.ts`、`access-map-v025.spec.ts` |
| Docker 演示栈 | not_run | `:55176/api/health` 连接失败，不是 200。按指令不启动构建、不拉起服务、不清 volume |
| SC-12 全量 `npm test` 与既有页面快照 | not_run | 指令禁止全量套件。旁路只读断言已通过，见 SC 矩阵 |
| 实机 capability dry-run | not_run | 深链参数在夹具里正确。没有对运行中的 MCP 调试台提交预览 |
| ASV-14 的键盘实机走查与既有页面全量回归 | not_run | lint 与翻译防御已在本轮命令内通过。全量回归与 SC-12 是同一条未跑边界 |
| 工作区其余未提交产品文件 | not_run | 不是这两条功能的验收对象，本轮不解释其 diff |

没有 `blocked` 项。健康检查失败按指令记 `not_run`，不记环境阻塞。

## 一轮修复建议（不扩需求）

1. 只改两份规格里的过时句子，不改授权，不加新图形。桑基规格删掉「本轮只做设计」「不代表组件已实现」「仅完成需求与验收设计」；状态栏的验收矩阵改指 §10；§12.3 第 3 行改为路由与导航已挂载。授权摘要 §8 删掉「未来明确授权后实施」。两处都保留「已实现，未验收」和「矩阵未执行」。不要把本报告的 `passed_automation` 写回规格当成 UAT 通过。
2. 不要改 `authorization-summary.ts`、`access-map.ts`、`AccessMap.tsx`。本轮没有实现缺陷。
3. SC-12、浏览器和实机 dry-run 留在 `not_run`。下一轮若要补证据，等 `:55176` 已有进程返回 200 后再跑现成 Playwright，不要为了本验收新建视觉或新的授权规则，也不要无缓存重建镜像。
