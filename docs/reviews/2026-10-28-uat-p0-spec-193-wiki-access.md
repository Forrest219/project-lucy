# Spec 193 业务 Wiki 访问管理 — 发布前 UAT 核对（2026-10-28）

结论词汇只用 `passed_automation` / `failed` / `blocked` / `not_run`。本文件**不是** UAT-passed，也不是产品验收签字。

## 结论

Spec 193 在 `lucy-v0.25` @ `17fdaf0850e27dbb724cf932f9d51e9af5d72815`（实现提交 `09577828`）上，本轮只跑了指定的服务端与组件测试。158 例全绿，但不能据此关闭 SC-01–SC-24。

| 项 | 结果 |
|---|---|
| 整条 `passed_automation` | SC-01、SC-02、SC-03、SC-04、SC-05、SC-07、SC-08、SC-10、SC-12、SC-13、SC-14、SC-16、SC-17、SC-18、SC-19、SC-22（16） |
| 服务端半段 `passed_automation`，界面半段 `not_run` | SC-11、SC-15（2） |
| `failed` | SC-06、SC-21（2） |
| `blocked` | 0 |
| `not_run` | SC-09、SC-20、SC-23、SC-24；浏览器；移动窄屏；Docker `127.0.0.1:55176` |
| `implementation_bug` | 2 |
| `spec_drift` | 2 |
| `out_of_scope` | 0 |

未改产品代码、规格或配置，未 git commit，未启动 Docker 构建，未删除 volume。未执行的 `wiki.test.tsx`、`wiki-batch-access.test.tsx`、`wiki-access-auth.test.ts` 不记为通过。

`passed_automation` 只记本轮跑过、并且断言了文件字节、审计行、Agent 裁决或界面文案的用例。只调用 `classifyAccessDirection` 对照一张表、或让测试辅助函数自己对拍自己，不记通过。

## 范围

- 规格：`webui/docs/193-business-wiki-access-management-spec.md` v0.3，SC-01–SC-24。
- 计划注记：`webui/docs/plans/wo-M66-business-wiki-access-management.md`。
- 实现锚点：`09577828`（`feat(v0.25): implement Spec 193 business wiki access management`）。
- 不在本轮：全量 vitest、浏览器、移动窄屏、Docker 健康检查以外的运行时、L25-16 未提交文档。

## 命令与结果

### Docker

```bash
curl -sS -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:55176/api/health
```

连接被拒绝（`curl` 退出码 7，HTTP 状态无法取得）。未启动构建，未重试 compose。Docker 记 `not_run`。

### 聚焦 vitest（已执行）

```bash
cd webui
KTX_PROJECT_ROOT=$(mktemp -d)   # 实际 /var/folders/rk/k516h8td2qbdr20gtb2wq0cr0000gn/T/tmp.6K6QgVCCGe
npx vitest run --maxWorkers=1 \
  server/__tests__/wiki-upload-access.test.ts \
  server/__tests__/wiki-access-routes.test.ts \
  server/__tests__/wiki-access-batch.test.ts \
  server/__tests__/wiki-access-batch-faults.test.ts \
  server/__tests__/wiki-access-operation.test.ts \
  server/__tests__/wiki-access-effects.test.ts \
  server/__tests__/wiki-write-queue.test.ts \
  server/__tests__/wiki-acl-concurrency.test.ts \
  src/__tests__/wiki-access-components.test.tsx
```

退出码 0。Vitest v4.1.9。`Test Files  9 passed (9)`，`Tests  158 passed (158)`，耗时 5.46s。没有共享 inbox 碰撞，没有单文件重跑。

| 文件 | 用例 |
|---|---|
| `server/__tests__/wiki-upload-access.test.ts` | 21 |
| `server/__tests__/wiki-access-routes.test.ts` | 15 |
| `server/__tests__/wiki-access-batch.test.ts` | 18 |
| `server/__tests__/wiki-access-batch-faults.test.ts` | 9 |
| `server/__tests__/wiki-access-operation.test.ts` | 24 |
| `server/__tests__/wiki-access-effects.test.ts` | 25 |
| `server/__tests__/wiki-write-queue.test.ts` | 18 |
| `server/__tests__/wiki-acl-concurrency.test.ts` | 12 |
| `src/__tests__/wiki-access-components.test.tsx` | 16 |

方向分类的 `it.each` 调用的是产品函数 `classifyAccessDirection`，不是测试里再写一份算法。它只证明方向矩阵，不能单独把 SC-19 / SC-20 记成通过。SC-19 另有 `canAccessWikiPage` 对搜索和读取的拒绝，以及落盘后的 `needs_review`。

## SC 矩阵

