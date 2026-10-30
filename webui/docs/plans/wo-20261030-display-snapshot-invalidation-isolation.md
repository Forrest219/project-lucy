# Display Snapshot Invalidation and Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 落实 Spec 195：同一次已确认文件变更不重复触发派生重建，普通 overlay 修改不牵连 Agent 权限展示，并如实提示后台刷新失败。

**Architecture:** 在现有单进程展示快照服务内统一 metadata / digest 文件版本基线，保留写屏障并确认事务最终磁盘版本。缓存依赖和校验健康状态同时按 scope 隔离；Agent 使用 P/C，sources 使用 D/P/C。沿用原 API 和运行时权限边界。

**Tech Stack:** Node.js、TypeScript、Fastify、React Query、Vitest / Testing Library、现有性能夹具与已授权的桌面浏览器只读验证。

---

## 状态与本轮交付边界

- 日期 / 版本：2026-10-30 / v0.1。
- 用户已确认修复方向并要求先落盘 Spec 和 Plan；本文件所有任务均未开始，SI-01–SI-14 均未执行。
- 本轮只新增本计划与 [Spec 195](../195-display-snapshot-invalidation-isolation-spec.md)，并登记索引；不实现、不部署、不提交现场配置。
- 本计划按仓库模块落位规则放在 `webui/docs/plans/`。任务执行时使用当前可用的 `executing-plans` 技能；若工具环境的技能命名没有 `superpowers:` 前缀，使用已安装的同名工作流，不为此安装软件或扩大任务。
- 已完成方向确认，无需重新从需求访谈开始。实施中若设计需改变检测窗口、运行时授权或发布窗口语义，应先回到 Spec 195 修改方案，不静默扩大范围。

## 开工阅读与范围核查

阅读 `AGENTS.md`、`docs/governance/DEVELOPMENT.md`、术语标准、Spec 174 §3.2 / §4.2 / §7 / §8、Spec 195 全文。按实际入口读取 `display-generation.ts`、`display-snapshot.ts`、`fs-safe.ts`、两个 access writer、`semantic-layer.ts`、`catalog-assets.ts`、`catalog-reload.ts`、`project.ts`、`ops/ops-locks.ts` 与现有 display 回归。

```bash
git status --short
rg -n 'getDisplaySnapshot|withDisplayWriteBarrier|bumpDisplayGeneration' webui/server
rg -n 'writeSourcePatch|writeSourceYamlImport' webui/server/semantic-layer.ts
```

写入前重新读取相关文件，保留其他会话的修改。当前基线存在未跟踪 `config/`，不读取其中凭据、不改动、不纳入提交。不修改 KTX、Policy 编译器、权限决策、客户配置、数据库 schema、发布协调器的锁生命周期。

## Task 1：把两个主要问题写成失败用例

**Files:**
- Modify: `webui/server/__tests__/display-snapshot.test.ts`
- Modify: `webui/server/__tests__/display-invalidation.test.ts`
- Modify: `webui/server/__tests__/display-permission-runtime.test.ts`

1. 增加 SI-01 / SI-02 的外部 overlay 编辑用例：预热 Agent 与 sources，编辑一次，分别执行 metadata/full 及逆序、并发；记录重建和代次，不把合法写前/写后边界混入计数。
2. 增加 SI-04 的**真实 API** overlay-only 保存/导入用例，断言 P/C 不变、Agent 继续命中；再用 Manifest 写入反例证明 P 必须改变。
3. 增加 SI-07：已知 overlay 文件读取失败时 Agent 正常、sources 失败；共享目录不可枚举时 Agent 也须失败。
4. 运行新增具名用例，确认旧实现因重复失效、外层 P 屏障或全局校验而失败。保留失败输出在 `inbox/spec195/`；不把 EPERM 监听限制当成代码失败。

```bash
cd webui
npx --no-install vitest run --maxWorkers=1 server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-permission-runtime.test.ts
```

预期：新增语义断言失败，其他夹具正常初始化。需要监听临时端口的用例按执行环境已有权限运行，不能修改业务代码迁就沙箱。

## Task 2：统一文件观察版本，消除 metadata / digest 重复失效

