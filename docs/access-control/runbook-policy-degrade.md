# Runbook：AC-P0 策略降级恢复

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P0 策略降级恢复 Runbook |
| 文档类型 | Checklist |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 98 §8.3–§8.5；WO WP-I7；`inbox/20260809-gate-c-uat/` |
| 适用范围 | Gate C 前运维演练与生产恢复 |
| 输出位置 | `docs/access-control/runbook-policy-degrade.md` |

## 症状

- Admin 顶部出现「策略运行时降级」banner（`data-testid=policy-degrade-banner`）
- `/api/health` 返回 `status: "degraded"`（进程仍可服务）
- DataPlane 工具返回 `policy_degraded_deny` 或 `role_resolution_failed:*`
- `/api/admin/policy-runtime`：`degradedGlobal=true` 或 `degradedAgents` 非空

## 路径 A — Admin 修复后保存（首选）

1. 打开 Admin → 配置审计，筛选 `policy_degraded_enter` / `policy_scope_expanded`
2. 打开 Role / Agent 详情，按错误原因修复（非法 v2 `prefix`/`scoped`、双写 `role`+`roles`、坏 YAML）
3. **dryRun** 确认迁移/展开结果
4. **保存**；Toast 须显示 `runtimeAck` 成功语义与 `policyVersion` 前缀
5. 确认 banner 消失；`GET /api/admin/policy-runtime` → `healthy: true`
6. 用受影响 Token 抽测：`lucy_query` allow；`sl_query` 仍 AbsoluteDeny

## 路径 B — 运维回滚 access.yaml

1. 从备份或 Git 取上一份**已验证可编译**的 `webui/config/access.yaml`
2. 覆盖写盘（保留文件权限）
3. 触发重编译：Admin 任意无害 dryRun+save，或重启 WebUI/Proxy 同进程
4. 确认 `policyVersion` 变化且 `degradedGlobal=false`
5. 记录变更：谁在何时回滚、原坏文件 digest、新 `policyVersion`

## 禁止

- 在「意图收窄但编译失败」时继续以更宽旧权对外表现为健康
- 声称已交付 Dynamic RLS / scoped 行级隔离（AC-P1，未授权）

## 演练签字（Gate C）

| 项 | 执行人 | 日期 | 结果 |
|---|---|---|---|
| 路径 A 演练 | Cursor Agent（执行）/ xingchen（批准） | 2026-08-09 | **PASS** — per-agent degrade（非法 v2+prefix）+ banner；回写已验证 YAML 后 `healthy=true`；`lucy_query` allow / `sl_query` AbsoluteDeny。证据：`inbox/20260809-gate-c-uat/07-*`、`screenshots/18-path-a-banner.png` |
| 路径 B 演练 | Cursor Agent（执行）/ xingchen（批准） | 2026-08-09 | **PASS** — 不可解析 YAML → `degradedGlobal=true` + banner；回滚后恢复。证据：`inbox/20260809-gate-c-uat/08-*`、`screenshots/19-path-b-banner.png`；坏前 sha256 `e0dfebf5892233d2…` |
| banner + health 探针核对 | Cursor Agent（执行）/ xingchen（批准） | 2026-08-09 | **PASS** — Path A/B 均见 banner；`/api/health` 与 `/api/admin/policy-runtime` 对齐 degraded/healthy |

**演练环境：** `lucy-gate-c-uat`（WebUI `:55176` / MCP `:57881`）。  
**已知差异：** 全局降级期间 MCP 曾返回 HTTP 502（Upstream unavailable），控制面探针与 banner 仍正确。
