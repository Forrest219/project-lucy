# WO-202608-59 访问权限 AC-P0 可交付实现计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问权限 AC-P0 可交付实现计划 |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-control/design-upgrade.md` **v1.1.2**（六项 ADR）；`docs/access-control/README.md`；`webui/docs/07-mcp-auth-proxy-spec.md`；`webui/server/proxy/{acl,mcp-proxy,identity,audit}.ts`；`webui/server/admin/{agents,roles}.ts` |
| 适用范围 | AC-P0 **Spec 撰写 + 实现任务拆解**；不含 AC-P1 Row Policy 注入；批准本 WO 的「实施闸门」后才改 runtime 代码 |
| 输出位置 | `docs/access-control/plans/wo-202608-59-access-control-p0.md` |

---

## 0. 执行状态与闸门

| 阶段 | 状态 | 说明 |
|---|---|---|
| 域档案落位 | **DONE** | `docs/access-control/` |
| ADR v1.1.2 | **已批准（Gate A）** | 本 WO 以该文为唯一设计事实源 |
| **Gate A：ADR 批准** | **DONE** | 2026-08-08；允许写 Spec / 术语 / 契约补丁 |
| **Gate B：AC-P0 Spec 评审通过** | 待勾选 | 勾选后才允许拆实施子任务并改代码 |
| Gate C：AC-P0 实现 + 门禁绿 | 未开始 | |
| AC-P1 | **冻结** | 本 WO 明确 Non-Goal |

**冲突裁决：** 实现与 Spec 冲突 → Spec；Spec 与 `design-upgrade.md` 冲突 → **design-upgrade**，并回修 Spec。

---

## 1. 目标与成功标准

### 1.1 目标（AC-P0）

在 **不引入 Row Policy 运行时注入** 的前提下，交付：

1. **Capability 合成**：`EffectiveDataCapabilities = ∪(tool × source × rowGrant=TRUE)`，消灭 `(∪tools)×(∪sources)` 笛卡尔放大。
2. **工具三分级**：AbsoluteDeny / DataPlane / Meta；**未分类默认 AbsoluteDeny**；`sl_*` 代码级不可移除。
3. **Canonical Source Key**（正反向）；同 connection 内 `sourceName` 唯一。
4. **`permission_model_version`**；v2 强制 `row_access: all`、**禁用 `prefix`**；legacy 一次性标 1。
5. **策略编译输入** = access.yaml + source map；`policyVersion` 绑定两者；Admin 收窄先编译后原子提交。
6. **单 Role 行为不弱于今天**（U-COMPAT-01）。

### 1.2 成功标准（可验证）

| ID | 标准 | 验证 |
|---|---|---|
| SC-01 | `lucy_query`×财务 + `lucy_read_source`×公共 合并不产生笛卡尔 | U-CAP-01 / S2 |
| SC-02 | 移除 YAML `deny_tools` 中 `sl_*` 后仍 deny | U-DENY-01 |
| SC-03 | 未分类工具不进 list 且 call deny | U-CLS-02 |
| SC-04 | 同 connection 重名 source 编译失败 | U-KEY-02 |
| SC-05 | Admin 收窄保存失败时盘与 runtime 均保持写前 | U-REL-01/02 / S10 |
| SC-06 | 单 Role legacy Agent 与升级前逐项等价 | U-COMPAT-01 |
| SC-07 | v2 + `prefix` / v2 + `scoped` 拒绝配置 | U-VER-02/03 |
| SC-08 | `sourceMapVersion` 变化触发 `policyVersion` 变化 | U-REL-04 / S12 |
| SC-09 | `lint:spec` + 相关单测 + `tsc --noEmit` 绿 | CI / 本地 |
| SC-10 | Spec `07`/`14`/`15` 与术语标准已同步 §9 契约清单 | 文档 diff 评审 |

### 1.3 Non-Goals（本 WO）

- `row_access: scoped` / `row_policy` / 强制谓词 AST / Agent Constraints
- Dynamic RLS、CLS、Active Role、Admin SSO
- 搬迁 `webui/docs/07` 出 webui（仅更新契约）
- 浏览器 E2E（除非后续 Spec 明确要求；默认按 DEVELOPMENT：不默认浏览器测）

---

## 2. 交付物清单

