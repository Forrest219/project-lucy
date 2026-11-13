# 端到端台账勾连（lucy-v0.30 现行）

| 元数据 | 内容 |
|---|---|
| 角色 | **三台勾连表＋基准线追评**（不是第四套「总状态」）。规则正文在 [`DEVELOPMENT.md`](DEVELOPMENT.md)「端到端三台账」 |
| 产品线 | `0.30.0`／`lucy-v0.30` |
| 日期 | 2026-11-13 |
| 维护 | 只改指针与缺口；UAT 判定只改 [`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)；合同状态只改 Spec 头部 |

## 0. 测试台第一性原则（全局）

规则正文亦见 DEVELOPMENT「端到端三台账」第 4 条与 [`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)。

| 原则 | 含义 |
|---|---|
| 全真优先 | 对抗／交叉验证必须在真实 demo Docker／WebUI／API／supervisor 上**构造并执行**用例 |
| 禁止 CR 冒充 | Code Review、读代码评论**不是** UAT，不得写入 INDEX 为 PASS |
| 降级须独立授权 | 做不到全真 → 跑次 `BLOCKED`＋上报委托人；获独立授权前不得用 mock／替身／CR 主张验证 |

## 1. 三台 SOT 指针

| 台 | SOT | 现行路径 |
|---|---|---|
| 需求台 | 产品线执行总账＋需求池正文 | [清单池](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 开发台 | Spec 头部「状态」 | 各 `docs/specs/…-spec.md`／`webui/docs/191-…`（镜像：总账「跟进状态」、plans README） |
| 测试台 | UAT INDEX＋套件 runs | [`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md) |

## 2. 勾连表（本文件为勾连 SOT）

| 清单 ID | REQ | 开发台 Spec | 测试台 Suite | 最近 UAT | 备注 |
|---|---|---|---|---|---|
| P1-15 | REQ-030-036 | [Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md) | [`UAT-SUITE-CONN-RELOAD`](../qa/uat/suites/connection-runtime-reload/suite.md) | [Claude 交叉 2026-11-13 PASS](../qa/uat/suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md) | GATE-01／RELOAD-02 交叉仍 PASS；Cursor 同批见 [cursor-gate-reload](../qa/uat/suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md) |
| P1-16 | REQ-030-037 | [catalog-scan Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) | [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md) | [Claude 交叉 2026-11-13 PASS](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md) | CASE-01／DIFF-01 交叉 **PASS**（`Bar`／`bar`，双缺表）；矩阵仍 PASS；EXT live **BLOCKED** |
| P0-1…5／A | 027／023／024／022／018／012 | 各 P0 Spec（功能合同已收口） | **`not_registered`** | — | 合同收口 ≠ UAT；待补客户场景套件或显式 n/a |
| P0-6／7／B | 025／026／028 | draft／冻结 | **`n/a`（未授权实现）** | — | 无交付主张前不强制 UAT |
| P1-11／12／14 | 032／033／035 | 各 Spec（已收口／取证） | **`not_registered`** 或工程向待标 | — | 差集：有用户／运维面者应补 UAT 或标工程向 n/a |
| P1-13 | REQ-030-034 | [发版性能基线 Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) | [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md) | [2026-11-13 PASS](../qa/uat/suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | Roles／Agent 页体感 UAT；发布取证仍见 acceptance，≠ 可上线 |
| P1-17 | REQ-030-038 | [空桑基 Spec／closure](../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md) | [`UAT-SUITE-ACCESS-MAP`](../qa/uat/suites/access-map-sankey-empty/suite.md) | [2026-11-13 Claude 对抗 PASS WITH GAP](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-13-claude-adversarial.md)（同场 [Cursor](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-13-cursor-docker-sankey.md)） | 必做空态 PASS；可选 04 FAIL（`outcome='allow'` 词表漂移 F-1） |
| P1-18 | REQ-030-039 | Skill closure | **`n/a`（工程向）** | — | 中间态 CLOSED；工程向入口，不强制客户场景 UAT |
| P1-19 | REQ-030-040 | [允许词表 Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) | **`not_registered`** | — | 实现已授权；UAT 复跑前不得写 PASS |
| 其余 P1／P2 | … | 见总账 | **`not_registered` 或 `n/a`** | — | 出门前按 DEVELOPMENT 兜底扫 |

取值约定：

| 测试台单元格 | 含义 |
|---|---|
| Suite ID＋链接 | 已挂测试台 |
| `not_registered` | 需求／开发台有行或主张，测试台尚无套件（**缺口，须补或降叙事**） |
| `n/a` | 明确不要求客户场景 UAT（冻结未实现、纯工程向且叙事已标工程向） |

## 3. 兜底队列（现行缺口）

| ID | 缺口 | 建议动作 | 优先级 |
|---|---|---|---|
| GAP-UAT-P0 | P0-1…5／A 合同已收口但无 UAT 套件 | 按问数主路径补套件，或在 `user-facing` 出门前书面 `not_registered` 不主张「场景 UAT 已过」 | P0 |
| GAP-UAT-P1-13 | ~~P1-13 无客户场景 UAT~~ | **已挂** [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md)；发布取证 acceptance 仍独立，≠ 可上线 | P2 |
| GAP-UAT-P1-17 | 空桑基必做已过；F-1 已立项 P1-19 | 允许词表实现见 [Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md)。UAT-ACCESS-MAP-04 复跑前保持未过 | P1 |
| GAP-UAT-P1-18 | Skill 入口 CLOSED，工程向 | 勾连表已标 `n/a`（工程向）；保持工程向叙事 | P2 |
| GAP-UAT-EXT | P1-16 EXT live **BLOCKED**（demo 无 `catalog.database` 形态连接；vitest 只是替身，不得写成 EXT live PASS） | **2026-11-13 委托人选择暂不补跑**，套件保持 PASS WITH GAP。要关闭：提供容器内可达的真实外部目录连接（凭据仅给路径）后补跑，或书面授权以替身收口 | P1 |
| GAP-UAT-MYSQL-VER | P1-16 矩阵自 5.7 | **已关闭（2026-11-13）**：`mysql:5.7` 拉取成功后矩阵 **5.7.44／8.0.46／8.4.13 PASS**。见 [补跑](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-mysql-version-matrix-57.md)。跑次镜像 `gitSha=ea4ef839`，不含其后的 `aa559a1c` | P2 |
| GAP-LINK-POOL | 总账行未普遍挂 Suite 列 | 以本勾连表为准；总账 Spec／Plan 列逐步回链 | P2 |

机器兜底：

```bash
node scripts/uat/check-e2e-ledger.mjs
```

## 4. 基准线追评（2026-11-13）

### 4.1 已立住的

1. **需求台**：清单池已升格为产品线执行总账（v0.51+），含差集补录 P1-15…18；先入账再叙事有口令。  
2. **开发台**：Spec 头部唯一现值＋镜像纪律长期存在；`stale-status` 有机器牙。  
3. **测试台**：`docs/qa/uat/` 今日立项；连接热重载／库内扫表两套有 cases／fixtures／runs。  
4. **规则层**：DEVELOPMENT 已写总账 SOT；本文件补齐三台勾连与测试台兜底。

### 4.2 仍弱的（基准线缺口）

1. **测试台覆盖极窄**：P0 主线问数合同已收口，但 **UAT 套件数＝2**，相对总账行数严重不足；「收口」易被误读成「测过」。  
2. **发布取证与测试台边界**：P1-13 已挂客户场景套件 `UAT-SUITE-ROLES-AGENT-PERF`；发布取证 acceptance 仍独立一层，禁止把 UAT 绿写成可上线。  
3. **总账表尚未结构化「测试台」列**：靠本勾连表＋人工，易再次漂移。  
4. **机器兜底偏软**：`check-e2e-ledger.mjs` 只验链接存在，不验跑次是否过期、不验与 Spec 状态逻辑一致。  
5. **历史债**：大量「功能合同已收口」行默认 `not_registered`，出门若无差集扫描会再次漏登。

### 4.3 基准线判定（一句话）

> **需求台／开发台基准可用；测试台刚起步；端到端「可主张已 UAT」的基准线尚未达到产品线规模——当前仅 P1-15 全绿、P1-16 带 GAP，其余交付主张默认不得声称 UAT 完成。**

### 4.4 下一刀（不在本文件自动开工）

1. 为 P0-1…5／A 各定：补 UAT 套件 **或** 显式 `n/a`＋理由。  
2. 总账 §3 增加「测试台」指针列（或稳定外链本表）。  
3. 将 `check-e2e-ledger.mjs` 挂到可选 npm script／出门 checklist。  
4. 明确发布取证与测试台的边界句（仍禁止混写可上线）。

## 5. 变更

| 日期 | 内容 |
|---|---|
| 2026-11-13 | CASE-01／DIFF-01 在升级后的 demo 复跑 PASS，Claude 交叉（`Bar`／`bar`、双缺表）仍 PASS。EXT live 仍 BLOCKED |
| 2026-11-13 | 本机补跑 zhaomin 缺口：GATE-01／RELOAD-02 PASS；CASE-01／DIFF-01 当时 FAIL（镜像 `ea4ef839`） |
| 2026-11-13 | P1-16 矩阵补跑：5.7／8.0／8.4 PASS；EXT live 仍 BLOCKED。关闭 GAP-UAT-MYSQL-VER |
| 2026-11-13 | 挂 P1-13 ↔ `UAT-SUITE-ROLES-AGENT-PERF`（Roles／Agent 页体感） |
| 2026-11-13 | 首立：三台指针、勾连表、兜底队列、基准线追评；挂 P1-15／P1-16 |
