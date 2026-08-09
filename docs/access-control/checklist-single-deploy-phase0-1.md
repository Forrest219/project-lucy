# 单机部署落地 — Phase 0 Checklist + Phase 1 proven-off 命令清单

| 元数据 | 内容 |
|---|---|
| 文档名称 | 单机部署落地 Phase 0 / Phase 1 清单 |
| 文档类型 | Checklist |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) §2.2 P1–P3；[`runbook-row-policy.md`](runbook-row-policy.md) proven 置真检查单；`docker-compose.demo.yml` / `docker-compose.ac-p1-by01-proven-off.yml`；demo 模板 `examples/docker-demo/project-template/webui/config/access.yaml`；`scripts/ac-p15-uat-runbook.mjs` fixture 流程 |
| 适用范围 | AC-P1.5 后「单机部署 / proven / 真实配置」轨道的 **Phase 0 边界冻结**与 **Phase 1 proven-off 可复现部署**；**不含** proven 置真、真实客户 `access.yaml` 合入 main |
| 输出位置 | `docs/access-control/checklist-single-deploy-phase0-1.md` |

> **底线：** 在用户真实测试通过，且 **Phase 3 / Phase 4 门禁签字**之前，不污染 `main`。  
> Phase 1 签字**仅**授权进入 Phase 2，**不**授权 merge。  
> 默认栈 **不得** 设置 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true`。  
> **禁止默认使用：** `docker-compose.ac-p1-by01.yml`（proven=true，仅 BY-01 行集抽检 overlay）。

---

## 0. 轨道与阶段

| 阶段 | 目标 | proven | 配置落点 | 可否 merge main |
|---|---|---|---|---|
| **Phase 0** | 边界 / 回滚 / 禁令书面冻结 | n/a | 本文勾选 | **否** |
| **Phase 1** | 单机 Compose 可复现；健康检查 + unproven 预期 | **false**（显式） | 隔离 project 名；证据 → `inbox/` | **否**（签字仅 → Phase 2） |
| Phase 2 | 真实职责包挂载；Admin dryRun→保存闭环 | false | **独立** customer-config 挂载 | **否**（见 [Phase 2 清单](checklist-single-deploy-phase2.md)） |
| Phase 3 | 目标环境 proven 置真 + 行集抽检 + 回滚 | 专用 overlay = true | 与默认 compose 分离 | **否**（proven **永不**进默认 compose） |
| Phase 4 | 合 main 门禁（Allow/Deny） | 默认仍 false | 见 Phase 3/4 清单 | **有条件**（须 Phase 3 + 用户真实测试 + Phase 4 签字） |

路线图依据：[`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md)（TokenScope / Dynamic RLS / AC-P2+ 冻结）。  
Phase 2：[`checklist-single-deploy-phase2.md`](checklist-single-deploy-phase2.md)。  
Phase 3–4：[`checklist-single-deploy-phase3-4.md`](checklist-single-deploy-phase3-4.md)。

---

## 1. Phase 0 — 边界冻结 Checklist

### 1.1 范围（必须勾选）

- [ ] 本轨道只做：**单机 / 内网部署路径**、**proven 运维启用（后续 Phase）**、**真实 `access.yaml` 落地（后续 Phase）**
- [ ] **不做** TokenScope / 同 Agent 多 Token 不同行域 / Dynamic RLS / 多租户 / AC-P2+ 整包
- [ ] 不把「行级取数已生效」写成默认产品态；proven 前 FinalRows≠TRUE 源取数预期为 `row_policy_upstream_unproven`
- [ ] 代码与配置变更优先落在 `feature/access-control-upgrade`（或后续专用分支）
- [ ] **合 main 纪律：** Phase 1 签字 ≠ 可 merge；仅当**用户真实测试通过**且 [`Phase 3/4`](checklist-single-deploy-phase3-4.md) 门禁签字后，方可按 Phase 4 Allow 清单开 PR / merge

### 1.2 环境与证据约定

- [ ] 隔离 Compose project 名（推荐：`lucy-single-deploy-p1`），避免冲掉日常 demo / BY-01 容器
- [ ] 证据目录约定：`inbox/YYYYMMDD-single-deploy-p1/`（API JSON / 截图；token 须脱敏）
- [ ] 主机端口若冲突，用 env 覆盖（见 §2.2），**不要**改默认 compose 把 proven 写死为 true