| 交付物 | 路径 | Gate |
|---|---|---|
| AC-P0 Runtime Spec | `webui/docs/<nn>-access-control-p0-runtime-spec.md`（编号在撰写时取下一可用号；建议紧跟现有序列） | A→B |
| Spec 07 补丁 | `webui/docs/07-mcp-auth-proxy-spec.md` | B 前完成草稿，B 时合并口径 |
| Spec 14/15 补丁 | Agent/Role Admin：`roles[]`、preview capability、版本迁移、runtimeAck | 同左 |
| 术语登记 | `webui/docs/00-product-terminology-standard.md` | A 后、B 前 |
| 实现代码 | `webui/server/proxy/*`、`admin/*`、`src/lib/types.ts`、相关测试 | Gate B 后 |
| Lint | `scripts/lint-spec.mjs` accessRolePolicy 扩展 | Gate B 后 |
| 迁移脚本 / dryRun 路径 | 存量 Role 标 `permission_model_version: 1` | Gate B 后 |
| Security Eval 子集 | `evals/…` 或现有 security suite 增 AC-SEC-SL/CLS/CAP/KEY/SCOPE | Gate B 后 |
| UAT 增量 | `docs/access-control/uat-ac-p0.md`（实施后） | Gate C 前 |
| 降级 Runbook | `docs/access-control/runbook-policy-degraded.md` | Gate C 前 |

---

## 3. 工作包拆解（可派工）

> **WP-S\*** = Spec/文档（Gate A 后即可）  
> **WP-I\*** = 实现（**仅 Gate B 后**）  
> 每包：负责人待填；验证命令见包内。

### WP-S0 — Spec 骨架与术语（0.5–1 天）

| 项 | 内容 |
|---|---|
| 输入 | `design-upgrade.md` §2 ADR、§5 场景、§6 测试、§9 契约 |
| 产出 | AC-P0 Runtime Spec 初稿；术语表 10+ 条目登记 PR |
| 必含章节 | Terminology Compliance；Tool Class 全表；capability 代数；canonical key；version/prefix；compile+submit；deny reasons；Non-Goals；验收映射到 SC-\* |
| 验证 | Spec 评审清单可勾；无「留给 Builder 决定」的安全语义空缺 |

### WP-S1 — 契约补丁草稿（0.5–1 天）

| 项 | 内容 |
|---|---|
| `07` | 新增 `capability_forbidden`；工具分级；`policyVersion`；绝对 deny；删除过时「不做行级」表述并改为波次边界 |
| `14`/`15` | `roles[]`；capability preview；Admin 迁移 v1→v2；`runtimeAck`；禁只展示 tools∪+sources∪ |
| 审计 | `policy_version`、capability digest、`policy_scope_expanded`、降级事件 |
| 验证 | 与 design-upgrade §9 逐条对照表 |

### WP-I1 — Canonical Source Key + source map（1–1.5 天）

| 文件 | 改动 |
|---|---|
| `acl.ts` | 正向键 `(connectionId, sourceName)`；反向键 `(connectionId, physicalTable)`；同 connection 重名 → 编译失败 |
| 测试 | U-KEY-01/02/03 |
| 验证 | `cd webui && npm test -- canonical-source-key`（或并入现有 acl 测） |

### WP-I2 — Tool Class + AbsoluteDeny 基线（1 天）

| 文件 | 改动 |
|---|---|
| `mcp-proxy.ts` / `acl.ts` | 硬编码 AbsoluteDeny 集（含 `sl_query`/`sl_read_source`/…）；分类表；未分类 → deny；list/call 双拒 |
| 测试 | U-CLS-01/02/03、U-DENY-01、AC-SEC-SL/CLS |
| 验证 | 临时从 YAML 去掉 `sl_*` deny 仍拒绝调用 |

### WP-I3 — Capability 合成与闸门（1.5–2 天）

| 文件 | 改动 |
|---|---|
| `acl.ts` | `roles[]` 解析；`RoleCapabilities` / `EffectiveDataCapabilities` / Meta 并集；connections 派生校验 |
| `mcp-proxy.ts` | `authorizeAndRewrite`：按 `(tool, sourceKey)` 检查；catalog 按 capability 过滤 |
| 测试 | U-CAP-01..04、S2/S2b、U-COMPAT-01 |
| 验证 | Fixture：finance_bp + public_reader 无笛卡尔 |

### WP-I4 — `permission_model_version` + 迁移（1 天）

| 文件 | 改动 |
|---|---|
| schema / lint | Role 字段白名单；v2 禁 prefix/scoped；缺版本稳态 fail |
| Admin | 编辑 v1 → 升 v2、补 `row_access: all`、prefix 展开为 names；dryRun diff |
| 迁移 | 一次性批处理：存量 Role 写 `permission_model_version: 1` |
| 测试 | U-VER-01..04、S3、S6 |
| 验证 | `npm run lint:spec` |

### WP-I5 — EffectivePolicy 编译与提交语义（1.5–2 天）