| SC | 状态 | 本轮断言了什么 |
|---|---|---|
| SC-01 | `passed_automation` | 缺声明的预检 `final_acl` 为 missing，并带 `confirm_empty_required`；未带 `confirmed_empty` 的提交返回 400，文件不存在（`wiki-upload-access.test.ts`）。上传弹窗按钮本轮未跑。 |
| SC-02 | `passed_automation` | `use_uploaded` / `set` 一次写入正文和 `allowed_roles`（同文件读盘）。来源徽标与四条通道文案在 `wiki-access-components.test.tsx`。 |
| SC-03 | `passed_automation` | 覆盖预检默认 `preserve_current`，提交后磁盘仍是原角色；只有 `use_uploaded` 才改写（`wiki-upload-access.test.ts`、`wiki-acl-concurrency.test.ts`）。三列对照的页面用例未跑。 |
| SC-04 | `passed_automation` | 损坏声明不能 `use_uploaded`，提交被拒；显式 `set` 后磁盘是新角色且不再含 `*`。组件不预选损坏声明。 |
| SC-05 | `passed_automation` | 缺 selection、缺 digest、过期 digest、过期版本、创建后目标出现、`role_channel_version` 变化、create/replace 对调，均为零写入。 |
| SC-06 | `failed` | 四种主状态文案有组件断言，但 `GET /api/wiki` 同一次请求读了两次 `access.yaml`，违反 §6.1「只读取一次」。列表页「无逐行 access 请求」在未执行的 `wiki.test.tsx`。 |
| SC-07 | `passed_automation` | `resolveWikiAccessEffects` 对真实快照区分 search/read 四种组合，并只数启用且真实绑定的 Agent。组件渲染固定通道文案，且把声明数和 Agent 数分开。 |
| SC-08 | `passed_automation` | PUT 后正文逐字保留，未知 frontmatter 仍在；规范化无变化不改 inode、不增版本、不增审计行。Drawer 用绑定的 digest 提交。 |
| SC-09 | `not_run` | 「未保存草稿时禁用管理访问权限」只在未执行的 `wiki.test.tsx`。本轮的冲突用例只断言 409 后保留角色选择，不断言草稿门闩。 |
| SC-10 | `passed_automation` | 缺版本 428、过期版本或过期 digest 409，文件字节不变。 |
| SC-11 | `passed_automation`（服务端） / `not_run`（界面） | 去重后 1–100、101 与空选择不建 operation、同 key 不同版本 409，均已断言。切换目录清空选择、第 101 篇不截断在未执行的 `wiki-batch-access.test.tsx`。 |
| SC-12 | `passed_automation` | `add` 写并集且拒绝 `*`；`replace` 把损坏 ACL 写成精确值；空与全角色各要独立确认。断言的是提交后的文件 ACL。 |
| SC-13 | `passed_automation` | 批量预检返回逐篇旧/新 ACL、direction、no-op 和汇总，digest 随基线变化。预检页展开在未执行的批量界面用例。 |
| SC-14 | `passed_automation` | 执行前基线过期返回 409 `wiki_batch_preview_stale`，文件与 journal 行都是零。 |
| SC-15 | `passed_automation`（服务端） / `not_run`（界面） | 队列外改写被标 `conflict`，前一篇 `applied` 留在磁盘，后一篇继续。只重试未完成项、`needs_review` 不可重试的界面未跑。 |
| SC-16 | `passed_automation` | 同幂等键加同 digest 第二次不写文件、不增版本；同键不同 digest 返回 409。 |
| SC-17 | `passed_automation` | 单篇审计 `write_status=committed`（`wiki-access-operation.test.ts`）。批量两篇审计的 actor 是 operator，不是请求体里的 mallory，`request_id` 是共享 operation id；journal 行有 ACL 摘要。 |
| SC-18 | `passed_automation` | 正文、上传、恢复、移动、删除、目录重命名在队列内重验版本或目标状态；过期则不写。unlocked helper 不再入队，组合上传不死锁。并发 ACL 保存不是静默后写覆盖。 |
| SC-19 | `passed_automation` | 扩权字节已在磁盘且 hold 未提交时，`canAccessWikiPage` 对 discover 和 read 都返回 `context_not_available`。恢复把该 operation 标成 `needs_review` 并保持 hold，不自动 commit、不重放写入。 |
| SC-20 | `not_run` | 本轮只断言收窄后 hold 列表为空，没有在收窄提交后对下一次 Agent 请求做拒绝断言。`context-policy-invalidation.test.ts` 未执行。 |
| SC-21 | `failed` | 按 operation id 能读回结果，journal 不含正文、凭据和绝对路径，恢复也不重放写入。但未提交扩权的 journal 项在恢复后仍是 `pending`，不是 §7.5 要求的 `needs_review`。 |
| SC-22 | `passed_automation` | 恢复把正文回到旧版，`allowed_roles` 仍是收窄后的 finance，不复活 `*`。缺 `expected_version` 为 428。hold 期间恢复、移动、删除返回 409 且字节不变。 |
| SC-23 | `not_run` | 未登录 401 与已登录 operator 可改单篇，在未执行的 `wiki-access-auth.test.ts`。本轮只断言成功写入时忽略请求体里的 actor。 |
| SC-24 | `not_run` | 本轮只有未知 Role「ghost-role」断言了 `notranslate` 和 `translate="no"`。Agent ID、Wiki 路径、文件名和术语扫描未执行。 |

