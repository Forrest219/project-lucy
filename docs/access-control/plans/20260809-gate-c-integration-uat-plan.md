# Gate C Docker Integration UAT Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Docker/本地集成环境中启动 Lucy WebUI + MCP Proxy + DataPlane，完成 AC-P0 Gate C 的真实环境 UAT 与 Runbook 演练留证。

**Architecture:** 以 `docker-compose.demo.yml` 的持久化 demo 环境作为集成底座，先跑现有 P0 demo smoke 证明 WebUI/KTX/MCP 基线可用，再注入 AC-P0 专用 Role/Agent/Token fixture。数据面通过 MCP JSON-RPC 真实调用，控制面通过 Admin UI/API 真实保存，降级恢复通过实际改坏/回滚 `access.yaml` 验证。

**Tech Stack:** Docker Compose, Lucy WebUI/API, Lucy MCP Proxy, KTX, MySQL demo data, Admin UI, MCP JSON-RPC, `inbox/` evidence files.

---

## 0. 验收口径

本方案定义的「真实测试」必须同时满足：

1. 使用 Docker/本地集成环境，不依赖 Vitest mock。
2. WebUI/API 与 MCP Proxy 同进程或同 compose 环境启动。
3. 使用真实 `webui/config/access.yaml` 写盘、编译、提交 runtime。
4. MCP 工具调用走 `http://127.0.0.1:<proxy-port>/mcp`，带真实 Bearer Token。
5. UI 项必须由浏览器人工确认；API/MCP 项可由脚本确认。
6. 所有证据落在 `inbox/20260809-gate-c-uat/`，签字前不得只口头确认。

工程单测证据继续引用 `docs/access-control/plans/20260809-gate-c-sc-evidence.md`；本方案只补 C1 UAT 与 C2 Runbook 演练。

## 1. 环境边界

推荐使用持久化 compose 项目，避免 `npm run smoke:p0:demo` 结束时 `down -v` 删除环境。

