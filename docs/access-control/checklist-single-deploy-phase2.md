# 单机部署落地 — Phase 2 真实配置落地清单

| 元数据 | 内容 |
|---|---|
| 文档名称 | 单机部署落地 Phase 2 真实配置清单 |
| 文档类型 | Checklist |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) §2.2 P3；[`checklist-single-deploy-phase0-1.md`](checklist-single-deploy-phase0-1.md)；[`checklist-single-deploy-phase3-4.md`](checklist-single-deploy-phase3-4.md)；[`docs/admin-guide.md`](../admin-guide.md)；Spec 99 / Spec 100；`customer-config.example/` |
| 适用范围 | Phase 1 之后、Phase 3 proven 置真之前：在 **proven=false** 下落地真实（或近似真实）Role `scoped` / Agent `constraints`，并登记供 Phase 3 复用的 Compose 身份 |
| 输出位置 | `docs/access-control/checklist-single-deploy-phase2.md` |

> **底线：** Phase 2 **不** merge `main`；**不**打开 proven。  
> 配置落在 **独立挂载**（`customer-config/`）或隔离 project 的 Admin 运行时，**不**把客户生产事实源写进仓库默认 `webui/config/access.yaml`。  
> Phase 3 **必须**沿用本文登记的同一配置事实源（见 §2）；详见 Phase 3/4 §2.0。

前序：[Phase 0 / Phase 1](checklist-single-deploy-phase0-1.md)（须已签字）。  
后续：[Phase 3 / Phase 4](checklist-single-deploy-phase3-4.md)。

---

## 0. 目标与路径

| 目标 | 说明 |
|---|---|
| 职责包可表达 | 至少一套 Role `row_access: scoped` + `row_policy`，和/或 Agent `constraints`，使目标源 **FinalRows≠TRUE** |
| Admin 闭环 | dryRun → FinalRows 预览 → 保存 `runtimeAck===true` |
| 闸门仍在 | proven=false 下包装 `lucy_query` → `row_policy_upstream_unproven` |
| 身份可交接 | 落盘 `COMPOSE_PROJECT` + `COMPOSE_BASELINE` + `WEBUI` + `MCP`，供 Phase 3 置真/回滚/抽检对称复用 |

| 路径 | 适用 | Compose 倾向 |
|---|---|---|
| **A（推荐）** | 客户向单机 / 真实职责包 | `docker-compose.yml` + `docker-compose.customer-config.yml` + proven-off |
| **B（最小）** | 仍用 Phase 1 demo 栈；**优先 Agent Constraints**；若要 Role scoped 须**新建 v2 Role**（不可 PATCH 升级 `demo_readonly`） | 复用 Phase 1 的 `COMPOSE_*` / `WEBUI` / `MCP`；**不**换新 project 丢数据 |

两条路径 **proven 均为 false**。勾选其一并贯穿 Phase 2→3。

---

## 1. Phase 2 开工门禁

- [ ] Phase 0 / Phase 1 已签字（含 `/api/health` + unproven fixture 或等价证据）
- [ ] 已选路径 **A** 或 **B**
- [ ] 明确：**本阶段结束不 merge main**
- [ ] 证据目录：`inbox/YYYYMMDD-single-deploy-p2/`（token 脱敏）

---

## 2. 登记 Compose 身份（必做，Phase 3 复用）

启动前写入证据包 `00-compose-identity.env`（或等价），**Phase 3 禁止另起丢配置的栈**（除非 Phase 3 走路径 B 重建 fixture）。

**必填字段（缺一不可）：** `COMPOSE_PROJECT`、`COMPOSE_BASELINE`、`WEBUI`、`MCP`。  
Phase 3 应 `source` **同一份**文件，禁止凭记忆改端口。

### 2.1 路径 A 示例

```bash
# inbox/.../00-compose-identity.env 内容示例（bash）
export COMPOSE_PROJECT=lucy-single-deploy-p2
export COMPOSE_BASELINE=(
  -f docker-compose.yml
  -f docker-compose.customer-config.yml
)
# 以 `docker compose … port` / `ps` 核对后填写（示例为常见宿主映射）
export WEBUI="http://127.0.0.1:5174"
export MCP="http://127.0.0.1:7879/mcp"
```

### 2.2 路径 B 示例（接续 Phase 1）

```bash
export COMPOSE_PROJECT=lucy-single-deploy-p1
export COMPOSE_BASELINE=(
  -f docker-compose.demo.yml
)
# 与 Phase 1 的 LUCY_DEMO_*_HOST_PORT 一致
export WEBUI="http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}"
export MCP="http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}/mcp"
```

- [ ] `00-compose-identity.env` 已落盘，含 `COMPOSE_PROJECT` / `COMPOSE_BASELINE` / `WEBUI` / `MCP`
- [ ] `source` 后 `curl -sS "$WEBUI/api/health"` 指向本 Phase 2 栈

---

## 3. 路径 A — customer-config 真实配置