**Files:**
- Create: `webui/server/display-revisions.ts`
- Create: `webui/server/__tests__/display-revisions.test.ts`
- Modify: `webui/server/display-snapshot.ts`（`scanMetadata` / `hashContents` / 两类 reconcile / reset / stop）
- Modify: `webui/server/__tests__/display-snapshot.test.ts`

1. 实现 Spec 195 §5 的 `ObservedRevision`、稳定读取、删除 tombstone、候选比较和同步提交；mtime 等 metadata 与 digest 一并参与版本。
2. 两类扫描消费同一 accepted map；meta 变化补齐该文件 digest，full 扫描继续覆盖 metadata 未变的内容变化；不要保留第二份过期 hash 基线用于失效通知。
3. 添加 context、scope generation、sequence 和目录成员版本保护；晚到任务失败时合并重查，不更新完成时间。
4. 测试两种顺序、并发、第二次真实修改、同字节 mtime 更新、删除/重建、原子替换及同大小同 mtime 改写，分别映射 SI-01–SI-03。
5. 跑下列用例，先完成外部观察的去重；Task 1 的写入口/隔离测试允许仍失败，不能伪改断言标绿。

```bash
cd webui
npx --no-install vitest run --maxWorkers=1 server/__tests__/display-revisions.test.ts server/__tests__/display-snapshot.test.ts
```

预期：同一外部版本仅一次派生通知；必要重复文件校验可存在；独立新版本不漏报；reset / stop 释放状态。

## Task 3：登记实际写入路径并确认事务最终版本

**Files:**
- Modify: `webui/server/display-generation.ts`
- Modify: `webui/server/display-revisions.ts`
- Modify: `webui/server/fs-safe.ts`
- Modify: `webui/server/admin/access-config.ts`
- Modify: `webui/server/admin/agents.ts`（本地 access writer）
- Modify: `webui/server/project.ts`（直接写入 / rollback 的 `ktx.yaml`、access 与 rename）
- Modify: `webui/server/catalog-assets.ts`（Manifest 临时文件 rename 到正式目标）
- Test: `webui/server/__tests__/display-rollback-races.test.ts`
- Test: `webui/server/__tests__/display-invalidation.test.ts`
- Test: `webui/server/__tests__/display-revisions.test.ts`

1. 给现有屏障增加可选 touched-path 登记与相关 scope 的嵌套/重叠事务合并；不要把所有既有 writer 重写成新事务系统。
2. 中心写/删/移动函数在真实落盘前登记，rename 同时登记源和目标；直接 access / `ktx.yaml` 写入及回滚也登记。secret 保留 C/L 通知，不读入账本。
3. 相关外层事务在 Policy ack / rollback 完成后确认最终磁盘版本，再完成退出屏障；确认失败先置 scope 未验证。保留 begin/end 的代次推进，不额外通知同版本。
4. 无审计分支、部分写入失败、原文恢复、嵌套与并发写入逐项覆盖 SI-05 / SI-06。未登记路径保持保守处理，并作为范围清单待补项，不能假称完全去重。
5. 检查 Token writer 经 `auditedWriteFile → safeWriteAtomic`、Hive writer、`ops` 外层屏障是否已经继承路径登记；仅补缺失登记，不改这些域的权限、终态和锁顺序。

```bash
cd webui
npx --no-install vitest run --maxWorkers=1 server/__tests__/display-revisions.test.ts server/__tests__/display-rollback-races.test.ts server/__tests__/display-invalidation.test.ts
```

预期：原回滚和未确认写入用例仍通过；退出后 observers 不因同一个最终版本再次引发重建。遇到旧域自身已登记的缺口，记录原基线，不借本单修复或放宽测试。

## Task 4：收窄真实写入范围与快照校验依赖

