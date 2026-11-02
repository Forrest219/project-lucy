# 访问关系图与访问日志口径对齐：Codex 交叉审阅

- 审阅方式：本机 Codex CLI，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，只读。各轮修订由实施代理落地。
- 对象：`lucy-20261102-access-map-audit-echo` Spec／Plan。
- 原始摘录：`inbox/codex-prompt-access-map-audit-echo-roundN.md`、`inbox/codex-review-access-map-audit-echo-roundN.txt`（可删工作副本）。
- 上限：两轮（用户指定）。

定稿只覆盖这份设计合同。功能合同未收口，SC 未执行，运行代码未改。定稿不表示开发已授权。本条收口不表示可上线。

## 第 1 轮

对象是 Spec／Plan **v0.1**。结论：**退回修订，不定稿。** 阻塞 0，高 3，中 2，低 0。摘录：`inbox/codex-review-access-map-audit-echo-round1.txt`。

1. **R1｜高** — D6 未冻结关联键与推断重建准备；可能误排真实查数调用。
2. **R2｜高** — 「同筛选审计集合」无现成入口；共享夹具可自证通过；时间上界／协议闸门与审计分叉未写清。
3. **R3｜高** — 跨边计数与结构筛选范围未冻结；Σ accessCalls 与并集混淆；SC 只验数量。
4. **R4｜中** — 实际改候选集合，不能只登记为呈现修订；Spec 187 §4.2／§5.2 指针不足。
5. **R5｜中** — Plan 阶段与 SC 证据种类有漏；非法值验收不足。

已核对无问题：落位与索引、闭口层级、授权边界、枚举与缺省、trust 默认、关联口径用语、「问询计入」退役覆盖。

## 第 1 轮后修订（→ v0.2）

| 项 | 处理 |
|---|---|
| R1 | D6 冻结显式键优先、推断表次之；重建准备失败 → unavailable；扩充 SC-10／SC-12 |
| R2 | D8／D11 定义投影集合 E；半开区间；对照时期望 id 预写；改 SC-13 |
| R3 | 结构筛选前 ⋃I(e)=E；禁止 Σ accessCalls；meta 标明范围；改 SC-14 |
| R4 | 头部与 D13：修订候选集合；Spec 187 §4.2／§5.2／§6.3／§7.4；SC-18／SC-20 |
| R5 | Plan S1／S2／S3 覆盖 SC-01–SC-20；非法新参 400（D10／SC-19）；与审计非法回落的有意差异写明 |

## 第 2 轮

对象是 Spec／Plan **v0.2**。结论：**退回修订。** 阻塞 0，高 0，中 2，低 0。摘录：`inbox/codex-review-access-map-audit-echo-round2.txt`。

已闭合：R1、R2、R4、R5。R3 并集代数已闭合。

残留／新问题：

1. **R3｜中（残留）** — 结构筛选后 meta 仍须验：E={a,b} focus 后并集 {a} 但 enteringAllowCallCount 仍为 2；layer 不改 E。
2. **N1｜中** — 仅返回 E 会丢 deny 计数；须冻结候选 B、允许 E、拒绝 D，`deniedCalls=|D|`。

## 第 2 轮后修订（→ v0.3 定稿）

| 项 | 处理 |
|---|---|
| R3 残留 | D8／SC-14 写入 scope／focus／layer 夹具与 meta 范围 |
| N1 | D8／§6／SC-14／Plan：B／E／D；路径用 E；deniedCalls=\|D\| |

按用户「两轮定稿」上限，残留已按可贴句闭合，**未开第 3 轮**。

**定稿条件：** 本轮残留已满足。定稿不表示开发已授权，也不表示 SC 已执行。