| 项 | 默认值 |
|---|---|
| Compose file | `docker-compose.demo.yml` |
| Compose project | `lucy-gate-c-uat` |
| WebUI/API | `http://127.0.0.1:55176` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` |
| Demo MySQL | `127.0.0.1:53306` |
| Demo token baseline | `lucy-demo-agent-token` |

端口冲突时只改 host port，不改容器内 `5174` / `7879`。

## 2. Fixture 设计

Demo 模板默认只有 `demo_agent` / `demo_readonly`，不足以覆盖 AC-P0 的 Role Set、capability tuple、v1 prefix、Token revoke、降级演练。Gate C UAT 必须准备下列临时 fixture。

### 2.1 Role

| Role | 版本 | 用途 | Data Capability |
|---|---:|---|---|
| `gatec_query_orders` | 2 | Role A：查询订单/退货 | `lucy_query` × `superstore_orders`, `superstore_returns` |
| `gatec_public_reader` | 2 | Role B：整源读公共维表 | `lucy_read_source` × `superstore_people` |
| `gatec_join_orders_people` | 2 | Role C：join 正例 | `lucy_query` × `superstore_orders`, `superstore_people` |
| `gatec_legacy_prefix` | 1 | legacy/prefix 兼容 | `prefix: superstore_`，保存后应展开为 names |
| `gatec_invalid_v2_prefix` | 2 | 负例 | v2 + `prefix`，保存必须失败 |
| `gatec_invalid_v2_scoped` | 2 | 负例 | v2 + `row_access: scoped`，保存必须失败 |

所有 v2 selector 必须显式 `row_access: all`。`defaults.deny_tools` 必须包含 `sl_query` 与 `sl_read_source`。

### 2.2 Agent / Token

| Agent | Role 绑定 | Token |
|---|---|---|
| `wang` | `roles: [gatec_query_orders, gatec_public_reader]` | `T1`, `T2` |
| `legacy_user` | `role: gatec_legacy_prefix` | `legacy-T1` |
| `join_ok_user` | `role: gatec_join_orders_people` | `join-T1` |

Token 明文只允许保存在当前 shell 变量或 `inbox/20260809-gate-c-uat/.tokens.local`。该文件不得提交。

## 3. 证据文件

创建目录：

```bash
mkdir -p inbox/20260809-gate-c-uat
```

建议文件：

| 文件 | 内容 |
|---|---|
| `00-compose-up.txt` | compose 启动、容器状态、端口 |
| `01-health-policy-runtime.json` | `/api/health` 与 `/api/admin/policy-runtime` 初始状态 |
| `02-fixture-setup.md` | Role/Agent/Token 创建方式、policyVersion |
| `03-mcp-positive-negative.jsonl` | MCP allow/deny 调用结果 |
| `04-token-revoke.json` | T1 revoke 后 T1/T2 对比 |
| `05-admin-ui.md` | 浏览器人工确认项、截图路径 |
| `06-audit.json` | audit 查询：`capability_forbidden`、policyVersion、digest |
| `07-runbook-path-a.md` | Admin 修复路径演练记录 |
| `08-runbook-path-b.md` | access.yaml 回滚路径演练记录 |
| `09-uat-signoff.md` | 对 `uat-ac-p0.md` 勾选建议与签字人 |

## 4. 执行任务

### Task 1: 启动持久化 Docker 集成环境

**Files:**
- Read: `docker-compose.demo.yml`
- Read: `scripts/rebuild-demo-lucy.sh`
- Evidence: `inbox/20260809-gate-c-uat/00-compose-up.txt`

**Steps:**

1. 可选基线烟测：
   ```bash
   npm run smoke:p0:demo
   ```
   Expected: `[p0-demo-smoke] PASS`。

2. 启动持久化 UAT 环境：
   ```bash
   LUCY_DEMO_WEBUI_HOST_PORT=55176 \
   LUCY_DEMO_PROXY_HOST_PORT=57881 \
   LUCY_DEMO_MYSQL_HOST_PORT=53306 \
   docker compose -f docker-compose.demo.yml -p lucy-gate-c-uat up -d --build
   ```

3. 记录容器：
   ```bash
   docker compose -f docker-compose.demo.yml -p lucy-gate-c-uat ps
   ```

4. 验证 WebUI/API：
   ```bash
   curl -sS http://127.0.0.1:55176/api/health
   curl -sS http://127.0.0.1:55176/api/admin/policy-runtime
   ```

**Pass criteria:**
- WebUI/API 可访问。
- `/api/health` 可返回健康或可解释的 degraded；若 degraded，必须进入 Runbook 演练而不是跳过。
- `/api/admin/policy-runtime` 返回 `policyVersion` 与 runtime 状态。

### Task 2: 准备 AC-P0 UAT fixture

**Files:**
- Modify in container/runtime only: `/data/lucy/webui/config/access.yaml`
- Evidence: `inbox/20260809-gate-c-uat/02-fixture-setup.md`

**Steps:**

1. 在 Admin UI 或 Admin API 创建 §2 的 Role。
2. 新建 `wang`、`legacy_user`、`join_ok_user`。
3. 为 `wang` 创建两个 token，记为 T1/T2。
4. 保存后记录：
   - `policyVersion`
   - `runtimeAck`
   - capability preview 截图
   - `access.yaml` 片段或 hash

**Pass criteria:**
- Role A/B/C 与 Agent 在 Admin 可见。
- `wang` 的 effective permissions 显示 capability tuple，而不是只显示工具并集 + 源并集。
- `sl_query` / `sl_read_source` 仍在 AbsoluteDeny 基线内。

### Task 3: MCP DataPlane 主链路验证

**Files:**
- Evidence: `inbox/20260809-gate-c-uat/03-mcp-positive-negative.jsonl`

**Steps:**

1. 使用 T1 初始化 MCP session。
2. 调 `tools/list`。
3. 调 `lucy_catalog`，记录源集合与 `policyVersion`。
4. 调 `lucy_query` × `superstore_orders`，预期 allow。
5. 调 `lucy_read_source` × `superstore_orders`，预期 deny `capability_forbidden`。
6. 调 `lucy_read_source` × `superstore_people`，预期 allow。
7. 调 `lucy_query` join `superstore_orders` + `superstore_people`：
   - 用 `join_ok_user` 预期 allow。
   - 用 `wang` 预期 deny，因为 `wang` 缺 `lucy_query` × `superstore_people`。
8. 调 `sl_query` / `sl_read_source`，预期 deny `tool_absolute_deny:*`。

**Pass criteria:**
- allow 调用真实返回数据或 schema 内容。
- deny 调用返回明确 reason，且不返回受保护数据。
- `lucy_catalog` 对 T1/T2 返回同一源集合与同一 `policyVersion`。

### Task 4: Token revoke 验证

**Files:**
- Evidence: `inbox/20260809-gate-c-uat/04-token-revoke.json`

**Steps:**

1. T1/T2 分别调用 `lucy_catalog`，预期均成功。
2. 在 Admin UI/API revoke T1。
3. T1 再调 `lucy_catalog`，预期 HTTP 401 或 MCP auth 拒绝。
4. T2 再调 `lucy_catalog`，预期仍成功，源集合与当前 `policyVersion` 一致。

**Pass criteria:**
- revoke 只影响 T1。
- T2 不受影响。
- Audit 中可看到 token revoke 与后续拒绝/成功记录。

### Task 5: Admin UI 人工验收

**Files:**
- Evidence: `inbox/20260809-gate-c-uat/05-admin-ui.md`
- Target checklist: `docs/access-control/uat-ac-p0.md`

**Steps:**

1. 浏览器打开 `http://127.0.0.1:55176/admin/agents/wang`。
2. 确认 Capability Preview 展示 tool × source tuple。
3. 对 Role 做一次合法保存，确认 Toast 含 `policyVersion` 与 `runtimeAck` 成功语义。
4. 对坏 Role 保存，确认错误 Toast，且不导航、不清 diff/确认态。
5. 打开 Audit，筛选 `capability_forbidden`。
6. 确认 audit 行可见 `policyVersion` 与 capability digest。

