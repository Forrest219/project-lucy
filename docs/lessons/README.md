# 错题本（Lessons）

开发／交付过程的错题本：登记已经核实的错误，写清根因与漏检点，抽出可迁移的「举一反三」规则。  
**登记 ≠ 开发授权**；需要改产品时另开 Spec／Plan／需求池条目。

**别名**：事故清单／问题清单／经验清单／复盘清单 → **本目录**（不是 `docs/runbooks/*checklist*` 出包勾选表）。Agent 入口见仓库根 [`AGENTS.md`](../../AGENTS.md)。

## 何时写入

| 写入 | 不写入 |
|---|---|
| 已复现，有根因（或明确「未知待查」） | 未核实的猜测 |
| 合同／实现／数据／门禁叠加导致的失效 | 纯过程对抗笔记（→ `docs/reviews/`） |
| 客户或部署侧可感知的回归／空态／误报 | 一次性调试输出（→ `inbox/`） |

## 怎么新增（按周可扩展）

1. 复制 [`_template.md`](_template.md) → `YYYY-MM-DD-<slug>.md`（`slug` 小写连字符，一眼能懂）。
2. 填完「一句话错题／根因／漏检／举一反三／后续动作」。
3. **在本页索引表最上方加一行**（最新在上）。
4. 有相关 Spec／commit／环境证据时用相对链接引用；不要把大段日志贴进正文。

### 扩展约定

- **近期**：文件平铺在本目录；靠日期前缀排序。按周新增没有问题。
- **标签**：每条选 1–4 个（见下表），方便按主题扫，而不是只靠文件名。
- **变多以后**：单年超过约 40 条或索引难扫时，再拆 `docs/lessons/YYYY/`，本 README 的索引可改成分年小节；**不要**提前建空年份目录。
- **Agent**：改访问面几何、关联口径、默认筛选、空态呈现等主题前，先按标签扫本索引；相关错题的「举一反三」优先遵守。

### 推荐标签

| 标签 | 含义 |
|---|---|
| `contract-stack` | 多条合同／呈现叠加后失效 |
| `empty-default` | 默认筛／默认口径把主路径滤成空 |
| `data-trust` | 关联／信任／confirmed 等数据口径 |
| `viz-geometry` | 图／桑基／计量几何 |
| `gate-gap` | 门禁／验收没盖住部署实况 |
| `ux-regression` | 用户可感知的空／错／不可用 |
| `ops-delivery` | 升级／镜像／客户环境 |

严重度（可选）：`sev-high`（主功能在部署侧几乎不可用）、`sev-med`、`sev-low`。

## 索引（最新在上）

