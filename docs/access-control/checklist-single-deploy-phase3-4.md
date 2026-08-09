# 单机部署落地 — Phase 3 proven 置真 + Phase 4 合 main 门禁

| 元数据 | 内容 |
|---|---|
| 文档名称 | 单机部署落地 Phase 3 / Phase 4 清单 |
| 文档类型 | Checklist |
| 版本 | v1.3 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) §2.2；[`checklist-single-deploy-phase0-1.md`](checklist-single-deploy-phase0-1.md)；[`checklist-single-deploy-phase2.md`](checklist-single-deploy-phase2.md)；[`runbook-row-policy.md`](runbook-row-policy.md)；[`release-notes-ac-p1.md`](release-notes-ac-p1.md) / [`release-notes-ac-p15.md`](release-notes-ac-p15.md)；`docker-compose.ac-p1-by01.yml` |
| 适用范围 | **Phase 3**：目标环境 proven 运维置真、行集抽检、回滚；**Phase 4**：验证后可否 / 如何合 `main` 的门禁。均**不**授权 TokenScope / Dynamic RLS / AC-P2+ |
| 输出位置 | `docs/access-control/checklist-single-deploy-phase3-4.md` |

> **底线：** 未完成 **用户真实测试 + Phase 3 签字 + Phase 4 门禁签字** 前，**不 merge** `main`（draft PR 可先开，见 §3.1）；也不把 `proven=true` / 客户生产事实源写进默认树。  
> Phase 1 / Phase 2 签字**不**授权 merge。  
> **proven 置真 = 独立运维变更**，禁止与「merge 代码到 main」捆成同一步。  
> **P3 配置连续：** 必须沿用 Phase 2 的同一配置事实源与同一 Compose project（或 P3 启动后按 Phase 1 §2.5.2 重建临时 fixture）；禁止「P2 配在 customer-config、P3 换 demo 空栈抽检」。

前序：[Phase 0 / Phase 1](checklist-single-deploy-phase0-1.md)；**[Phase 2 全文](checklist-single-deploy-phase2.md)**（必做，不可跳过）。

---

## 0. 阶段总览

| 阶段 | 目标 | proven | 合 main |
|---|---|---|---|
| Phase 0–1 | 边界 + proven-off 可复现 | false | **否**（P1 签字 → 仅 Phase 2） |
| **Phase 2** | 真实 / 近似真实配置挂载闭环 | false | **否**（全文见 [Phase 2](checklist-single-deploy-phase2.md)） |
| **Phase 3** | 专用 overlay 置真 → 行集 ⊆ 强制域 → **关回 false** | 临时 true → **恢复 false** | **否** |
| **Phase 4** | 决定 PR 内容与默认姿态 | 默认仍 false | **有条件**（用户真实测试 + P3/P4 签字） |

---

## 1. Phase 2 完成确认（Phase 3 开工前）

> Phase 2 **不是**本文件摘要可替代的步骤。执行与签字一律以 [`checklist-single-deploy-phase2.md`](checklist-single-deploy-phase2.md) 为准。

Phase 3 开工前复核：

- [ ] Phase 2 清单 §9 已签字  
- [ ] 证据包含 `00-compose-identity.env`（`COMPOSE_PROJECT` + `COMPOSE_BASELINE` + `WEBUI` + `MCP`）  
- [ ] 目标源 FinalRows≠TRUE 仍在（或已计划 Phase 3 §2.0 路径 B 重建 fixture）  
- [ ] proven 仍为 **false**

| 项 | 签名 | 日期 |
|---|---|---|
| 已确认 Phase 2 完成，可进 Phase 3 | 待确认 | |

---

## 2. Phase 3 — proven 置真（运维变更）

### 2.0 配置事实源连续（Normative）

Phase 3 抽检的 FinalRows≠TRUE 源必须来自下列之一（勾选其一）：

| 路径 | 要求 |
|---|---|
| **A（推荐）** | **同一** `COMPOSE_PROJECT` + **同一** `COMPOSE_BASELINE`（含同一 `customer-config/` 挂载 / volume）；仅把 proven-off overlay **换成** proven=true overlay |
| **B** | 若必须换 project 或改用 demo 空栈：在 **P3 启动后**按 [Phase 1 §2.5.2](checklist-single-deploy-phase0-1.md) **重新**创建临时 Agent + constraints + token；抽检结束删除。**不得**假设 P2 的 scoped/constraints 会自动出现在新栈 |

- [ ] 已确认路径 A 或 B；路径 A 时 `customer-config/`（或 P2 写入的 runtime 配置）对 P3 进程可见  
- [ ] **禁止：** P2 用 `docker-compose.yml` + `customer-config`，P3 无说明地改用 `docker-compose.demo.yml` 新 project 却仍声称「抽检 P2 配置」

