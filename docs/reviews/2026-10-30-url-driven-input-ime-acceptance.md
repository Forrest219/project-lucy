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
