# UAT-SUITE-ASSET-LIST-ZOOM — 资产列表 Zoom 交互

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ASSET-LIST-ZOOM` |
| 总账／需求 | **REQ-0120**（P1；不入核心分母） |
| 授权 | Spec 终稿确权 2026-11-27；**开发未授权**——本套件为设计与登记；正式跑次须开发落地后再授权执行；Plan／UAT 经 Kimi Code 三轮对抗（2026-11-27）结论 **Approve with nits**，记录见 [评审](../../../../reviews/2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md) |
| 修复合同 | [Spec](../../../../specs/lucy-20261127-asset-list-zoom-ux-spec.md)／[Plan](../../../../plans/lucy-20261127-asset-list-zoom-ux-plan.md) SC-01–SC-15 |
| 目标 | 在本机 demo Docker **真实前台浏览器**验证连接概览／启用表／Catalog／角色授权的有界曝光、单 Schema 组、搜索优先与挂载合同；禁止以 API／vitest／CR 冒充 WebUI PASS |
| 范围 | WebUI：`/connections`、`/connections/enabled-tables`、`/catalog`、`/admin/roles/:roleId`（表授权）；可选扩 `/admin/agents/:userId` 权限预览 |
| 档位 | **lean**（默认）。不要求全局 scale；若造数超过 lean 默认表量，在跑次注明夹具，不得主张规模基线 PASS |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/)（尚无；INDEX＝**NOT RUN**） |

## 必做

| ID | 对应 Spec | 要点 |
|---|---|---|
| `UAT-ALZ-R0` | 环境 | demo healthy；管理员登录；视口 1920×1080；记录 WebUI／MCP 端口 |
| `UAT-ALZ-01` | SC-04／SC-15 | 启用表：多 Schema 时同时只展开一组；未展开组无表行 |
| `UAT-ALZ-02` | SC-05／SC-13 | 启用表展开组：默认可见表行 ≤5；显示更多 +5；窗外无表行节点 |
| `UAT-ALZ-03` | SC-06／SC-14 | 启用表：搜索命中远端表可定位；总量 >5 时可见搜索引导；不依赖 Ctrl+F |
| `UAT-ALZ-04` | SC-15／P1-80 | 启用表：过滤总表行 ≤50 时仍不得多组同时挂表行；loading／error 不伪装缺 Manifest |
| `UAT-ALZ-05` | SC-07 | Catalog：`schema=all` 时同时只展开一组表行 |
| `UAT-ALZ-06` | SC-07／SC-14 | Catalog：组内默认 ≤5；搜索可用 |
| `UAT-ALZ-07` | SC-01／SC-02 | 连接概览：表未默认展开；Schema >20 时默认 ≤20 + 显示更多 |
| `UAT-ALZ-08` | SC-03 | 连接概览：展开单 Schema 表默认 ≤5；可系统内搜索 |
| `UAT-ALZ-09` | SC-08／SC-13 | 角色表授权：过滤后候选 >50 时单页 ≤50 且可分页 |
| `UAT-ALZ-10` | SC-09／SC-14 | 角色：搜索某表名可勾选；已选计数全局可见 |
| `UAT-ALZ-11` | SC-11 | 任管表页：搜索 0 命中空态引导改关键词 |
| `UAT-ALZ-12` | SC-12 | 本套件凡主张 WebUI 通过的用例须含前台浏览器计时（导航→主内容），与 API 耗时分列 |

## 可选

| ID | 对应 Spec | 要点 |
|---|---|---|
| `UAT-ALZ-13` | SC-10 | Agent 权限预览表名行 >50 分页（需可登录管理员打开目标 Agent） |

**SC-10 证据规则**：SC-10 为 Spec 收口出口成员。lean 下可登录 Agent 且权限预览表名行 >50 时 `UAT-ALZ-13` 必跑；不可达时跑次记 `SKIPPED` 并写明原因，SC-10 由 Plan Task 5 单测证据支撑、Spec 收口时点名复核——不得在无证据时主张 SC-10 PASS。

## 边界

- **禁止**用读代码／vitest alone 把 INDEX 写成 PASS。
- **禁止**点击破坏性保存（角色保存／启用表保存）除非用例显式要求且可回滚；默认只验展示与勾选草稿窗口。
- 不改 ACL YAML 语义验收；不测 Sankey。
- 开发未落地前跑次应记 **BLOCKED（实现未授权／未落地）**，不得记 PASS。
- 必做降级验证的授权规则以 [`CONVENTIONS.md`](../../CONVENTIONS.md) 为准（须向委托人单独申请），本套件自写纪律不替代之。