### 3.1 准备配置包

参照 [`docs/admin-guide.md`](../admin-guide.md) §3：

```bash
# 若尚无客户目录：从示例复制（勿把生产 secrets 提交进 git）
cp -R customer-config.example customer-config
# 编辑 customer-config/ktx.yaml、secrets、semantic-layer、wiki、webui/config/access.yaml
```

**访问配置最低内容（相对 example 的增量）：**

| 项 | 要求 |
|---|---|
| Role（若用 scoped） | **必须** `permission_model_version: 2`；至少一个源 `row_access: scoped` + 合法 `row_policy`（`eq`/`in`；行级字段，**禁止** measure）——见 Spec 99。缺省/v1 → `v1_scoped_forbidden` |
| 或 / 且 Agent | `constraints` AND 收紧（Spec 100）；**禁止**在 Role 上写 `constraints` |
| Token | 部署时生成真实 token；example hash **不可**当生产机密 |
| 文案 | Admin / 文档不出现「Constraints 已配置即行级取数已生效」 |

示例 Role 片段（字段名按客户源替换；**勿省略** `permission_model_version`）：

```yaml
# customer-config/webui/config/access.yaml（示意，非生产事实源）
roles:
  dept_east_readonly:
    description: 示例 — 仅 East 区域行域（scoped）
    permission_model_version: 2   # 必填；缺省按 v1，scoped/row_policy 会被拒绝
    allow:
      connections: [customer-db]   # 按实际 connection id
      tableSelectors:
        - connection: customer-db
          schema: analytics
          names: [ceo_metric_snapshot]  # 换成真实表 / 源名
          row_access: scoped
          row_policy:
            predicates:
              - field: region          # 须为可解析行级字段
                op: eq
                value: East
      tools: [sl_query, sl_read_source, wiki_search, wiki_read, connection_list]
```

Agent Constraints 也可在 Admin UI 配置（推荐 dryRun 后再保存），不必先手写进 YAML。

### 3.2 静态门禁 + 冷启动（proven-off）

```bash
source inbox/YYYYMMDD-single-deploy-p2/00-compose-identity.env   # 须含 WEBUI/MCP

npm run smoke:p0:headless-config -- --root customer-config --require-secret-files

docker compose \
  "${COMPOSE_BASELINE[@]}" \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p "$COMPOSE_PROJECT" \
  up -d --build
```

### 3.3 健康检查

```bash
source inbox/YYYYMMDD-single-deploy-p2/00-compose-identity.env
# 使用 identity 中的 WEBUI，勿另写端口

docker compose -p "$COMPOSE_PROJECT" ps
docker compose -p "$COMPOSE_PROJECT" exec lucy \
  printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN
# 期望：false

curl -sS "$WEBUI/api/health" | tee inbox/YYYYMMDD-single-deploy-p2/api/01-health.json
# 期望：data.status=ok；policy.healthy=true；degradedGlobal=false；policyVersion 非空
```

可选（配置包变更后）：

```bash
docker compose "${COMPOSE_BASELINE[@]}" -p "$COMPOSE_PROJECT" exec lucy \
  ktx --project-dir /data/lucy admin reindex --force --output json
```

---

## 4. 路径 B — 接续 Phase 1 demo 栈

适用于：暂不挂 customer-config，但要在同一 demo project 上留下「近似真实」的 scoped/constraints，供 Phase 3 直接置真抽检。

```bash
source inbox/YYYYMMDD-single-deploy-p1/00-compose-identity.env 2>/dev/null || true
# 若 Phase 1 未建 identity 文件，按 §2.2 新建并与正在运行的 project 对齐

docker compose \
  "${COMPOSE_BASELINE[@]}" \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p "$COMPOSE_PROJECT" \
  up -d
# proven 保持 false
```

然后用 **Admin**（非改仓库默认 YAML）。**推荐优先 Agent Constraints**（不依赖 Role v2）。

**重要：** demo 模板 Role（如 `demo_readonly`）缺省无 `permission_model_version` → 按 **v1** 处理；Role **PATCH 只允许** `description` / `allow`，**不能**把既有 v1 Role 升到 v2，也就**不能**在原 Role 上 PATCH 出 `scoped`/`row_policy`（会 `v1_scoped_forbidden`）。

| 子路径 | 做法 |
|---|---|
| **B1（推荐）** | 临时 Agent（或已有 Agent）挂 `demo_readonly`（或其它已有表级 Role），只加 **Agent `constraints`**（同 Phase 1 §2.5.2）→ FinalRows≠TRUE |
| **B2** | **新建**临时 Role，创建时显式 `permission_model_version: 2`，再写 `scoped` + `row_policy`；新建临时 Agent 指向该 Role；**不要** PATCH 升级 `demo_readonly` |

步骤：

1. 按 B1 或 B2 配出 FinalRows≠TRUE  
2. dryRun → 确认 digest / protected → 保存 `runtimeAck===true`  
3. **保留**该 Agent（及 B2 临时 Role）至 Phase 3；不要假设能就地改 v1 Role

