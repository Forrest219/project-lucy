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