### 2.1 置真前硬门禁（须全部满足）

复用 Runbook「proven 置真检查单」（Gate C 工程门禁已于 2026-08-09 勾满）。**本环境**额外勾选：

- [ ] Phase 0 / Phase 1 已签字（或书面豁免并登记理由）
- [ ] Phase 2 全文清单已签字（本文 §1）；§2.0 路径已勾选
- [ ] `COMPOSE_PROJECT` / `COMPOSE_BASELINE` 与启动、回滚一致（来自 Phase 2 `00-compose-identity.env`）
- [ ] 已准备**对称**回滚（§2.5：baseline 不变，仅 proven overlay → proven-off）
- [ ] 证据目录：`inbox/YYYYMMDD-single-deploy-p3/`（复制/引用 P2 的 `00-compose-identity.env`；token 脱敏）

### 2.2 文件角色

| 文件 | Phase 3 角色 |
|---|---|
| `COMPOSE_BASELINE` 内文件 | **不变**：与 Phase 2 相同的 baseline / customer-config / demo 等 |
| `docker-compose.ac-p1-by01.yml` | **仅**置真 overlay：`LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true` |
| `docker-compose.ac-p1-by01-proven-off.yml` | 回滚：替换 proven=true overlay，**不**改 baseline |
| `docker-compose.gate-c-uat.yml` | 可选：若 P2 已用则 P3/回滚须同样带上；不得只在置真步突然加入又弄丢配置 |

### 2.3 置真启动命令（沿用 Phase 2 身份）

```bash
# 先 source Phase 2 登记的身份，例如：
# source inbox/YYYYMMDD-single-deploy-p2/00-compose-identity.env
# 须含 COMPOSE_PROJECT、COMPOSE_BASELINE、WEBUI、MCP

# 临时 proven=true — 仅抽检窗口
# 规则：与 P2 启动完全相同的 baseline/overrides，仅将 proven-off 换为 proven=true
docker compose \
  "${COMPOSE_BASELINE[@]}" \
  -f docker-compose.ac-p1-by01.yml \
  -p "$COMPOSE_PROJECT" \
  up -d --build

docker compose -p "$COMPOSE_PROJECT" exec lucy \
  printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN
# 期望：true

# 路径 B：若本栈尚无 FinalRows≠TRUE，此处执行 Phase 1 §2.5.2 fixture 后再抽检
```

**反例（禁止当作「接续 P2」）：**

```bash
# ❌ 丢掉 customer-config / 换 project，P2 配置不会出现
docker compose -f docker-compose.demo.yml -f docker-compose.ac-p1-by01.yml \
  -p lucy-single-deploy-p3 up -d --build
```

测当前 feature 分支代码时：仅当 Phase 2 **已经**把 `gate-c-uat` 算进 `COMPOSE_BASELINE` 时才继续带上；并先 `cd webui && npm run build`。

### 2.4 抽检矩阵（最低）

| ID | 操作 | 期望 | 证据 |
|---|---|---|---|
| P3-00 | 确认 FinalRows≠TRUE 源仍在（GET Agent / dryRun） | digest / protected 与 P2（或重建 fixture）一致 | JSON |
| P3-01 | `printenv` proven | `true` | 文本 |
| P3-02 | 包装工具 `lucy_query` × FinalRows≠TRUE | **允许取数**；响应/审计可见强制谓词注入（`forced_filters` 与/或 `filters[]` 前缀） | JSON（脱敏） |
| P3-03 | 行集抽检（BY-01 口径） | 结果行 ⊆ 强制域（如 region=East）；无域外行 | 行样本 / 计数说明 |
| P3-04 | Agent Constraints 收紧（若已配） | 相对仅 Role Grant 更窄或相等；不可放宽 | dryRun digest + 查询对比 |
| P3-05 | 未包装 DataPlane 工具 | `row_policy_requires_wrapped_tool` | JSON |
| P3-06 | 用户伪造 filter / 试图放宽 | 强制前缀仍在；域不被放宽 | JSON / 说明 |
| P3-07 | **回滚** proven→false 后同查询 | `row_policy_upstream_unproven` | JSON |

参考：[`uat-ac-p1.md`](uat-ac-p1.md) BY-01；[`evidence-ktx-forced-filters.md`](evidence-ktx-forced-filters.md)；路径 B [`runbook-row-policy.md`](runbook-row-policy.md)。

### 2.5 回滚（演练结束必须执行）

**对称规则：** 使用与 §2.3 **完全相同**的 `COMPOSE_BASELINE` + `COMPOSE_PROJECT`，**仅**将 `docker-compose.ac-p1-by01.yml` 替换为 `docker-compose.ac-p1-by01-proven-off.yml`。  
禁止在回滚时改成 `docker-compose.demo.yml` 或其它 baseline（会替换挂载 / 端口 / image / demo-db，破坏 customer-config 路径）。