路径 B 仍须完成 §5–§6 验收。

---

## 5. Admin 配置闭环（两路径共用）

- [ ] 若用 Role scoped：Role 带 `permission_model_version: 2`（YAML 或**新建** Role）；非法 `row_policy` / measure / **v1+scoped** → 拒绝；合法 → 编译成功  
- [ ] **未**尝试用 PATCH 把既有 v1 Role（如 `demo_readonly`）改成 scoped  
- [ ] Agent Constraints：mixed names / 不可满足 → 400；合法 → dryRun 显示 FinalRows 摘要  
- [ ] **禁止** Role 出现 `constraints`（期望拒绝）  
- [ ] 保存后 `runtimeAck === true` + `policyVersion` 前进  
- [ ] UI 可见「不表示行级取数已生效」类免责声明（Constraints / Row Policy）  
- [ ] 证据：dryRun JSON、保存响应（脱敏）→ `inbox/…-single-deploy-p2/api/`

---

## 6. MCP 验收（proven=false，两路径共用）

```bash
source inbox/YYYYMMDD-single-deploy-p2/00-compose-identity.env   # 使用其中的 WEBUI / MCP
```

在 **已存在 FinalRows≠TRUE** 的 Agent 上：

1. 短生命周期 token → bump Agent note 触发 runtime 重载（见 Phase 1 §2.5.2）  
2. MCP `initialize` 握手成功（对 `$MCP`）  
3. `lucy_query` → **`row_policy_upstream_unproven`**（预期）  
4. 未包装工具（若测）→ `row_policy_requires_wrapped_tool`  
5. revoke token；**路径 A** 可保留 Agent；路径 B 若 Phase 3 连续复用则**保留**配置对象

- [ ] initialize + unproven 证据已落盘（token 脱敏）

自动化参考：

```bash
source inbox/YYYYMMDD-single-deploy-p2/00-compose-identity.env
ACP15_WEBUI_BASE="$WEBUI" ACP15_MCP_BASE="$MCP" \
  node scripts/ac-p15-uat-runbook.mjs
# 注意脚本默认 Agent id / 证据目录；勿覆盖 P2 证据前先改路径或复制结果
```

---

## 7. Phase 2 明确不做

| 禁止项 | 原因 |
|---|---|
| `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true` | 属 Phase 3 |
| scoped Role 不写 `permission_model_version: 2` | 缺省 v1 → `v1_scoped_forbidden` |
| PATCH 升级 `demo_readonly`（v1）为 scoped | PATCH 不能写 `permission_model_version` |
| 改仓库默认 `webui/config/access.yaml` 并准备 merge | 污染 main；客户事实源应在挂载目录 |
| 把 Phase 2 签字当成可 merge | 仅授权进入 Phase 3 |
| Phase 3 换 demo 空 project 却声称抽检本阶段配置 | 见 Phase 3/4 §2.0 |
| TokenScope / Dynamic RLS / 多租户声称 | 路线图冻结 / Non-Claim |

---

## 8. 回滚（配置误操作）

| 场景 | 动作 |
|---|---|
| Role/Constraints 编不过 / degrade | 回滚上一份可编译 `access.yaml`（customer-config 或 Admin 撤销）；见 [`runbook-row-policy.md`](runbook-row-policy.md) 路径 A/C/D |
| 误开 proven | **同一** `COMPOSE_BASELINE` + proven-off recreate `lucy`（对称规则，见 Phase 3/4 §2.5） |
| 放弃本环境 | `docker compose "${COMPOSE_BASELINE[@]}" -f docker-compose.ac-p1-by01-proven-off.yml -p "$COMPOSE_PROJECT" down`（`-v` 慎用） |

---

## 9. Phase 2 签字

| 项 | 签名 | 日期 | 证据 |
|---|---|---|---|
| 路径 A 或 B + identity（含 WEBUI/MCP） | 待确认 | | `00-compose-identity.env` |
| `/api/health`（经 `$WEBUI`） | 待确认 | | |
| Admin dryRun / `runtimeAck`（v2 Role 或 Constraints） | 待确认 | | |
| MCP unproven（经 `$MCP`） | 待确认 | | |
| **Phase 2 批准 → 仅授权进入 Phase 3** | 待确认 | | **不授权** merge `main` |

---

## 10. 下一步

Phase 2 签字后进入 [`checklist-single-deploy-phase3-4.md`](checklist-single-deploy-phase3-4.md)：

1. `source` **同一份** `00-compose-identity.env`（含 WEBUI/MCP）  
2. **同一** `COMPOSE_PROJECT` / `COMPOSE_BASELINE` 上叠加 proven=true overlay  
3. 行集抽检后**对称**回滚 proven-off  
4. Phase 4：用户真实测试 + 门禁签字后方可 merge（draft PR 可早开）

— 完