**Pass criteria:**
- UI 可见行为全部通过后，才允许勾选 `uat-ac-p0.md` 的 Admin Preview、Toast、Audit、banner 相关项。

### Task 6: Runbook 路径 A 演练

**Files:**
- Target runbook: `docs/access-control/runbook-policy-degrade.md`
- Evidence: `inbox/20260809-gate-c-uat/07-runbook-path-a.md`

**Steps:**

1. 先备份当前已验证的 `/data/lucy/webui/config/access.yaml`。
2. 从容器 shell 外部写入一个**合法 YAML 但策略非法**的 Role，例如 v2 role 带 `prefix` 或 `row_access: scoped`。不要通过 Admin 保存制造这个状态，因为 Admin 正常会拦截并保持 runtime 健康。
3. 触发重编译或重启 WebUI/Proxy 同进程，使 runtime 进入 degraded。
4. 确认 `/api/health` 为 degraded、Admin banner 出现、DataPlane fail-closed。
5. 打开 Admin Role/Agent 详情，按错误原因修复非法配置。
6. dryRun 确认。
7. 保存，确认 Toast runtimeAck 成功、`policyVersion` 变化。
8. 复查 banner 消失、`healthy: true`。
9. 用受影响 token 抽测 `lucy_query` allow、`sl_query` deny。

**Pass criteria:**
- Path A 全链路可恢复。
- 记录执行人、时间、坏配置摘要、恢复后的 `policyVersion`。

### Task 7: Runbook 路径 B 演练

