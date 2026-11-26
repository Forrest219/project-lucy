# 公共首页与静态公开接口隔离 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.0** |
| 日期 / 功能编号 | 2026-11-24／**P1-84**／REQ-030-105 |
| 状态 | S4｜v1.0。与 Spec 同句：**终稿已确权**（委托人明示「按这个处置，并定稿，暂不开发」；无 Codex CLI 复审，按委托人明示确权先例）；诊断 Gate 已完成；OQ-2＝A；OQ-1／OQ-7 已冻结；**开发授权已获得（2026-11-26）且 Task 1–5 已实施（`bcb768d8`；H1 切片清单为空）**；Task 6 测试台 **FAIL（单一未决项：事件循环臂完整 ≥3 min 窗预算；02–08 PASS／PASS WITH GAP）**；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 终稿确权已获委托人明示；**开发授权须委托人另发**，在此之前禁止改产品运行代码、禁止建 runner 脚本 |
| 验收 | Spec SC-01–SC-08；`UAT-PES-R0／01–08`（含 04b；06b 条件触发）；SC-09 随 OQ-6 延期 |
| 关联 | [Spec](../specs/lucy-20261124-public-entry-static-isolation-spec.md) · [UAT](../qa/uat/suites/public-entry-static/suite.md) · [对抗评审](../reviews/2026-11-24-p1-84-public-entry-static-isolation-adversarial-review.md) · [INDEX](../qa/uat/INDEX.md) |

## 目标

在 Docker 单实例同进程拓扑下，使公共入口（A／B／C 三类）在混压下按预算可用；合法 MCP 与管理只读两臂各自成交或有界拒绝并可恢复；对照臂可复证改前越线。架构：**OQ-2＝A（同进程让出）**，范围与指标见 Spec §3.1.1。

**技术栈：** Node.js／TypeScript、Fastify、Vitest、Docker Compose、真实前台 Chromium、既有 MCP／展示夹具。

## 开工前置

1. 读 Spec v1.0、UAT、DEVELOPMENT「主路径可用性优先」、对抗评审（含第二轮 §8）、[诊断报告](../../inbox/p184-diag-20261124/REPORT.md)。
2. ~~诊断 Gate（Task 0）~~ **已完成**（2026-11-24）。
3. OQ-2＝A；OQ-1／OQ-7 已随终稿冻结（Spec §6）。
4. **取得委托人另发的开发授权**后再改运行代码。
5. **与 P1-75 合流顺序**：P1-75 先落地 H1 相关改动，本条在其结果上复测，不重复改同一函数（Spec §3.1.1）。
6. 准备基线镜像或对照臂开关（Spec §3.7）。

## 任务分解

### Task 0：诊断 Gate（已完成；无产品运行时代码变更）

证据：[`inbox/p184-diag-20261124`](../../inbox/p184-diag-20261124/REPORT.md)（`probes.jsonl` sha256 `fb80d23e…310e02`；scale PASS；sync／async／idle 分臂）。

结论摘要：同步臂使入口与 `livez` 同滞 → 选项 A 必要；空闲／异步突发未复现 0-byte → 不取消本条；「探针绿入口死」仍待混压复证；OQ-3 已冻。

### Task 1：热点基线实测与切片范围（须开发授权；先于实现）

1. 对 Spec §3.1.1 的 H1–H4 逐项在基线上测同步片段耗时与事件循环延迟。
2. 单片 > 250 ms 的 H1 子路径纳入切片清单；H2／H3 仅回归；H4 超限者登记差集指向 P1-82。
3. 基线上若无生产重工作臂能复现越线 → 记录并按 UAT R0 判 BLOCKED＋差集。

**Expected:** 切片清单与差集登记落盘；不在此步改产品代码。

### Task 2：分类器与三类边界（TDD）

- `public-entry-surface` 分类 A／B／C；禁止扩大 `isPublicApi`。
- 单测：命中／未命中、auth 不共享缓存契约、非目标受保护 API 不被公开、分类器与钩子顺序不改变既有撤权／DRAINING／`no-store` 语义。

### Task 3：按 OQ-2＝A 实现

- 按 Task 1 切片清单：单片 ≤ 250 ms、片间让出（沿用 `yield-slices.ts`）；公开路径禁 await MCP／全量展示构建；品牌代次缓存＋写屏障＋首读 mtime／size 校验。
- 公平性：FIFO 让出，不引入公开入口抢占优先队列；重工作在 ≥ 1 Hz 公开探测下完成耗时 ≤ 基线空闲 3 倍。
- 不采用 B／C；不得宣称分进程。

类 C 登录保留完整安全语义；合法凭据正向路径必须成功签发。

### Task 4：运行时证据钩子（SC-07）

公开快路径计数：MCP 上游发起次数、展示全量构建次数、重扫描次数；UAT 断言三类均为 0，**无白名单例外**。

### Task 5：UAT runner 建设（须开发授权）

- 入口约定：`scripts/uat/public-entry-static.mjs`＋`npm run uat:public-entry-static`（命名可调整，须登记在 [fixtures](../qa/uat/suites/public-entry-static/fixtures.md)）。
- 覆盖：独立探测（≥ 1 Hz、客户端计时、JSONL 账本）、基线／最终配对、MCP 在途保持、04b 负例、清理回执、判定脚本（P99／max／超时／0-byte）。
- 浏览器部分走真实前台 Chromium，不由 runner 以 API 代替。

### Task 6：双镜像／对照臂 UAT

1. 基线或 feature-off 臂：R0／01 越线（注入器鉴别）。
2. 最终臂：R0＋02–08（含 04b）；06／06b 按 Spec；事件循环压力为生产重工作臂。
3. 浏览器 `primaryReady` 强制。
4. 既有认证回归、EQUIV-GUARD、`sweep:event-loop:gate` 不得退化。

## 浏览器验证

不适用：仅指「交互合同」——本条不改变用户可见 WebUI 表面，故豁免交互合同。**浏览器可用性验证仍然适用，不得跳过**：`UAT-PES-02`／`04`／`08` 须真实前台桌面 Chromium＋即时计时与 API 分列；`primaryReady` 见 Spec §3.5；仅 API smoke 不得主张 WebUI 面通过。

## 验收

- SC-01–SC-08 有证据；INDEX 如实；无扩白名单；无导航 IA 变更。
- OQ-2＝A、OQ-1／OQ-7 冻结值已写入 Spec 与本 Plan。

## 完成定义

~~诊断 Gate → OQ-2 裁定 → 终稿确权~~（已完成） → **开发授权（待委托人另发）** → 实现 → 必做 UAT → 委托人验收后才可谈功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| 未诊断即实现 | Task 0 已完成；Task 1 基线实测先于实现 |
| 选项 A 工作量膨胀 | 切片范围限基线实测 > 250 ms 的 H1 子路径，不重写全站 |
| 与 P1-75 冲突 | P1-75 先落地、本条复测；展示全量构建不进公开路径 |
| 注入器通过冒充修复 | 最终臂须生产重工作臂，否则 BLOCKED＋差集 |
| 不可切片热点 | 不在本条出口；登记差集转 P1-82 B1 |