| 日期 | 一句话错题 | 标签 | 文件 |
|---|---|---|---|
| 2026-11-19 | FDE 复核的 5 个缺陷（慢合法 Hive 语法误判超时、宽表整批 deferred 不收敛、单表 deferred 静默假成功、正式导出追平后仍 409、滚动窗口重复归属）本机可复现，旧 UAT 与默认套件都没拦住：用例只测快路径、缺陷代码晚于最后一次 UAT、F01 症状被记成「既有行为」、移植 84 分支测试时计划写「保留」实际全改 `it.skip` 且未入总账、UAT runner 不看 `deferred` | `gate-gap` `contract-stack` `ux-regression` `ops-delivery` `sev-high` | [2026-11-19-fde-3b1c62af-defects-missed-by-uat.md](2026-11-19-fde-3b1c62af-defects-missed-by-uat.md) |
| 2026-11-18 | 回退基线 `3a9f0711` 缺 P1-20 修复：读外部目录字段全部失败（`ktx sql` 拒绝 `DESC`，请求没到 SelectDB），却被当成 hive-jd 的 Kerberos 问题排查；回退前症状仍未解释 | `ops-delivery` `gate-gap` `ux-regression` `sev-high` | [2026-11-18-rollback-baseline-lacks-external-catalog-field-fix.md](2026-11-18-rollback-baseline-lacks-external-catalog-field-fix.md) |
| 2026-11-18 | 访问日志调用流水渲染崩溃（合并进来的 auth_failure 行无 `tool`），被路由兜底边界伪装成「页面资源加载失败，可能是版本已更新」，整页不可用；兜底边界捕获所有渲染错误，`release-ux` 错误判定又不含该文案 | `ux-regression` `gate-gap` `contract-stack` `sev-high` | [2026-11-18-audit-calls-render-crash-misreported.md](2026-11-18-audit-calls-render-crash-misreported.md) |
| 2026-11-18 | 数据库原始错误不透出：外部目录读字段失败时，Kerberos 握手失败、元数据服务太慢、元数据服务起不来在页面上是同一句「没有读到字段」，原文只在容器日志；单表 8 秒预算与超时文案对不上 | `ux-regression` `gate-gap` `contract-stack` `sev-med` | [2026-11-18-db-original-error-not-surfaced.md](2026-11-18-db-original-error-not-surfaced.md) |
| 2026-11-17 | 访问关系图修复后仍不是桑基：线上镜像缺修复，HEAD 在零访问、多 Agent、全未确认下仍退化成文字和发丝 | `viz-geometry` `empty-default` `data-trust` `gate-gap` `sev-med` | [2026-11-17-access-map-sankey-regression.md](2026-11-17-access-map-sankey-regression.md) |
| 2026-11-17 | intranet-HTTP 复制 Toast「已复制」但剪贴板未写入（假成功） | `ux-regression` `gate-gap` `sev-low` | [2026-11-17-clipboard-http-fake-success.md](2026-11-17-clipboard-http-fake-success.md) |
| 2026-11-17 | 下载／导出／保存按钮的成功反馈不以真实结果为前提（静默失败与误报成功） | `ux-regression` `gate-gap` `sev-low` | [2026-11-17-button-feedback-silent-failure.md](2026-11-17-button-feedback-silent-failure.md) |
| 2026-11-17 | 客户 K8s 平滑升级后 event loop 卡顿，readyz 超时摘端点，入口 502／503（根因已定位：推断问询维护器启动 `scanFull` 同步全索引扫描，慢盘＋冷缓存下启动超时；启动幸存时重建页单页同步 2.7–5.9 秒致 livez 反复数秒；本机复现，Spec／Plan／测试台已起草） | `ops-delivery` `gate-gap` `ux-regression` `sev-high` | [2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md](2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) |
| 2026-11-16 | 表级歧义门闩把「已限定表名的查数」变成单向死路，且无逃生通道 | `contract-stack` `gate-gap` `ux-regression` `sev-high` | [2026-11-16-source-ambiguity-gate-deadlock.md](2026-11-16-source-ambiguity-gate-deadlock.md) |
| 2026-11-13 | 7 天访问日志同步重算占住事件循环，存活探针把 Pod 杀掉，概览报无法刷新 | `gate-gap` `ops-delivery` `ux-regression` `sev-high` | [2026-11-13-audit-read-blocks-event-loop.md](2026-11-13-audit-read-blocks-event-loop.md) |
| 2026-11-13 | 外部目录能列表却读不出字段：`ktx sql` 禁止 `DESC`，测试替身比真实 KTX 宽松 | `contract-stack` `gate-gap` `ux-regression` `sev-high` | [2026-11-13-external-catalog-column-read-ktx-describe.md](2026-11-13-external-catalog-column-read-ktx-describe.md) |
| 2026-11-13 | 访问关系图：confirmed-only × usage-first 叠出空桑基 | `contract-stack` `data-trust` `viz-geometry` `empty-default` `ux-regression` `sev-high` | [2026-11-13-access-map-sankey-empty.md](2026-11-13-access-map-sankey-empty.md) |
| 2026-09-02 | K8s 原地升级：镜像过门禁仍因 Chart／入口／PVC 契约失败 | `ops-delivery` `gate-gap` `contract-stack` `sev-high` | [2026-09-02-k8s-inplace-upgrade-contract.md](2026-09-02-k8s-inplace-upgrade-contract.md) |
| 2026-08-28 | 客户 MCP「未就绪」：未配对外 URL 却走 fallback | `ops-delivery` `ux-regression` `gate-gap` `sev-high` | [2026-08-28-mcp-public-url-fallback.md](2026-08-28-mcp-public-url-fallback.md) |
| 2026-08-27 | 客户 amd64：ELF／离线 uv／盲复用坏 tar | `ops-delivery` `gate-gap` `sev-high` | [2026-08-27-customer-amd64-elf-uv-blind-reuse.md](2026-08-27-customer-amd64-elf-uv-blind-reuse.md) |

## 与其他目录的边界

| 目录 | 职责 |
|---|---|
| `docs/lessons/`（本目录） | 错题／复盘／举一反三 |
| `docs/specs/` · `docs/plans/` | 功能合同与实施计划（改产品走这里） |
| `docs/reviews/` | 审阅、收口、实施笔记 |
| `inbox/` | 临时取证，可删 |

治理总纲见 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)。本目录不替代功能闭口与发布取证。