```bash
# 关 proven：baseline 不变，仅 proven overlay → proven-off
docker compose \
  "${COMPOSE_BASELINE[@]}" \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p "$COMPOSE_PROJECT" \
  up -d --force-recreate --no-deps lucy

docker compose -p "$COMPOSE_PROJECT" exec lucy \
  printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN
# 期望：false

# 可选：整栈停止（保留 volume；仍用同一 baseline）
docker compose \
  "${COMPOSE_BASELINE[@]}" \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p "$COMPOSE_PROJECT" \
  down
```

- [ ] 回滚所用 `-f` 列表与置真启动相比**仅** proven overlay 不同
- [ ] 演练结束后 proven **已恢复 false**（或容器已 down 且无其它环境残留 true）
- [ ] 短生命周期 UAT token 已 revoke；路径 B 临时 Agent 已删或 constraints 已清

### 2.6 Phase 3 签字

| 项 | 签名 | 日期 | 证据 |
|---|---|---|---|
| §2.0 配置连续（路径 A/B） | xingchen | 2026-08-09 | `inbox/20260809-single-deploy-p3/00-compose-identity.env` |
| P3-00…P3-06 抽检 | xingchen | 2026-08-09 | `inbox/20260809-single-deploy-p3/` |
| P3-07 对称回滚 proven=false | xingchen | 2026-08-09 | `…-p3/api/11` / `12` |
| Non-Claim 未破（无 Dynamic RLS / TokenScope 声称） | xingchen | 2026-08-09 | 阶段报告 |
| **Phase 3 批准（可议 Phase 4）** | xingchen | 2026-08-09 | 总报告 §9；**暂不 merge** |

---

## 3. Phase 4 — 合 `main` 门禁

### 3.1 总原则

1. **默认产品姿态不变：** `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 未设置或为 false。  
2. **proven=true 只存在于**文档说明的运维 overlay / 客户私有 compose，**不**进入默认 `docker-compose.yml` / `docker-compose.demo.yml`。  
3. **客户生产 `access.yaml` 事实源**默认留在客户挂载目录；仓库最多收 **example / 模板**，并标明非生产。  
4. **Draft vs Merge：**  
   - **允许**提前开 **draft** PR（含纯文档 / proven-off 说明），便于评审文稿。  
   - **任何**向 `main` 的 **merge**（含「仅文档 / 仅 proven-off」）都必须具备：（a）用户真实测试证据，（b）Phase 3 签字，（c）本节 Phase 4 签字。  
5. Phase 1 / Phase 2 签字、draft PR、或「单机 Compose 已绿」→ **一律不构成** merge 授权。

### 3.2 允许合入（Allow）— 仍须过 §3.1.4 merge 三件套

| 类别 | 示例 |
|---|---|
| 文档 / Checklist / Runbook 补丁 | 本文、Phase 0/1 清单、安装说明澄清 |
| proven-off 显式 overlay 与命令 | 已有 `docker-compose.ac-p1-by01-proven-off.yml` |
| 体验 / 可运维性（无新权限模型） | 错误文案、Admin 提示、sticky-bar 类 bugfix |
| **示例**配置（可选） | `customer-config.example/` 增加 scoped + constraints **样例**；注释写明需 Phase 3 运维置真才取数 |
| 已在 feature 分支验证过的 AC-P0/P1/P1.5 代码 | 仅当产品决定把该分支合入；**仍**默认 proven=false |

### 3.3 禁止合入（Deny）

| 类别 | 原因 |
|---|---|
| 默认 compose 设 `proven=true` | 污染 main；行级取数变成静默默认 |
| 把某客户真实 token hash / 明文 / 生产 ACL 当仓库默认 | 泄密 + 错误事实源 |
| TokenScope / Dynamic RLS / AC-P2+ runtime 或 Spec 开工 | 违反路线图冻结 ADR |
| Release notes / README 声称多租户隔离或「行级默认已生效」 | Non-Claim |
| 未脱敏的 UAT 证据包（若误 tracked） | 卫生；`inbox/` 应保持 gitignore |
| 以「仅文档 PR」为由跳过用户真实测试 / P3 签字而 **merge** | 与底线冲突；draft 可以，merge 不行 |

### 3.4 PR / merge 检查单

**开 draft（可选，可较早）：**

- [ ] PR 标为 draft；描述写明「未授权 merge，待用户真实测试 + P3/P4」
- [ ] 若含 proven 相关文案：写明默认仍 false

**merge 前（硬门禁，无例外）：**

- [ ] 用户真实测试证据已登记（路径 / 结论；可与 P3 证据包合并）
- [ ] Phase 3 总签已完成
- [ ] Phase 4 §3.7 已签字
- [ ] `git diff` 相对 merge-base：**无** `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN: "true"` 进入默认服务定义
- [ ] `webui/config/access.yaml`（若改）仅为示例/迁移所需，**非**客户生产拷贝；无明文 secret
- [ ] Release notes / 域 README 未新增 Dynamic RLS / TokenScope / 多租户「已交付」
- [ ] CI / 关键单测绿（至少：`row-policy` / `agent-constraints` / `ac-security-eval` 视改动范围）
- [ ] PR 描述写明：**proven 置真仍是目标环境运维步骤**；merge ≠ 开启行级取数

### 3.5 建议 PR 拆分（降低污染 main 风险）

| PR | 内容 | draft | merge 依赖 |
|---|---|---|---|
| A | 单机部署文档 + Phase 0/1/3/4 checklist（无 runtime） | 可早开 | 用户真实测试 + P3/P4（**无**「仅文档豁免 merge」） |
| B | feature 分支上已 Gate C 的权限代码（若尚未合） | 可早开 | 同上 + 产品合入窗口 |
| C | `customer-config.example` 样例 ACL（可选） | 可早开 | 同上；建议 P2/P3 经验固化后 |

**不要**把「proven overlay 当默认」放进任一 PR。

### 3.6 Merge 后验证（main 上）

```bash
# 自 main 工作树：默认 demo 不得带 proven=true
docker compose -f docker-compose.demo.yml config | rg -i "FORCED_PREDICATE_PROVEN" || true
# 若无输出：未设置（视为 false）— 合格
# 若有 true：BLOCK，立即回滚该变更

