# URL 驱动输入法组合中断 — 验收记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-10-30 |
| 对象 | Spec / Plan v1.0 的 S1–S7 实现 |
| 实施 | Claude Code，按 `inbox/ime-composition/HANDOFF.md` |
| 复审 | 对照 Spec §5、§6 与工作树抽查后接受 |
| 结论 | **本地验收通过。** 可以提交。不授权镜像、部署或客户交付 |

## 复审抽查

- `useUrlMirroredField` 按 §5.3 区分 `POP`、自身回声、pending 旧值和 superseded，清除筛选对 Audit 的 7 个镜像调用 `reset`。
- 统一搜索和目录 `q` 把原文写入 URL；查询或过滤消费点再 trim。Token 搜索框不再走 `"all"` 清空哨兵，下拉框仍走原哨兵。
- 门禁改造前基线 13 处、改造后 0 处。判定算法比伪代码多了两处精度约束（属性访问不算变量、传递闭包不跟随函数调用），否则会误报 3 处。这不改变 D1–D6。
- `CaseEditor` 只改了期望指标。其余 5 个逗号输入框仍是同类写法，Spec §5.4 没有把它们列入本期。

## 本次复审重跑

- `npm run lint:url-driven-input`：0 处。
- `vitest`：`admin-audit-url-mirror`、`url-driven-input-transform-writeback`、`lint-url-driven-input`、`catalog.test`、`audit.test`，5 个文件 65 条通过。

## 实施方记录、本次未重跑

- SC-17：系统 Chrome 156.0.8078.73，13 处 `compositionstart`=1、最终值 `中文`、组合期间 value setter=0。同页 URL 驱动对照件得到 3 次重启和 6 次写入，探针本身有效。原始输出在 `inbox/ime-composition/probe/`，不入库。
- 全量 `cd webui && npm test`：实施笔记记为 4640/4641，失败文件每次不同且单独重跑通过，落在 `webui/server/__tests__/`，与本次前端改动无交集。SC-20 因此记为本次相关用例通过，不把既有 flake 算成本次回归。
- `lint:spec-docs` 仍被另一会话的 CI restoration 文档挡住。本次没有改那些文件。

## 未纳入

远端 CI job 还没有跑。镜像、部署、客户交付不在本次提交里。

---

## 2026-11-01 更正（功能合同收口时）

本记录是 2026-10-30 的**当时事实**，不回改上文；但收口时发现三处已成为过期登记，在此更正：

1. **「原始输出在 `inbox/ime-composition/probe/`，不入库」** —— 收口时改为**入库一份可复查副本**于 `webui/scripts/evidence/2026-10-30-url-driven-input-ime-probe/`（含 `probe/` 三份原始输出与静态门禁的改造前／后基线，附来源与复现说明）。理由：探针脚本的默认输出目录 `inbox/` 被 `.gitignore` 排除，原始证据若只留在工作区，收口后第三方无法复查。探针脚本本身早已随实现入库（`webui/scripts/ime-composition-probe.mjs`，commit `f4630d57`，此后未改），所以「脚本 + 输出」现在都在仓内。
2. **「全量 `npm test` 4640/4641，失败文件每次不同」** —— 该既有 flake **仍在**，2026-10-30 当时的判断（「与本次前端改动无交集」）经 2026-11-01 复测**成立**：收口时全量跑到 425 个测试文件 / 5173 条用例，其中 `server/__tests__/api.create-connection.test.ts` 的 2 条偶发失败，单独复跑 3 次有 2 次全绿。根因已定位（见 [收口记录](2026-11-01-url-driven-input-ime-composition-closure.md)「残余」一节）：`beforeEach` 的 `vi.clearAllMocks()` **不清 once 实现队列**，加上 `vi.resetModules()` 之后「测试与服务器是否共享同一个 mocked 模块实例」是竞态的。**与本条的前端改动无交集**——本条不碰任何服务端代码。SC-20 的两个既有 URL 断言哨兵（`audit.test.tsx`、`admin-audit-turns.test.tsx`）均通过。
3. **「`lint:spec-docs` 仍被另一会话的 CI restoration 文档挡住」** —— 已由 commit `09701392` 修复，该门禁现为 exit 0。

另外，本次收口补齐了 SC-01–SC-13 的**逐处**自动化断言（收口前只有 Audit 的 2 处有逐处行为断言，其余 11 处的条件 ②③无自动化覆盖）：新增 `webui/src/__tests__/url-driven-input-mirror-contract.test.tsx`，扩写 `webui/src/__tests__/admin-audit-url-mirror.test.tsx`。逐条落点见 Spec §6.6，收口结论见 [收口记录](2026-11-01-url-driven-input-ime-composition-closure.md)。
