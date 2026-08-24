# UAT：AC-P1 Row Policy

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1 Row Policy UAT 勾选清单 |
| 文档类型 | Checklist |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 99 v0.1.2；ADR `adr-upstream-forced-predicate.md` v0.2；WO-60；`inbox/20260809-ac-p1-by01-uat/`；`inbox/20260809-ac-p1-runbook-uat/` |
| 适用范围 | Gate C 人工验收（行授予 / 强制谓词）；**不含** Dynamic RLS / P1.5 Constraints |
| 输出位置 | `docs/access-control/uat-ac-p1.md` |

> 勾选规则：关键路径须人工勾选；已有自动化覆盖的项可标「自动化」并抽检。  
> **Gate C 签字：** **2026-08-09 由 xingchen 总批准**（详见 `inbox/20260809-ac-p1-gate-c-signoff.md`）。  
> **proven：** 总签后**允许**运维置真；产品默认与当前 UAT 环境仍为 `false`，置真须单独变更。

---

## 0. Fixture

- [x] Role：`scoped` + 合法 `row_policy`（`region=East`）；对照 Role：`row_access: all`（`demo_readonly`）
- [x] Agent：单 Role scoped（`scoped_east_agent`）；自动化覆盖双 Role OR / all 胜出
- [x] Overlay：`superstore_orders` 含 columns + measures（BY-19）
- [x] Token 可调 MCP DataPlane（演练后已 revoke）

---

## 1. 编译与 Admin（SC-P1-02 / 06 / 07）

| 项 | 期望 | 自动化 | 人工 |
|---|---|---|---|
| 合法 scoped+row_policy 保存 / 编译 | `runtimeAck` + preview 见 scoped digest | 部分（单测） | [x] Path A + Preview |
| 缺 policy / 非法 op / measure 字段 | 保存或编译失败 | BY-19 / SC-P1-02 | [x] Path A dryRun 400 |
| `constraints` 出现 | 拒绝 | lint + 编译 | [x] 自动化 |
| 收窄失败盘与 runtime 不留更宽 | 继承 AC-P0 | U-REL | [x] Path C degrade/recover |
| **禁止**「有行级文案但未注入」成功态 | Admin 不宣称取数已行级生效（proven 前） | — | [x] Preview 显示 scoped digest；proven 默认 false |

---

## 2. Bypass 矩阵（AC-SEC-ROW）

| ID | 场景 | 期望 | 自动化 | 人工 |
|---|---|---|---|---|
| BY-01 | proven + `lucy_query` 无用户 filter | Proxy 注入 `forced_filters` + **`filters[]` 强制前缀**；**行集 ⊆ 强制域** | ✅ | [x] `inbox/20260809-ac-p1-by01-uat/` |
| BY-02 | 用户 OR/旁路 filter | deny 或无域外行 | BY-02/13 形状 deny | [x] 自动化抽检 |
| BY-03 | 字符串 `filters` | deny | ✅ | [x] BY-01 包 + 自动化 |
| BY-04 | ad-hoc `measures[].expr` | deny | ✅ | [x] 自动化抽检 |
| BY-05 | 伪造 `forced_*` | 剥离且不削弱 Proxy 注入 | ✅ | [x] BY-01 集成 |
| BY-06 | `entity_details` / `sl_validate` | `row_policy_requires_wrapped_tool` | ✅ | [x] Runbook Path A |
| BY-07 | `lucy_read_source` | 同上 | ✅ | [x] Runbook Path A |
| BY-08 | `sl_query` | AbsoluteDeny | ✅ | [x] Path C 恢复后抽测 |
| BY-09 | proven=false 取数 | `row_policy_upstream_unproven` | ✅ | [x] Path A/B |
| BY-10 | 多 Role OR 东∪西 | orArms=2；非 AND | ✅ | [x] 自动化抽检 |
| BY-11 | 一源 scoped + 一源 all | 单 scoped 可注入；双 scoped → shape deny | ✅ | [x] 自动化抽检 |
| BY-12 | LEFT JOIN / 别名逃逸信号 | deny | ✅（args 信号） | [x] 自动化抽检 |
| BY-13 | 括号 / 布尔树 | deny | ✅ | [x] 自动化抽检 |
| BY-14 | 自连接信号 | deny | ✅ | [x] 自动化抽检 |
| BY-15 | 聚合 / HAVING 信号 | deny | ✅ | [x] 自动化抽检 |
| BY-16 | 子查询信号 | deny | ✅ | [x] 自动化抽检 |
| BY-17 | `lucy_freshness` × 受保护源 | `row_policy_requires_wrapped_tool` | ✅ | [x] Runbook Path A |
| BY-18 | `lucy_explain_query` | 本地 allow；E1–E5 | ✅ | [x] BY-01 / Path A 抽检 |
| BY-19 | measure 作 policy field | 编译失败 | ✅ | [x] Path A dryRun |

自动化命令：

```bash
cd webui && npm test -- --run row-policy-ac-p1 ac-security-eval mcp-proxy-row-policy-by01-by18
```

> **证据分层：** mock-KTX + Docker 集成行集 ⊆ 域；Lucy 承载 `filters[]`；**不**依赖向 `kaelio/ktx` 发版。

---

## 3. 未证明与 proven 门禁（SC-P1-04 / 05 / 08）

- [x] 默认环境：scoped 源 `lucy_query` → `row_policy_upstream_unproven`（Path A/B）
- [x] Gate C 材料齐全后**允许**置 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true`（运维变更；默认仍 false）
- [x] Release notes / 对外说明 **未**声称 Dynamic RLS / 多租户隔离 / DB 原生 RLS — [`release-notes-ac-p1.md`](release-notes-ac-p1.md)

---

## 4. Runbook 演练

- [x] 行策略误配恢复 — 路径 A（`inbox/20260809-ac-p1-runbook-uat/`；xingchen 批准）
- [x] 未证明 / 误开 proven 恢复 — 路径 B（同上）
- [x] 非法 scoped YAML 回滚 — 路径 C + banner/health（同上）

---

## 签字

| 项 | 签名 | 日期 |
|---|---|---|
| 自动化矩阵抽检 | **xingchen** | **2026-08-09** |
| Admin Preview 确认 | **xingchen** | **2026-08-09** |
| BY-01 部署行集抽检 | **xingchen** | **2026-08-09** |
| Runbook A/B/C | **xingchen** | **2026-08-09** |
| **Gate C 批准** | **xingchen** | **2026-08-09** |

— 完