| 文件 | 改动 |
|---|---|
| `acl.ts` + identity/proxy | 编译输入含 access digest + sourceMapVersion；原子替换；热路径只读 |
| Admin save | 先编译 → 写盘 → 切 runtime → 失败回滚；返回 `policyVersion`+`runtimeAck` |
| 外部 YAML | 编译失败 → 定位 Agent deny / 整体 DataPlane deny；banner + 日志 |
| source map 变化 | 触发重编译；v1 prefix 扩权记 `policy_scope_expanded` |
| 测试 | U-REL-01..04、S7、S10、S12 |
| 验证 | 手工：保存坏配置不落盘；收窄成功立即生效 |

### WP-I6 — 审计 / 类型 / Admin UI 最小面（1 天）

| 文件 | 改动 |
|---|---|
| `audit.ts`、types | snapshot / access_log 字段 |
| Agent/Role 详情 | capability 列表预览；降级 banner |
| 验证 | 一次 allow/deny 可在审计中看到 policyVersion 与 capability digest |

### WP-I7 — Security Eval + UAT + Runbook（1 天）

| 产出 | 内容 |
|---|---|
| Eval cases | AC-SEC-SL / CLS / CAP / KEY / SCOPE |
| UAT | `docs/access-control/uat-ac-p0.md`（从 design §5 勾选） |
| Runbook | 降级恢复两条路径 |
| 验证 | Eval 全绿；UAT 关键路径人工勾选 |

---

## 4. 建议排期（日历示意）

```text
Day 0     Gate A（ADR 批准）
Day 1–2   WP-S0 + WP-S1 → Spec 评审 → Gate B
Day 3–4   WP-I1 + WP-I2（可并行）
Day 5–6   WP-I3
Day 7     WP-I4
Day 8–9   WP-I5
Day 10    WP-I6 + WP-I7
Day 11    门禁复跑 / 文档收尾 / Gate C
```

合计约 **8–11 个有效人日**（含 Spec）；不含 AC-P1。

---

## 5. 实现顺序依赖

```text
WP-S0/S1 ──Gate B──▶ WP-I1 ──▶ WP-I3 ──▶ WP-I5 ──▶ WP-I6/I7
                       WP-I2 ──┘         ▲
                       WP-I4 ────────────┘
```

- I1（key）与 I2（分级）可并行，均先于 I3。  
- I4（版本）可与 I3 尾部并行，但须在 I5 前合入（编译规则依赖版本）。  
- I5 依赖 I1–I4。  

---

## 6. 测试与发版门禁（摘录）

### 6.1 本地最小命令

```bash
cd webui
npm test -- acl capability canonical tool-classification mcp-proxy-acl admin-agents admin-roles
npm run lint:spec
./node_modules/.bin/tsc --noEmit
```

（具体 test 文件名以实现时创建的为准；须覆盖 design-upgrade §6.2 全部 U-\*。）

### 6.2 Gate C 检查表

- [ ] SC-01 … SC-10 全部有证据（测试输出或 UAT 勾选）
- [ ] U-COMPAT-01 绿
- [ ] AC-SEC-SL/CLS/CAP/KEY/SCOPE 绿
- [ ] 降级 banner + Runbook 已合并
- [ ] Release notes **未**声称 Dynamic RLS / 行级 scoped 已交付
- [ ] `docs/access-control/README.md` 状态更新为「AC-P0 已交付」

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 整体 DataPlane deny 误伤现网 | Spec 评估影响面；优先保证 Admin 路径不进该态；Runbook 明确回滚 |
| `prefix` 展开后 names 过长 | dryRun 展示完整列表；超阈值告警但仍允许 |
| 同进程写盘+切 runtime 竞态 | 单写锁；切换用原子引用替换 |
| 分类表与上游新增工具漂移 | lint：known_tools ⊆ 分类表；未分类 AbsoluteDeny |
| Spec 与 ADR 漂移 | Gate B 对照表强制评审 |

---

## 8. 审核清单（本 WO）

- [ ] 确认以 `design-upgrade.md` v1.1.2 为唯一设计事实源
- [ ] **Gate A**：批准 ADR → 允许 WP-S\*
- [ ] **Gate B**：批准 AC-P0 Spec → 允许 WP-I\*
- [ ] 确认 AC-P1 / scoped / 强制谓词 **不在**本 WO 范围
- [ ] 确认默认不做浏览器 E2E

### 关闭路径

1. 勾选 Gate A → 执行 WP-S0/S1。  
2. Spec 评审通过并勾选 Gate B → 按 §3/§5 实施 WP-I\*。  
3. Gate C 全绿 → 更新域 README 状态；AC-P1 另立 WO。  

— 完