**Files:**
- Modify: `webui/server/display-generation.ts`（复用/补充路径并集分类）
- Modify: `webui/server/display-snapshot.ts`（按 scope 的 coverage、完成时间、错误与验证）
- Modify: `webui/server/semantic-layer.ts`（两条源表写入入口）
- Modify: `webui/server/admin/agents.ts`（`agentPermissionSection` 与最终响应检查）
- Modify: `webui/server/ops/ops-locks.ts`（仅在确有 overlay-only 消费方时补 scope/路径传递）
- Test: `webui/server/__tests__/display-permission-runtime.test.ts`
- Test: `webui/server/__tests__/display-invalidation.test.ts`
- Test: `webui/server/__tests__/display-snapshot.test.ts`
- Reference only: `webui/server/proxy/acl.ts::buildSourceMapFromDisk`

1. 外层屏障取实际 proposed files 的 scope 并集。overlay-only 用 D；Manifest 用 D/P；含连接配置的批次保持 C/D/P/L。保留原锁和预览顺序，不在锁外重算会过期的待写清单。
2. Agent 权限 key 改 P/C；sources 保持 D/P/C。实际保存路径与外部编辑路径必须得出同样的依赖分类。
3. 将全局 verified/error 拆成按依赖 scope 的 coverage 状态；P/C 校验不读取 overlay 内容。目录成员未知可能藏有 Manifest 时仍阻断 P，禁止过度隔离。
4. 独立维护 metadata/digest 错误与完成时间；切根、集合变化、晚到任务、缺失与 EACCES 分别处理。
5. Agent 最终检查覆盖 P/C，含统计读取期间的变化；纯统计变化不清空权限缓存。

```bash
cd webui
npx --no-install vitest run --maxWorkers=1 server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-permission-runtime.test.ts server/__tests__/admin-agents.test.ts
```

预期：SI-04 / SI-07 / SI-08 / SI-11 通过；Task 1 两个主要复现均转绿。实现不得进入 `acl.ts` 修改 runtime loader 默认值。

## Task 5：共享有界校验恢复与可区分诊断

**Files:**
- Modify: `webui/server/display-snapshot.ts`
- Modify: `webui/server/display-revisions.ts`
- Modify: `webui/server/admin/agents.ts`（请求级预算传递）
- Modify: `webui/server/index.ts`（sources 请求级预算传递）
- Test: `webui/server/__tests__/display-snapshot.test.ts`
- Test: `webui/server/__tests__/entry-performance-timing.test.ts`

1. 两类文件工作共用并发 2 的有界执行器；metadata / 已知变化优先，摘要分批，不创建每 HTTP 请求一份的全盘扫描。
2. 校验未完成时共享 Promise，有界等待总计 1500ms；不延长 3/31 秒阈值，不在超时后假装校验成功。
3. 把路由与快照层嵌套尝试合成请求级最多三次；等待预算不因尝试重置。共享任务保留真实生命周期，HTTP 超时或取消不提前释放工作许可。
4. 增加 Spec 195 §7 的内部诊断。特别测试 `builds=0` 的 in-flight attach，不用请求计数冒充全局容量。
5. 测试过期后恢复、真正失败、校验任务重入、写入未结束、队列满及 context 变化，覆盖 SI-09 / SI-10 / SI-12。

```bash
cd webui
npx --no-install vitest run --maxWorkers=1 server/__tests__/display-snapshot.test.ts server/__tests__/entry-performance-timing.test.ts server/__tests__/display-invalidation.test.ts
```

预期：所有 busy 原因可定位；普通请求共享校验；任务和订阅均有终态；上限保持，数据不跨代次返回。

## Task 6：显示后台刷新失败，保留现有主内容

