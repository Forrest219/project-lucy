# 单机部署落地执行计划（Phase 0–4）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 单机部署落地执行计划（Phase 0–4） |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent（code） |
| 委托人 | xingchen |
| 基于材料 | commit `1dbe20f`；`checklist-single-deploy-phase0-1.md` / `phase2.md` / `phase3-4.md`；`uat-ac-p1.md` BY-01；`scripts/ac-p15-uat-runbook.mjs` |
| 适用范围 | 将三份 Checklist **按序执行**并产出可审计测试报告；**不**在本计划内 merge `main` |
| 输出位置 | `docs/access-control/plans/20260809-single-deploy-landing-plan.md` |

> **状态：** 2026-08-09 已按确认串行执行 Phase 0→4（门禁材料 only，未 merge）。总报告：`inbox/20260809-single-deploy-summary.md`。

---

## 1. 目标与成功标准

| 目标 | 可验证标准 |
|---|---|
| Phase 0 边界冻结 | Checklist §1 勾选 + 签字表填写 |
| Phase 1 proven-off 可复现 | Compose 健康；`proven=false`；fixture → MCP unproven；证据包完整 |
| Phase 2 配置闭环 | 路径 B1：Admin dryRun→保存；FinalRows≠TRUE；仍 unproven |
| Phase 3 置真抽检 + 回滚 | P3-00…P3-07 全绿；演练结束 proven 恢复 false |
| Phase 4 门禁材料就绪 | Allow/Deny 清单核对；**不**自动 merge；等用户真实测试 + 签字 |
| 审计报告 | 每阶段一份报告 + 总报告；含用例、方式、证据路径、结论 |

**硬底线（贯穿）：**

1. 默认栈 **不得** `proven=true`；置真仅用专用 overlay，演练后对称回滚。  
2. Phase 1/2/3 签字 **≠** merge `main`；merge 须 Phase 4 三件套。  
3. 不声称 TokenScope / Dynamic RLS / 多租户已交付。  
4. 证据落 `inbox/`；token / Bearer → `[REDACTED]`。

---

## 2. 路径决策（默认假设）

| 项 | 决策 | 理由 |
|---|---|---|
| Compose 路径 | **Phase 2 路径 B**（接续 Phase 1 demo 栈） | 无客户生产 `access.yaml`；与现有 demo / Cursor Lucy MCP 同构 |
| 配置子路径 | **B1：Agent Constraints**（不建 v2 Role） | 避免 PATCH `demo_readonly`(v1)；与 Phase 1 fixture 同构，Phase 3 配置连续简单 |
| Project 名 | `lucy-single-deploy-p1`（P2/P3 **复用同一 project**） | Checklist 要求配置事实源连续 |
| 宿主端口 | WebUI `55176` / MCP `57881` / MySQL `53306`（冲突再 env 覆盖） | 与 checklist 推荐一致 |
| Cursor MCP | 阶段性切换到本栈 MCP（`http://127.0.0.1:57881/mcp`）+ 短生命周期 Bearer | 完成「用户真实测试」中的 MCP 端验收 |
| 分支 | `feature/access-control-upgrade` | Checklist：变更优先落 feature 分支 |

**若改为路径 A（customer-config）：** 须先提供/准备 `customer-config/`，并重写 §4–§6 中的 Compose baseline；本计划默认不走 A。

---

## 3. 证据与报告布局

```
inbox/20260809-single-deploy-p1/     # Phase 0/1
  00-compose-identity.env
  api/…                              # health / fixture / MCP（脱敏）
  report-phase0-1.md                 # 本阶段审计报告

inbox/20260809-single-deploy-p2/     # Phase 2
  00-compose-identity.env            # 与 P1 同值或符号链接/复制
  api/…
  report-phase2.md

inbox/20260809-single-deploy-p3/     # Phase 3
  00-compose-identity.env            # 复制自 P2
  api/…
  report-phase3.md

inbox/20260809-single-deploy-summary.md   # 总报告（用例矩阵 + 结论 + 签字引用）
```

每份阶段报告最少章节：

1. 环境身份（`COMPOSE_*` / `WEBUI` / `MCP` / proven）  
2. 测试用例表（ID / 步骤 / 期望 / 实际 / 证据路径 / Pass|Fail）  
3. 测试方式（Docker / curl / WebUI / Cursor Lucy MCP）  
4. 回滚与清理记录  
5. 签字建议（通过 / 阻塞项）

---

## 4. 执行阶段与验证

### Step 0 — Phase 0 边界冻结 → 勾选清单 + 签字行