**Files:**
- Target runbook: `docs/access-control/runbook-policy-degrade.md`
- Evidence: `inbox/20260809-gate-c-uat/08-runbook-path-b.md`

**Steps:**

1. 备份当前已验证的 `/data/lucy/webui/config/access.yaml`。
2. 在容器内写入坏 YAML 或坏 AC 配置。
3. 触发重编译或重启 WebUI/Proxy 同进程。
4. 确认 `/api/health` 为 degraded，Admin banner 出现，DataPlane fail-closed。
5. 回滚备份文件。
6. 触发重编译或重启。
7. 确认 `policyVersion` 变化、`degradedGlobal=false`、MCP allow/deny 恢复。

**Pass criteria:**
- Path B 全链路可恢复。
- 记录坏文件 digest、新 `policyVersion`、执行人、时间。

### Task 8: 更新 UAT 勾选与 Runbook 签字意见

**Files:**
- Modify after human confirmation: `docs/access-control/uat-ac-p0.md`
- Modify after drill: `docs/access-control/runbook-policy-degrade.md`
- Evidence: `inbox/20260809-gate-c-uat/09-uat-signoff.md`

**Steps:**

1. 将自动化已覆盖、Docker 集成已验证、人工 UI 已确认三类证据逐项映射到 `uat-ac-p0.md`。
2. 只勾已经有证据的项；不能用单测替代 UI 可见行为。
3. Runbook 表格只由实际执行人签。
4. 若 A3 `tsc` 继续豁免，在签字说明中保留“Gate C 含 tsc 豁免”。
5. 全部签完后，再更新 `docs/access-control/README.md` 为「AC-P0 已交付」。

**Pass criteria:**
- `uat-ac-p0.md` 所有勾选项均能指向证据文件或截图。
- `runbook-policy-degrade.md` 路径 A、路径 B、banner + health 探针都有执行人/日期/结果。
- Gate C 结论不再混用“工程证据齐”和“真实环境已验收”。

## 5. UAT 勾选判定表

| `uat-ac-p0.md` 项 | 判定来源 |
|---|---|
| Fixture | Task 2 |
| S1 多 Token 同权 / revoke | Task 3 + Task 4 |
| S2 / S2b Capability | Task 3 + Task 5 |
| S3 版本 / prefix | Task 2 + Task 6 |
| S5 工具分级 | Task 3 |
| S6 Legacy | Task 2 + Task 5 |
| S7 / S10 编译提交 | Task 5 + Task 6 + Task 7 |
| S8 Canonical key / Audit | 既有 SC 证据 + Task 5 |
| S11 / S12 | 若 demo 无 VIEW/新增源 fixture，需在本地非 demo 集成环境补测或标注未覆盖 |
| I6 可观测 | Task 5 + Task 6 |
| I7 门禁材料 | 既有 A4 证据 + Task 6 + Task 7 |

## 6. 风险与处理

| 风险 | 处理 |
|---|---|
| demo 模板不含 `lucy_*` fixture | 必须先完成 Task 2，不能直接拿 smoke 当 UAT |
| `npm run smoke:p0:demo` 会 `down -v` | 只作为可选基线；正式 UAT 用持久化 compose |
| UI 项无法由 curl 证明 | 必须浏览器确认并截图 |
| 外部数据源是 demo/stub | 签字时标注“AC 控制面真实，数据源为 demo fixture” |
| `tsc --noEmit` 仍失败 | 作为 Gate C 豁免随签字保留；若不接受豁免，另开 TS 债清理 WO |
| Runbook 只读过未演练 | 不允许签；必须实际制造 degraded 并恢复 |

## 7. 最终交付物

1. `inbox/20260809-gate-c-uat/` 下完整证据。
2. 已勾选的 `docs/access-control/uat-ac-p0.md`。
3. 已签字的 `docs/access-control/runbook-policy-degrade.md`。
4. 若全部通过，更新 `docs/access-control/README.md` 的 Gate C/AC-P0 状态。

— 完