**Files:**
- Create: `webui/src/components/DisplayRefreshNotice.tsx`
- Create: `webui/src/__tests__/display-refresh-notice.test.tsx`
- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/Catalog.tsx`
- Modify: `webui/src/__tests__/agent-list.test.tsx`
- Modify: `webui/src/__tests__/catalog-loading.test.tsx`
- Reference only: `webui/src/components/AsyncRegion.tsx`、`webui/src/lib/displayQueryOptions.ts`

1. 使用现有样式实现 `data != undefined && query.isError` 的局部提示，文案与时间按 Spec 195 §7；重试走现有 refetch，等待时禁重复点击。
2. 仅接入 Agent / 语义资产；不全局改变 `asyncStatus`，不改已有数据保留行为。
3. 加入成功 → 后台失败 → 成功恢复的真实 QueryClient 生命周期测试；首次失败、空数据和账号切换分别验证。
4. 断言提示时间来自最后成功读取，缓存 `meta.generatedAt` 很旧时也不得误报；不额外增加自动请求或长期缓存动态统计。

```bash
cd webui
npx --no-install vitest run --maxWorkers=1 src/__tests__/display-refresh-notice.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/catalog-loading.test.tsx src/__tests__/display-query-isolation.test.tsx
```

预期：SI-13 通过；已有表格、筛选和滚动仍保留，首次失败仍是现有局部错误。

## Task 7：综合验证与交付记录

**Files:**
- Modify: `webui/server/__tests__/display-invalidation.test.ts`（最终集成断言）
- Modify: `webui/scripts/entry-performance.mts` / `entry-performance-server.mts`（仅需补原夹具缺失的场景时）
- Modify: `webui/docs/174-webui-entry-performance-spec.md`（实现完成后加 Spec 195 精确修订指针）
- Modify: Spec 195、本计划及原 invalidation matrix 的实际状态，不提前写完成
- Evidence: `inbox/spec195/`（匿名原始结果、计时、失败记录；不含凭据）

1. 执行所有新增测试与原回滚/权限/账号隔离回归；已有 48 项测试的历史通过记录不能代替本次结果。
2. 检查 Spec 195 SI-01–SI-14，每项填实际命令、证据与结果。文件读取次数、失效次数、重建次数分开，不把去重断言等同“永远只做一次 I/O”。
3. 使用现有生产构建夹具和桌面浏览器，按 Spec 174 的测量合同做 30 组往返及 overlay-only 变更；本任务用户已明确要求浏览器跳转验证，范围限对应桌面页面。无移动测试，不使用现场配置作夹具。
4. 若目标实例未升级，只记录现场新版本复核未执行。本计划不包含部署；部署另行按既有发布流程安排，不能以再次访问旧实例宣称修复已生效。
5. 仅在相应任务检查通过且无需再改动时记录验证结果，不为文档任务执行整套浏览器或构建。

实现阶段的基本检查：

```bash
npm run lint:terminology
npm run lint:spec
npm --prefix webui run typecheck
cd webui
npx --no-install vitest run --maxWorkers=1 server/__tests__/display-revisions.test.ts server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-rollback-races.test.ts server/__tests__/display-permission-runtime.test.ts server/__tests__/admin-permission-batch.test.ts server/__tests__/admin-agents.test.ts server/__tests__/entry-performance-timing.test.ts src/__tests__/display-refresh-notice.test.tsx src/__tests__/display-query-isolation.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/catalog-loading.test.tsx
```

浏览器性能命令先读 `webui/scripts/entry-performance.mts` 当前参数帮助，按其真实场景入口运行；不凭空编造 runner 参数或把 fixture 初始化用于真实实例。代码提交如另有任务要求，仅显式暂存本计划涉及的文件，禁止 `git add -A`，本次文档交付不自动 commit / push。

## 验收对应与完成定义

| 任务 | 对应验收 |
|---|---|
| Task 1–2 | SI-01、SI-02、SI-03 |
| Task 3 | SI-05、SI-06 |
| Task 4 | SI-04、SI-07、SI-08、SI-11 |
| Task 5 | SI-09、SI-10、SI-12 |
| Task 6 | SI-13 |
| Task 7 | SI-14 与全矩阵复核 |

完成定义：两类主要复现转绿，相关写入/回滚与错误隔离无退化，原检测窗口和运行时授权边界保持，页面显示与后台请求结果均可验证。仅落盘文档、仅看到缓存列表、仅本地通过或仅健康接口正常，均不能写为现场修复完成。

## Terminology Compliance

This plan follows `webui/docs/00-product-terminology-standard.md`. New terms: None. 用户可见文案以 Spec 195 §7 为准。

## Design System Compliance

遵循 `webui/docs/design-system/20-patterns-page-layout.md` §2–3 与 `99-governance.md` TD-174-01；仅在所属数据区用已有提示和重试样式，不改变页面布局、主内容保留或移动适配范围。