# 显式 proven-off 仍可用（示例；不代替客户向 baseline）
docker compose \
  -f docker-compose.demo.yml \
  -f docker-compose.ac-p1-by01-proven-off.yml \
  -p lucy-main-smoke-proven-off \
  config | rg "LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN"
# 期望含 false
```

- [ ] main 默认栈 proven 未打开
- [ ] 文档链接可从 [`README.md`](README.md) 点到本文与 Phase 0/1

### 3.7 Phase 4 签字

| 项 | 签名 | 日期 | 结论 |
|---|---|---|---|
| Allow/Deny 清单确认 | xingchen | 2026-08-09 | **通过** |
| 用户真实测试证据已审阅 | xingchen | 2026-08-09 | **通过（HTTP MCP SSE + 服务端日志）**；Cursor Agent SSE 手测另做 |
| PR 范围批准（A / B / C） | xingchen | 2026-08-09 | **暂缓**（待 Agent SSE 手测后再定） |
| **批准 merge 到 main**（非仅开 draft） | xingchen | 2026-08-09 | **否（明确暂缓）** — 待亲自完成 Cursor Agent SSE/`lucy_query` 测试后再议 |

---

## 4. 明确不做（Phase 3/4）

| 禁止项 | 原因 |
|---|---|
| P3 换 demo/新 project 却声称抽检 P2 配置 | FinalRows≠TRUE 对象丢失 |
| 回滚时改换 baseline（如 customer → demo） | 挂载/端口/image 不对称，配置被替换 |
| 抽检结束后仍留 proven=true 在共享环境 | 路径 B 事故面 |
| 用 merge 代替运维置真 | 违反 release notes / Runbook |
| 以「仅文档」豁免 merge 门禁 | draft 可以，merge 必须三件套 |
| Phase 4「为方便演示」默认打开 proven | 污染 main |
| 借 Phase 4 开 TokenScope / Dynamic RLS | 路线图冻结 |

---

## 5. 证据与卫生

| 包 | 路径 |
|---|---|
| Phase 3 | `inbox/YYYYMMDD-single-deploy-p3/` |
| 历史 BY-01 参考 | `inbox/20260809-ac-p1-by01-uat/`（本地；gitignore） |

卫生要求与 AC-P1.5 UAT 相同：`token` / Bearer → `[REDACTED]`；全绿清理 `*-failed.png`。

---

## 6. 签字总表（轨道收束）

| 阶段 | 状态 | 签名 | 日期 |
|---|---|---|---|
| Phase 0 | 见 Phase 0/1 文档 | | |
| Phase 1 | 见 Phase 0/1 文档 | | |
| Phase 2 | [Phase 2 清单](checklist-single-deploy-phase2.md) §9 + 本文 §1 | | |
| **Phase 3** | §2.6 **通过** | xingchen | 2026-08-09 |
| **Phase 4** | §3.7 **门禁通过 / merge 暂缓** | xingchen | 2026-08-09 |

— 完