### 1.3 回滚底线（必须书面确认）

| 场景 | 动作 |
|---|---|
| 误开 proven | 去掉 proven=true overlay，或叠加 `docker-compose.ac-p1-by01-proven-off.yml`，`up -d` 重建 `lucy` |
| 配置编不过 / degrade | 回滚上一份可编译 `access.yaml`；见 [`runbook-row-policy.md`](runbook-row-policy.md) 路径 A/C/D |
| 整栈放弃 | `docker compose -p lucy-single-deploy-p1 down`（加 `-v` 会删 demo 数据卷，慎用） |

- [ ] 已阅读上表；误开 proven 时**先关 proven**，再排障

### 1.4 Phase 0 签字

| 项 | 签名 | 日期 |
|---|---|---|
| Phase 0 边界与回滚确认 | 待确认 | |

---

## 2. Phase 1 — proven-off 单机 Compose 命令清单

### 2.1 文件角色

| 文件 | 角色 |
|---|---|
| `docker-compose.demo.yml` | 单机 baseline：MySQL demo + Lucy WebUI/Proxy |
| `docker-compose.ac-p1-by01-proven-off.yml` | **显式** `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=false` |
| `docker-compose.ac-p1-by01.yml` | **禁止**作 Phase 1 默认（proven=true） |
| `docker-compose.gate-c-uat.yml` | Gate C / BY 抽检专用；Phase 1 **不必**叠加 |
| `docker-compose.customer-config.yml` | Phase 2 真实配置挂载；Phase 1 **不必**叠加 |

### 2.2 推荐环境变量（可按主机改端口）

```bash
export LUCY_DEMO_WEBUI_HOST_PORT=55176
export LUCY_DEMO_PROXY_HOST_PORT=57881
export LUCY_DEMO_MYSQL_HOST_PORT=53306
# Apple Silicon 默认即可；amd64 主机：
# export TARGETPLATFORM=linux/amd64 TARGETARCH=amd64
```

### 2.3 冷启动（proven-off）

在仓库根目录：

```bash
# 可选：用脚本锁定 buildx，减少错架构构建（见 docs/DEVELOPMENT.md）
# npm run demo:rebuild

docker compose \
  -f docker-compose.demo.yml \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p lucy-single-deploy-p1 \
  up -d --build
```

仅重建 Lucy 进程（配置/镜像已存在时）：

```bash
docker compose \
  -f docker-compose.demo.yml \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p lucy-single-deploy-p1 \
  up -d --force-recreate --no-deps lucy
```

### 2.4 健康检查

```bash
WEBUI="http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}"
MCP="http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}/mcp"

# 容器
docker compose -p lucy-single-deploy-p1 ps

# proven 必须为 false（显式 overlay）
docker compose -p lucy-single-deploy-p1 exec lucy \
  printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN
# 期望输出：false

# EffectivePolicy / 运行时健康（强于仅打 Admin API）
curl -sS "$WEBUI/api/health" | tee /tmp/lucy-p1-health.json
# 期望（jq 或目视）：
#   .data.status == "ok"
#   .data.policy.healthy == true
#   .data.policy.degradedGlobal == false
#   .data.policy.policyVersion 非空

# Admin API 仍建议抽一眼
curl -sS -o /dev/null -w "%{http_code}\n" "$WEBUI/api/admin/agents"
# 期望：200

# 浏览器
# http://127.0.0.1:55176/admin/agents
```

> `/api/admin/agents == 200` 只证明 Admin 路由活着；**必须以 `/api/health` 的 `policy.healthy` / `degradedGlobal` 作为 Phase 1 健康门禁。**  
> MCP Proxy 可用性见 §2.5（initialize 握手 + unproven `lucy_query`）。

### 2.5 Phase 1 功能验收（proven=false）

**背景（必读）：** demo 模板 `examples/docker-demo/project-template/webui/config/access.yaml` 仅有 `demo_readonly`（表级 allow，等价行域 TRUE / 无 scoped、无 constraints）。  
Phase 1 **不**叠加 `customer-config` / `gate-c-uat`，因此 **不能**假设开箱即有 FinalRows≠TRUE 源。  
unproven 验收必须先造**临时 fixture**（与 [`scripts/ac-p15-uat-runbook.mjs`](../../scripts/ac-p15-uat-runbook.mjs) 的 ensureAgent → constraints → token → MCP → revoke/cleanup 同构；可手跑下列 curl，或对已起的 Phase 1 栈设置 `ACP15_WEBUI_BASE` / `ACP15_MCP_BASE` 后裁剪跑该脚本）。

