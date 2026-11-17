# 错题：访问关系图修复后仍「不是桑基」——线上镜像缺修复，HEAD 在零访问、多 Agent 下仍退化成文字和发丝

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-17 |
| 标签 | `viz-geometry` `empty-default` `data-trust` `gate-gap` `sev-med` |
| 环境 | 线上 `http://10.69.95.109:8276`（`lucyVersion=0.25.0`、`gitSha=6d2664b3`）；沙箱旧码 `6d2664b3`／HEAD `65f40847` |
| 相关 | [Spec](../specs/lucy-20261117-access-map-sankey-restoration-spec.md)（v0.2，已实现并提交）· [测试台](../qa/uat/suites/access-map-sankey-design/suite.md)（Docker 种子容器全真 PASS WITH GAP，线上 07 BLOCKED）· 前序错题 [2026-11-13-access-map-sankey-empty](2026-11-13-access-map-sankey-empty.md) |
| 状态 | `open`（修复已提交；线上未升级、未核对） |

## 1. 症状与影响

- 管理员打开 `/admin/access-map`，看到的是一页文字标签，没有桑基流带。委托人原话：「当前并没有实现桑基图的效果，出现了严重偏离设计意图的」。
- 线上镜像相对 2026-11-13 的修复**没有任何改善**：health 的 `gitSha=6d2664b3` 含 confirmed-only，不含 `f3f88837`（允许词表）与 `e2ca2ca7`（空桑基修复）。
- 影响面：访问治理主视图；不影响问数主路径。

## 2. 复现要点

用同一份沙箱数据 `rich`（173 次允许调用、2 次拒绝）对比两套码，见 [基线跑次](../qa/uat/suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-probe-baseline.md)：

- 旧码：`accessPaths=0`、`rawCalls=0`、`deniedCalls=175`；156 条边全 `dormant`，无流带。
- HEAD：`accessPaths=20`、`rawCalls=173`、`deniedCalls=2`；25 条流带。
- HEAD 在三类数据下仍退化：`grants-only`（0 流带、柱全 3px、无表节点）；`dense`（77 个柱 76 个高度为 0，75 条流带不可见，SVG 高 1350 无上限）；`candidate-only`（175 次调用被静默吞掉，页面与零访问无区别）。

## 3. 根因

分层：

- **环境**：线上镜像落后于已合入的修复；`outcome=ok` 被当成拒绝，是旧码 F-1。
- **合同**：usage-first 把访问面当唯一主视觉，零访问时没有授权面可看；confirmed-only 硬锁使未确认关联不显示也不计数（F3／F5）。与 Spec 187 的「授权面＋访问面双层」意图不一致（D0 待裁定）。
- **实现**：`AccessMapCanvas.tsx` 的 `rawUnit=(usable−reserve)/columnFlow`，列流量大时先被压到接近 0，再被 `usable/maxColumnHeight` 缩小；`IDLE_GRANT_PX=3`、`BACKBONE_PX=3` 使闲置与骨干只剩发丝。
- **数据**：线上 Agent 数、`association_status` 分布未核对（SANKEY-07 BLOCKED）。

## 4. 为何漏检

- 既有 `UAT-SUITE-ACCESS-MAP`（UAT-ACCESS-MAP-01／02）把「零访问时有闲置骨干连通带」判为 PASS，即上一轮合同**主动接受**了零访问只剩发丝的形态；套件没有多 Agent（dense）与全未确认（candidate-only）形态，所以这两类退化不会被抓到。
- 该套件按 DOM 是否出现骨干 path 判定，不量柱高与流带可见厚度。
- 线上 `gitSha` 是否含修复，不在任何验收步骤里（R0 只要求「容器含修复提交」，由人去比）。

## 5. 举一反三

1. 把「退化形态可接受」写进合同前，要先问「这是不是委托人要的桑基」；PASS 条件若只是「元素存在」，要同时写可见厚度下限。
2. 下次改访问面几何，验收必须带 `grants-only`、`dense`、`candidate-only` 三种种子，并用 DOM 实测柱高、流带数，不接受只看函数返回值。
3. 声称「线上已改善」前，先对 `/api/health.gitSha` 做 `git merge-base --is-ancestor`，再谈页面。
4. 硬过滤（confirmed-only 之类）必须同时回显被滤掉的计数，不得让用户无法分辨「没有」和「被隐藏」。
5. 几何压缩要有下限与滚动上限：压到不可见即视为失败，不能靠「总高度合规」过关。
6. UAT 数据用确定性合成种子，旧码与 HEAD 同数据 A/B，才能把「镜像没升」和「设计缺陷」分开。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 委托人裁定 D0（设计意图编码哪一版，推荐 C） | 已完成 | D0＝C，2026-11-17 |
| 线上核对（登录后跑 SANKEY-07，或取线上 Agent 数与关联分布） | 未开 | 需委托人给登录或自行登录；升级另行授权 |
| 线上升级到含 `e2ca2ca7` 的版本 | 未开 | 发布线待裁定（Spec Q2）；≠ 开发授权 |
| 按 Spec Track A／B 实现 | 已完成（已提交） | 授权不含线上升级；Docker 全真 PASS WITH GAP 见 docker-seeded run |

## 7. 证据指针

- 基线跑次与截图：`docs/qa/uat/suites/access-map-sankey-design/runs/`
- 种子与沙箱：`webui/tests/uat/access-map-sankey-fixture.ts`、`webui/scripts/uat-access-map-sankey-sandbox.mts`