| 动作 | 验证 |
|---|---|
| 书面确认范围 / Non-Goals / 回滚表 / 证据目录约定 | Checklist Phase 0 §1.1–1.3 全勾 |
| 落盘 `inbox/…-p1/00-compose-identity.env` 草稿字段 | 文件存在且含四必填字段 |

**不启栈也可完成 Step 0；建议与 Step 1 同窗口签字。**

---

### Step 1 — Phase 1 proven-off 冷启动 → `/api/health` + unproven fixture

```bash
export LUCY_DEMO_WEBUI_HOST_PORT=55176
export LUCY_DEMO_PROXY_HOST_PORT=57881
export LUCY_DEMO_MYSQL_HOST_PORT=53306

docker compose \
  -f docker-compose.demo.yml \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p lucy-single-deploy-p1 \
  up -d --build
```

| 用例 ID | 方式 | 期望 |
|---|---|---|
| P1-H01 | `docker compose … ps` + `printenv …PROVEN` | demo-db healthy；proven=`false` |
| P1-H02 | `curl $WEBUI/api/health` | `status=ok`；`policy.healthy=true`；`degradedGlobal=false` |
| P1-A01 | 浏览器 Admin Agents/Roles | 可打开；无「行级取数已生效」虚假文案 |
| P1-F01 | curl fixture（Checklist §2.5.2）或裁剪 `ac-p15-uat-runbook.mjs` | Agent+constraints → FinalRows≠TRUE；`runtimeAck` |
| P1-M01 | MCP `initialize` | HTTP 2xx + 可解析 result |
| P1-M02 | MCP `lucy_query` | 正文含 `row_policy_upstream_unproven` |
| P1-C01 | revoke + 删临时 Agent | cleanup JSON 落盘 |

→ 产出 `report-phase0-1.md`；**Phase 1 签字仅授权进入 Phase 2**。

---

### Step 2 — Phase 2（路径 B1）Admin 闭环 → 保留配置对象

| 动作 | 验证 |
|---|---|
| `source` 同一 `00-compose-identity.env`；proven 仍 false | health 指向本栈 |
| WebUI：新建/保留 Agent，挂 `demo_readonly`，配置 Constraints（`region eq East`） | dryRun 见 digest/protected；保存 `runtimeAck===true` |
| **可选抽检 B2**：新建 v2 Role + scoped（不 PATCH `demo_readonly`） | 合法保存；非法/v1+scoped 拒绝 |
| 短 token → bump note → MCP initialize + `lucy_query` | 仍为 `row_policy_upstream_unproven` |
| **保留** Agent（及可选 Role）至 Phase 3；revoke 仅测完用 token | 对象仍在 runtime |

→ 产出 `report-phase2.md`；签字仅 → Phase 3。

---

### Step 3 — Phase 3 proven 置真抽检 → 对称回滚

```bash
source inbox/20260809-single-deploy-p2/00-compose-identity.env
# baseline 不变；仅 proven-off → proven=true
docker compose "${COMPOSE_BASELINE[@]}" -f docker-compose.ac-p1-by01.yml \
  -p "$COMPOSE_PROJECT" up -d --build
```

| 用例 ID | 方式 | 期望 |
|---|---|---|
| P3-00 | GET Agent / dryRun | FinalRows≠TRUE 与 P2 一致 |
| P3-01 | `printenv` | `true` |
| P3-02 | Cursor Lucy MCP 或 curl `lucy_query` | **允许取数**；可见 `forced_filters` / `filters[]` 前缀 |
| P3-03 | 行集抽检（BY-01） | 结果行 ⊆ `region=East`；无域外行 |
| P3-04 | Constraints 相对 Role 不放宽 | digest + 查询对比 |
| P3-05 | 未包装工具（如 `lucy_read_source`） | `row_policy_requires_wrapped_tool` |
| P3-06 | 伪造/放宽 filter | 强制前缀仍在；域不放宽 |
| P3-07 | 对称回滚 proven-off 后同查询 | `row_policy_upstream_unproven` |

**Cursor Lucy MCP 操作要点：**

1. MCP URL → `$MCP`（默认 `http://127.0.0.1:57881/mcp`）。  
2. Bearer = Phase 3 专用短 token（证据脱敏）。  
3. 先 `lucy_catalog` / 可见源确认，再 `lucy_query`（measures 用 source-qualified key）。  
4. 抽检结束后 revoke token；路径 B 临时对象按 Checklist 清理策略处理。  
5. 测完后把 Cursor MCP 指回日常配置（避免残留 proven 栈 token）。

回滚：

```bash
docker compose "${COMPOSE_BASELINE[@]}" -f docker-compose.ac-p1-by01-proven-off.yml \
  -p "$COMPOSE_PROJECT" up -d --force-recreate --no-deps lucy
```