#### 2.5.1 验收勾选

- [ ] Compose `ps` 中 `demo-db` healthy、`lucy` running
- [ ] `printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` → `false`
- [ ] `/api/health`：`status=ok` 且 `policy.healthy=true` 且 `degradedGlobal=false`
- [ ] Admin：Agent / Role 列表可打开；无虚假「行级取数已生效」文案
- [ ] §2.5.2 fixture 已创建：临时 Agent + constraints → FinalRows≠TRUE（dryRun / GET 可见 digest 或 protected）
- [ ] MCP `initialize` 握手成功（HTTP 2xx + 可解析 JSON-RPC / 会话）
- [ ] 同 token 调 `lucy_query` → 响应含 **`row_policy_upstream_unproven`**（**预期**，不是故障）
- [ ] token 已 revoke；临时 Agent 已删除（或 constraints 已清除且 Agent 删除）
- [ ] 证据落入 `inbox/YYYYMMDD-single-deploy-p1/`（health JSON、initialize、unproven deny、cleanup；**token 字段脱敏**）

#### 2.5.2 最小 fixture（临时 Agent + constraints + 短 token）

```bash
WEBUI="http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}"
MCP="http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}/mcp"
AGENT_ID="sdp1_unproven_agent"
EVIDENCE="inbox/$(date +%Y%m%d)-single-deploy-p1"
mkdir -p "$EVIDENCE/api"

# 1) 创建临时 Agent（role=demo_readonly；表级已有 superstore_orders）
curl -sS -X POST "$WEBUI/api/admin/agents" \
  -H 'content-type: application/json' \
  -d "{\"dryRun\":false,\"agent\":{\"id\":\"$AGENT_ID\",\"name\":\"Phase1 unproven fixture\",\"role\":\"demo_readonly\",\"note\":\"single-deploy Phase1 — delete after\"}}" \
  | tee "$EVIDENCE/api/01-agent-create.json"

# 2) 写入 Agent constraints（使 FinalRows≠TRUE；勿写 Role）
VERSION=$(curl -sS "$WEBUI/api/admin/agents/$AGENT_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["version"])')
curl -sS -X PATCH "$WEBUI/api/admin/agents/$AGENT_ID" \
  -H 'content-type: application/json' \
  -d "{\"dryRun\":false,\"version\":$VERSION,\"patch\":{\"constraints\":{\"sources\":[{\"connection\":\"demo-mysql\",\"schema\":\"dataforai\",\"names\":[\"superstore_orders\"],\"predicates\":[{\"field\":\"region\",\"op\":\"eq\",\"value\":\"East\"}]}]}}}" \
  | tee "$EVIDENCE/api/02-constraints-save.json"
# 期望：ok / runtimeAck===true；capabilities 上该源 protected 或 FinalRows 非 TRUE

# 3) 短生命周期 token +  bump note 触发 EffectivePolicy 重载（token API  alone 不保证 runtime 提交）
VERSION=$(curl -sS "$WEBUI/api/admin/agents/$AGENT_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["version"])')
TOK_JSON=$(curl -sS -X POST "$WEBUI/api/admin/agents/$AGENT_ID/tokens" \
  -H 'content-type: application/json' \
  -d '{"label":"sdp1-unproven-T1"}')
# 明文 token 只留内存；落盘前脱敏
echo "$TOK_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); data=d.get("data") or {};
data["token"]="[REDACTED]" if data.get("token") else data.get("token"); d["data"]=data; print(json.dumps(d,indent=2))' \
  > "$EVIDENCE/api/03-token-create.json"
TOKEN=$(echo "$TOK_JSON" | python3 -c 'import sys,json; print((json.load(sys.stdin).get("data") or {}).get("token") or "")')
test -n "$TOKEN"

VERSION=$(curl -sS "$WEBUI/api/admin/agents/$AGENT_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["version"])')
curl -sS -X PATCH "$WEBUI/api/admin/agents/$AGENT_ID" \
  -H 'content-type: application/json' \
  -d "{\"dryRun\":false,\"version\":$VERSION,\"patch\":{\"note\":\"sdp1 reload $(date +%s)\"}}" \
  | tee "$EVIDENCE/api/03b-runtime-reload.json"

# 4) MCP initialize 最小握手
curl -sS -X POST "$MCP" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sdp1","version":"1.0.0"}}}' \
  | tee "$EVIDENCE/api/04-mcp-initialize.txt"
# 期望：HTTP 2xx；正文含 result / serverInfo（或等价成功 initialize）；记下 mcp-session-id（若有）

# 5) lucy_query → unproven（proven=false + FinalRows≠TRUE）
# 若 initialize 返回 mcp-session-id，后续请求加头：-H "mcp-session-id: <id>"
curl -sS -X POST "$MCP" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lucy_query","arguments":{"connectionId":"demo-mysql","measures":["superstore_orders.total_sales"]}}}' \
  | tee "$EVIDENCE/api/05-lucy-query-unproven.txt"
# 期望：正文含 row_policy_upstream_unproven

# 6) 清理：revoke token + 删 Agent
curl -sS -X DELETE "$WEBUI/api/admin/agents/$AGENT_ID/tokens/sdp1-unproven-T1" \
  | tee "$EVIDENCE/api/06-token-revoke.json"
curl -sS -X DELETE "$WEBUI/api/admin/agents/$AGENT_ID" \
  | tee "$EVIDENCE/api/99-agent-delete.json"

unset TOKEN
```

