# 访问关系图小时明细表：Codex 交叉审阅

- 审阅方式：本机 Codex CLI，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，只读。各轮修订由实施代理落地。
- 对象：`lucy-20261104-access-map-hourly-detail` Spec／Plan。
- 原始摘录：`inbox/codex-prompt-access-map-hourly-detail-roundN.md`、`inbox/codex-review-access-map-hourly-detail-roundN.txt`（可删工作副本）。
- 上限：三轮（用户指定）。

定稿只覆盖这份设计合同。功能合同未收口前不得改 `webui/` 业务代码。定稿不表示开发已授权。本条收口不表示可上线。

## 第 1 轮

对象是 Spec／Plan **v0.1**。结论：**退回修订，不定稿。** 阻塞 0，高 6，中 4，低 0。摘录：`inbox/codex-review-access-map-hourly-detail-round1.txt`。

1. **F01｜高** — 「同筛选」未落实到 scope／focus 投影。
2. **F02｜高** — `truncated=false` 与分页完整性前提混淆。
3. **F03｜高** — SC-09／SC-10 仅验全局数量，抓不住错误归因；缺预写行键→ID。
4. **F04｜高** — 伪代码未接现有 provider；隐含重复 `buildBandED`。
5. **F05｜高** — 表视图降级／空态无独立状态矩阵。
6. **F07｜高** — 删口径全文时撤掉覆盖率与窗口起止披露。
7. **F06｜中** — `inquiryKind=all` 下无关联行值未定义。
8. **F08｜中** — §7.5 无障碍等价未登记能力收缩。
9. **F09｜中** — Token 取消仍被写成「筛选语义不变」。
10. **F10｜中** — SC-16／lint 混进功能出口。

已核对无问题：落位与索引、闭口层级、P3 授权边界、多角色归因方向、术语／DS 模板、不进窄屏／浏览器出口。

## 第 1 轮后修订（→ v0.2）

| 项 | 处理 |
|---|---|
| F01 | D9：scope 字段精确筛选；focus 与 `focusSubgraph` 共用；deny-only 实体焦点规则；SC-13 |
| F02 | D10：`hasMore`／守恒前提；非法 limit／offset；重置 offset；SC-12 |
| F03 | §6.1 测试缝 ID 集；§6.3 预写行键→ID；SC-09／SC-10 |
| F04 | D12／§7 `prepareBand` 一次准备；SC-17 |
| F05 | §5.5 状态矩阵；SC-07／SC-15 |
| F06 | D13：`inquiryKind: InquiryKind \| null`，「无关联」；SC-06 |
| F07 | §5.3 窗口起止＋覆盖率压缩句；SC-03／SC-18 |
| F08 | D11 §7.5 能力收缩；§9 指针 |
| F09 | D5／§9：取消 Token 条件；SC-11 |
| F10 | 旧 SC-16 工程项移出功能出口→ Plan S3；新 SC-16＝标识／标题行为；SC-01–SC-18 |

Plan 同步 v0.2：S1＝SC-07–SC-14／SC-17；S2＝SC-01–SC-06／SC-15–SC-16／SC-18；S3＝工程门禁。

## 第 2 轮

对象是 Spec／Plan **v0.2**。结论：**退回修订。** 阻塞 0，高 2，中 1，低 0。摘录：`inbox/codex-review-access-map-hourly-detail-round2.txt`。

已闭合：F01、F02、F06、F07、F08、F09、F10。

残留：

1. **F03｜高（残留）** — 预写 ID 未落实为逐桶集合相等；交换两桶 ID 仍可过。
2. **F04｜高（残留）** — 伪代码按 `band.state`，真实 `buildBandED` 返回 `{ok,band|reason}`。
3. **F05｜中（残留）** — §5.5 矩阵已有，SC-15 组件未盖全 unavailable／越界／partial。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| F03 | D14／§6.3／SC-09／SC-10：逐桶 ID 集相等；交换夹具必须失败 |
| F04 | D12／§7／SC-17：先判 `result.ok`；失败带 reason → unavailable |
| F05 | SC-15：组件逐项覆盖 §5.5 全分支 |

## 第 3 轮

对象是 Spec／Plan **v0.3**。结论：**可定稿（附条件）**。阻塞 0，高 0，中 0，低 1。摘录：`inbox/codex-review-access-map-hourly-detail-round3.txt`。

已闭合：F03、F04、F05 及第 1 轮其余项。

残留（不退回）：

1. **N1｜低** — SC-07「非空成功冒充」笔误，缺禁止表达；§5.5／D12／SC-17 语义已正确。

## 第 3 轮后补丁（定稿）

| 项 | 处理 |
|---|---|
| N1 | SC-07 改为：access unavailable → `detail:null` 或显式 unavailable，禁止无说明成功空表冒充 |

**定稿条件：** Codex 三轮已完成；N1 已补正。定稿不表示开发已授权，也不表示 SC 已执行。本条收口不表示可上线。
