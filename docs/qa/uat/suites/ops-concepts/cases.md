# Cases — UAT-SUITE-OPS-CONCEPTS

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用；记录 `gitSha`／`gitDirty` |
| UAT-R0-FIX | P1-27 修复镜像门禁 | 手工／脚本 | Spec SC-08／D7 | `gitSha`＝修复提交且 **`gitDirty=false`**；卷上无 `scripts/`；代码根有 `scripts/concepts`；否则 STOP |
| UAT-OPS-CONCEPT-01 | 问数 Token 无概念运维工具 | MCP 全真 | Spec SC-05／P1-27 SC-04 | tools/list 无 `lucy_ops_concept_*`；强调 list → 拒绝 |
| UAT-OPS-CONCEPT-02 | 临时 allow.ops Agent 可 list／scan | WebUI＋MCP | P1-11 SC-01；**P1-27 SC-02／03** | 建 Role＋Agent＋Token 后 list／summary 业务成功；scan 可达（不强制 commit）；**不得** 502／`ERR_MODULE_NOT_FOUND` at `/data/lucy` |
| UAT-OPS-CONCEPT-03 | 清理临时资源 | WebUI／API | 清理 | 删除 Agent／Role；问数 Token 仍无 ops |
| UAT-OPS-CONCEPT-04 | 人审写 commit（可选） | MCP | Spec 写路径 | 本波默认 **SKIPPED** |
| UAT-OPS-CONCEPT-05 | 运行时不可用信封（可选） | MCP／探针 | P1-27 SC-05／06 | 加载失败 → 顶层 `ops_concept_runtime_unavailable`＋审计；缺注入手段 → **SKIPPED** |

---

## UAT-R0 — 环境门禁

### 步骤

1. `docker ps` 确认 `compose-lucy-1` healthy；端口 `55176`／`57881`  
2. `GET /api/health` → 记录 `gitSha`／`gitDirty`／`lucyVersion`／`ktxRuntime`  
3. WebUI 登录（凭据文件路径见 fixtures）  
4. MCP `initialize`（问数 Bearer）成功  

### 期望

- health `ok`；MCP initialize 无协议级失败  
- 跑次记下完整 `gitSha` 与 `gitDirty`  
- 若仅做环境探活、不做 P1-27 关闭主张：本条即可；要主张关闭 GAP-UAT-P1-11-RUNTIME 必须另过 **UAT-R0-FIX**

---

## UAT-R0-FIX — P1-27 修复镜像门禁

> **P1-27 复测波必做。** 对应 Spec SC-08／D7。脏树或未含修复提交的镜像 → **STOP**，不得继续 01–03 并主张修复已验证。

### 前置

- 本机已对**含 P1-27 修复**的提交做过干净 `demo:upgrade`（或等价重建）；**禁止**为过本条而手工往 `/data/lucy` 播种 `scripts/`  
- 记下预期修复提交短 SHA（跑次元数据写明）

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 解析 `gitSha`、`gitDirty`  
2. `docker exec compose-lucy-1 sh -c 'test ! -e /data/lucy/scripts && echo NO_VOLUME_SCRIPTS'`  
3. `docker exec compose-lucy-1 sh -c 'test -f /app/scripts/concepts/store.mjs && test -f /app/scripts/concepts/scan.mjs && echo CODE_ROOT_OK'`  
4. （可选对照）`printenv KTX_PROJECT_ROOT` 在容器内应为 `/data/lucy`  

### 期望

- health `ok`  
- `gitDirty === false`（为 `true` → **FAIL／STOP**；禁止书面放行）  
- `gitSha` **等于**本波声称的修复提交（前缀一致即可记入跑次；不一致 → **FAIL／STOP**）  
- 步骤 2 输出 `NO_VOLUME_SCRIPTS`；步骤 3 输出 `CODE_ROOT_OK`  
- 不满足任一项：本波复测 **BLOCKED** 或 **FAIL**，**不得**改 INDEX 为 PASS／关闭 GAP

### 清理

无。

---

## UAT-OPS-CONCEPT-01 — 问数 Token 无概念运维工具

### 前置

- UAT-R0 PASS（P1-27 复测波另须 UAT-R0-FIX PASS）  
- 使用**问数** Bearer（桌面 `lucy token.txt`），**不要**用即将创建的 ops Token  

### 步骤

1. MCP `tools/list`（或客户端等价列举）  
2. 尝试 `tools/call` `lucy_ops_concept_list`（空或最小参数）  

### 期望

- 工具列表中**不出现**任何 `lucy_ops_concept_*`  
- 强调时失败（授权／不可见／`isError` 或等价拒绝）；**不得**返回概念清单成功载荷  
- 审计若可查：对应行 `outcome=denied`（或合同等价）  

---

## UAT-OPS-CONCEPT-02 — 临时 allow.ops Agent 可 list／scan