浏览器与移动窄屏：`not_run`。本轮没有打开页面。

## 缺陷（文件行号）

### 1. `implementation_bug` — `GET /api/wiki` 同一次请求读两次 Role/Agent 配置（SC-06，§6.1）

规格要求这一次列表响应里只读取一次 Role/Agent 配置。路由在 `Promise.all` 里同时调用 `listWiki` 和 `loadWikiAccessConfigSnapshot`。`listWiki` 内部已经读过一次。`loadWikiAccessConfigSnapshot` 每次都 `readFile` `access.yaml`，没有请求内缓存。两次读取若中间碰到配置写入，行上的通道计数和信封上的 `role_channel_version` 可以不是同一次快照。

- `webui/server/index.ts` 1085–1092：注释写「exactly once」，实现并行再读一次。
- `webui/server/wiki.ts` 912–914：`listWiki` 内 `loadWikiAccessConfigSnapshot`。
- `webui/server/wiki-access-effects.ts` 122–125 与 `webui/server/admin/access-config.ts` 128–130：每次调用都读文件。

本轮没有失败的测试挡住它。列表聚合形状的组件测试喂的是造好的 entry，不经过这条路由。

### 2. `implementation_bug` — 重启后未提交扩权的批量 journal 仍是 `pending`（SC-21，§7.5）

规格要求核对 journal 与每篇 security operation：未提交扩权标 `needs_review`，不自动续跑，也不把 `pending` 当成功。`recoverWikiAccessOperations` 只改 security operation。`getWikiAccessBatchResult` 原样读 journal，不做核对。

已执行用例把这个缺口钉成期望值：扩权字节已在磁盘、security operation 变为 `needs_review` 且 hold 仍在，但 batch item 与 batch 状态仍是 `pending`（`webui/server/__tests__/wiki-access-batch-faults.test.ts` 518–520）。查询 operation id 的人看到的是未完成，不是待运维核对。

- `webui/server/wiki-access-recovery.ts` 63–64、102–112：只 `markWikiAccessOperationNeedsReview`。
- `webui/server/wiki-access-batch.ts` 817–823：GET 不核对。

按 operation id 能读到、不重放、journal 不含正文，这三句在同一批用例里成立，不抵消状态标错。

## 规格漂移

不新增行为，只记录正文与已经决定的事实不一致。

1. §10.2 错误表没有 `wiki_batch_blocked` 和 `wiki_access_frontmatter_invalid`。§19.4 写明这两个码已经落地并登记到 `webui/docs/03-api-spec.md`，同时状态行写「契约本体未改」。错误表与已决定的 API 不一致。
2. 状态行写「SC-01–SC-24 证据齐备」。§19.3 把 `wiki-access-batch-faults.test.ts` 的重启用例当作 SC-21 证据，而该用例断言 journal 保持 `pending`。这与 §7.5「未提交扩权标 `needs_review`」相反。证据注记把契约缺口写成了已覆盖。

## blocked / not_run

- `blocked`：无。
- Docker `http://127.0.0.1:55176/api/health`：连不上，`not_run`。未启动构建。
- 浏览器、移动窄屏：`not_run`。
- SC-09、SC-20、SC-23、SC-24：见矩阵。对应的已有文件 `src/__tests__/wiki.test.tsx`、`src/__tests__/wiki-batch-access.test.tsx`、`server/__tests__/wiki-access-auth.test.ts`、`server/__tests__/context-policy-invalidation.test.ts`、`src/__tests__/lint-terminology-scan.test.ts` 本轮按范围未执行，不记通过，也不把「文件里有用例」写成 `passed_automation`。
- SC-11、SC-15 的界面半段同样 `not_run`。

## 一轮修复建议（不扩需求）

1. `GET /api/wiki` 只调用一次 `loadWikiAccessConfigSnapshot`，把同一次快照交给列表行和响应上的 `role_channel_version`。不要加新缓存层，不要改列表字段。
2. 启动恢复在标 security operation 为 `needs_review` 时，把仍为 `pending`、且当前字节已是该扩权目标的 journal 项写成 `needs_review`。按 operation id 读取时使用核对后的状态。不重放写入，不自动 commit，不增加新的重试类型。同时改 `wiki-access-batch-faults.test.ts` 518–520，让断言跟上 §7.5，而不是继续期望 `pending`。
3. 规格只对齐已落地事实：§10.2 补上上述两个错误码；§19.3 的 SC-21 行不要把「journal 仍为 pending」写成恢复已经做完。不新增错误码，不改 `authorizeContext`，不加目录继承。