**自动化替代：** 对同一 `WEBUI`/`MCP` 端口，可参考并裁剪运行：

```bash
ACP15_WEBUI_BASE="$WEBUI" ACP15_MCP_BASE="$MCP" \
  node scripts/ac-p15-uat-runbook.mjs
# 证据默认写入 inbox/20260809-ac-p15-uat/；Phase 1 签字可引用其中 MCP-1，
# 或把关键 JSON 复制到 inbox/YYYYMMDD-single-deploy-p1/（注意脚本已对 token redaction）。
```

### 2.6 停止 / 回滚命令

```bash
# 停止（保留 volume）
docker compose \
  -f docker-compose.demo.yml \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p lucy-single-deploy-p1 \
  down

# 若误叠加了 proven=true overlay：改回仅 proven-off 后 recreate lucy
docker compose \
  -f docker-compose.demo.yml \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p lucy-single-deploy-p1 \
  up -d --force-recreate --no-deps lucy
```

### 2.7 Phase 1 签字

| 项 | 签名 | 日期 | 证据 |
|---|---|---|---|
| proven-off 冷启动可复现 | 待确认 | | `inbox/…-single-deploy-p1/` |
| `/api/health` policy 健康 | 待确认 | | health JSON |
| MCP initialize + unproven（含 fixture 清理） | 待确认 | | §2.5.2 |
| **Phase 1 批准 → 仅授权进入 Phase 2** | 待确认 | | **不授权** merge `main` |

---

## 3. 明确不做（Phase 0/1）

| 禁止项 | 原因 |
|---|---|
| 默认 `docker-compose.yml` / `demo.yml` 写入 `proven=true` | 污染产品默认；违反运维变更边界 |
| Phase 1 使用 `docker-compose.ac-p1-by01.yml` 当日常栈 | 那是抽检 overlay |
| 因 Phase 1 签字而 merge `main` | Phase 1 只开门到 Phase 2；merge 见 Phase 4 |
| 无 fixture 时把「demo_readonly 开箱查询成功」当成 unproven 验收 | 模板行域为 TRUE，不会触发 unproven |
| 把客户真实 `access.yaml` 直接改仓库默认并合入 | 属 Phase 2+，且默认仍应不合生产事实源 |
| 声称 Dynamic RLS / TokenScope / 多租户隔离已交付 | Non-Claim |

---

## 4. 下一步（Phase 1 签字后）

Phase 1 签字后**只做** Phase 2，**仍不** merge `main`。

1. **Phase 2：** [`checklist-single-deploy-phase2.md`](checklist-single-deploy-phase2.md)（真实/近似配置 + Compose 身份登记）  
2. **Phase 3 / 4：** [`checklist-single-deploy-phase3-4.md`](checklist-single-deploy-phase3-4.md)（proven 置真/回滚 → 有条件 merge）

— 完