> **关闭 GAP-UAT-P1-11-RUNTIME 的关键必做项。** 首跑 FAIL 根因＝从 `/data/lucy` 加载 `scripts/concepts/*.mjs`。修复后须在**未**补卷 `scripts/` 的前提下业务受理成功。

### 前置

- Owner／Admin 已登录 WebUI  
- P1-27 复测波：UAT-R0-FIX PASS  
- 临时 id 使用 fixtures 前缀；若同名已存在，先清理再重建  
- 确认容器仍满足：`/data/lucy/scripts` 不存在（可复用 R0-FIX 步骤 2）  

### 步骤

1. 创建 Role `uat-ops-concept-role`：`allow.ops` 含 fixtures 最小工具集；`asset_kinds` 含 `governance`（若 UI／API 要求）  
2. 创建 Agent `uat-ops-concept-agent`，绑定该 Role；启用  
3. `POST /api/admin/agents/uat-ops-concept-agent/tokens`（label=`uat-ops-concept`）；**明文 token 只留在本机进程／临时文件，不写 runs**  
4. 用该 Token MCP `initialize` → `tools/list`  
5. 调用 `lucy_ops_concept_list`（读业务信封／`operation_state`／载荷，勿只看协议 `ok`）  
6. 调用 `lucy_ops_concept_summary`（最小合法参数；空库可接受）  
7. 调用 `lucy_ops_concept_scan`（按工具 schema 最小合法参数；推荐 `dry_run=true`／preview；若返回计划／preview／需二次确认，**停止在可观察的成功受理／计划态**，本波不 commit）  

### 期望

- ops Token 的 tools/list **可见** fixtures 列出的 `lucy_ops_concept_*`（通常 4 个；未授工具不可见）  
- `lucy_ops_concept_list` **业务成功**（空库 `concepts=[]` 可接受）  
- `lucy_ops_concept_summary` **业务成功**（或合同允许的空库摘要）；**不得** HTTP 502／`Proxy error`／`Upstream unavailable` 作为唯一失败面  
- `scan` 达到「可观察的控制面受理」（计划／preview／明确空结果均可）  
- **禁止失败形态（本条 FAIL）**：  
  - HTTP 502 且 body 仅 `Proxy error`／`Upstream unavailable`（首跑回归）  
  - `isError` 且 `data.code=ERR_MODULE_NOT_FOUND`（或 message 含 `Cannot find module '/data/lucy/scripts/concepts/…'`）  
- 磁盘上未因本波误 commit 产生未清理的权威写（若仅 preview／plan，注明）  
- 跑次须写明：未向 `/data/lucy` 拷贝 `scripts/`  

### 清理（本条结束前可暂留到 03）

- Token 明文不得写入跑次正文  

---

## UAT-OPS-CONCEPT-03 — 清理临时资源

### 步骤

1. 吊销／删除临时 Token；删除 Agent `uat-ops-concept-agent`  
2. 删除 Role `uat-ops-concept-role`（若仍被引用则先解绑）  
3. 再用问数 Bearer 重复 OPS-CONCEPT-01 的 tools/list 抽查  

### 期望

- Admin 列表中无 `uat-ops-concept-*` 残留（或已 disabled 且跑次说明）  
- 问数 Token 仍无 `lucy_ops_concept_*`  
- 容器 `access.yaml` 无 `uat-ops-concept` 残留命中（若可查）  

---

## UAT-OPS-CONCEPT-04 — 人审写 commit（可选）

本波默认 **SKIPPED**。若委托人另批：在隔离概念夹具上 set_canonical／reject 全路径，测后回滚；证据另开跑次附录。

---

## UAT-OPS-CONCEPT-05 — 运行时不可用信封（可选）

> 对应 P1-27 SC-05／SC-06。默认**不**破坏生产代码根；无安全注入手段时标 **SKIPPED**，由 vitest／授权探针覆盖，**不得**因此把套件改成 PASS WITH GAP 来关闭 GAP-UAT-P1-11-RUNTIME（关闭该 GAP 只看 01／02／03＋R0-FIX）。

### 前置

- 委托人批准的临时注入（例如测试专用 env／挂载破坏代码根模块），且可恢复  
- 或已获独立授权的降级探针说明  

### 步骤

1. 在注入失败条件下，用 ops Token 调用 `lucy_ops_concept_list`（及约定的一条写／scan 路径若可安全执行）  
2. 查 `access_log` 对应行  

### 期望

- 响应顶层机器码＝`ops_concept_runtime_unavailable`（**不是**仅有 `Proxy error`／`Upstream unavailable`）  
- 审计有对应行（`outcome` 反映拒绝／错误）；读路径不得静默跳号  
- 测后恢复代码根／配置；确认 02 路径可再次受理（或整波结束前已清理）  

### 无注入时

- 本条 **SKIPPED**；跑次一句说明即可  