→ 产出 `report-phase3.md`。

---

### Step 4 — Phase 4 门禁材料（不自动 merge）

| 动作 | 验证 |
|---|---|
| 汇总用户真实测试（WebUI + Cursor MCP）证据路径 | 写入总报告 |
| 对照 Allow/Deny 清单审阅拟合入 diff（若有） | 无默认 `proven=true`；无生产 secret |
| 建议 PR 拆分 A/B/C（文档 / 代码 / example） | 总报告给出推荐；**开 draft 可选** |
| **不**执行 merge | 等待 xingchen 真实测试确认 + P3/P4 签字 |

→ 产出 `inbox/20260809-single-deploy-summary.md`。

---

## 5. 测试用例总矩阵（审计用）

| ID | 阶段 | 测试方式 | 期望摘要 |
|---|---|---|---|
| P0-01 | 0 | 文档勾选 | 范围/回滚/禁令确认 |
| P1-H01…H02 | 1 | Docker + curl | proven-off + policy 健康 |
| P1-A01 | 1 | WebUI | Admin 可开；无虚假生效文案 |
| P1-F01 | 1 | curl/API | fixture FinalRows≠TRUE |
| P1-M01…M02 | 1 | curl MCP | initialize + unproven |
| P1-C01 | 1 | curl/API | cleanup |
| P2-A01 | 2 | WebUI | dryRun→runtimeAck |
| P2-M01 | 2 | curl/Cursor MCP | 仍 unproven |
| P3-00…P3-07 | 3 | Docker + WebUI + Cursor MCP | 置真取数 ⊆ 域 + 回滚 unproven |
| P4-01 | 4 | 文档/diff 审阅 | 门禁材料齐；不 merge |

自动化辅助：`ACP15_WEBUI_BASE` / `ACP15_MCP_BASE` + `node scripts/ac-p15-uat-runbook.mjs`（证据复制到阶段目录，勿覆盖）。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 端口冲突冲掉日常 demo | 固定 `-p lucy-single-deploy-p1`；必要时改 `LUCY_DEMO_*_HOST_PORT` |
| 误开 proven 残留 | P3 结束强制 P3-07；`printenv` 复核 false |
| Cursor MCP 仍连旧 endpoint | 每阶段报告记录实际 MCP URL；测后恢复日常配置 |
| 无 fixture 却判 unproven 通过 | 强制 FinalRows≠TRUE 前置（P1-F01 / P3-00） |
| 把 Phase 签字当成可 merge | 总报告醒目标注；本计划 Step 4 禁止自动 merge |

---

## 7. 工作节奏与检查点

| 检查点 | 谁确认 | 通过后才做 |
|---|---|---|
| **CP0** 本计划默认路径 B1 / 端口 / 报告布局 | xingchen | Step 0–1 |
| **CP1** Phase 0/1 报告 + 签字 | xingchen | Step 2 |
| **CP2** Phase 2 报告 + 签字 | xingchen | Step 3 |
| **CP3** Phase 3 报告 + 回滚确认 | xingchen **已通过 2026-08-09** | Step 4 材料整理 |
| **CP4** 用户真实测试 + Phase 4 签字 | xingchen **门禁通过 2026-08-09**；**merge 暂缓**（待亲自完成 Cursor Agent SSE 手测） | draft/merge 另议；本计划仍不自动 merge |

---

## 8. 本次 code 角色交付物清单

- [ ] `inbox/20260809-single-deploy-p{1,2,3}/` 证据包  
- [ ] 三份阶段报告 + 一份总报告  
- [ ] Checklist 勾选/签字表更新建议（或直接填「执行人/日期/证据」行，**用户总签栏留给 xingchen**）  
- [ ] （可选）draft PR 描述草稿——仅当 CP3 通过且用户要求

**明确不做：** TokenScope / Dynamic RLS；改默认 compose 为 proven=true；把客户生产 ACL 写入仓库默认；未签字 merge `main`。

---

## 9. 请确认后开工

请 xingchen 确认或修正：

1. **路径 B1（demo + Agent Constraints）** 是否接受？若要路径 A，请给出 `customer-config` 位置。  
2. 端口 `55176` / `57881` / `53306` 是否可用？  
3. Cursor Lucy MCP 是否允许在 Phase 3 窗口切换到本栈 Bearer？  
4. 证据日期目录用 `20260809` 还是开工日实际日期？  
5. Phase 4 是否只整理门禁材料（推荐），还是同时开 draft PR？

确认后按 **Step 0 → 1 → CP1 → 2 → CP2 → 3 → CP3 → 4** 执行。

— 完
