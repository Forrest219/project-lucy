# 公网企业体验精简测试（Cloud Enterprise Smoke）设计

| 元数据 | 内容 |
|---|---|
| 文档类型 | 设计稿（Design）；定稿后另开落地 Plan |
| 版本 | **v0.2（设计定稿）** |
| 日期 | 2026-11-14 |
| 委托人 | xingchen |
| 方案 | **B** — 基线套件 + 可变「本轮增量 MCP」槽 |
| 对抗 | Claude Code R1／R2（`inbox/20261114-cloud-enterprise-smoke-adversarial-r{1,2}.md`）；两轮均为 BLOCK；本版关闭其「落地前必须关闭」16 条 |
| 状态 | **设计定稿 v0.2**。未授权落地 Runbook／UAT／checklist 前不改仓库实现文件；未授权改出包硬门禁脚本 |

## 1. 目标与非目标

### 目标

在腾讯演示公网实例上，建立**可复现**的「企业部署后用户体验」精简测试：

- 发客户包前加跑一层**软证据**（必须跑并登记；FAIL／BLOCKED／DEFERRED 写理由，**不**自动挡 `docker save`／出包脚本）
- 覆盖 WebUI 短旅程 + 公网 MCP 最小问数 + 数据面角色可见范围（双会话）
- 每个跑次显式覆盖「本轮新增的 MCP **行为面**」（无新增则写带证据的 `N/A`）

### 非目标

- 不替代客户包硬门禁集合：**G2–G4d＋G8＋H3–H5＋K6**（与 [`customer-amd64-image-build-checklist.md`](../runbooks/customer-amd64-image-build-checklist.md) 现行硬门禁逐字对齐）
- 不替代本机 demo Docker 的 P0／P1 UAT PASS
- 不证明无公网离线（G4b）；公网机默认有网
- 不把密码、MCP token、RDS 口令写入仓库／runs／截图说明
- **不**新增 `0.30` **功能**总账行；**必须**在 `docs/governance/e2e-ledger.md` 勾连表挂行（总账列可写 `—（测试台基建）`）

### 硬边界（全文复述）

**公网套件 PASS ≠ 本机 demo UAT PASS ≠ 客户包 G／H／K 放行。**  
本套件判定**只**回答「腾讯演示实例上、相对本轮候选的可达性与最小问数／增量行为面」；**不产生**本机 UAT、0.30 功能总账状态或 G／H／K 放行结论。

## 2. 已裁定决策

| 议题 | 裁定 |
|---|---|
| 产物形态 | Runbook + UAT 套件（两者都要） |
| 入口 | `http://124.222.172.229:5174/login` |
| 跑次时机 | **发客户包前**加跑（仍不替代硬门禁） |
| 对出包的约束 | **软证据**（必须登记；FAIL／BLOCKED 写理由，不自动挡出包） |
| 覆盖面 | WebUI + MCP 问数 + 企业角色；**每次新增 MCP 行为面**都要在增量槽测 |
| 方案 | B（固定层 + 增量层） |
| Web 登录 | **owner 账号 id**（跑次填写；腾讯演示当前可用 id 见凭据文件，**勿与 MCP Role 混用**）＋ 至少 1 个业务用户 |
| `lucy_admin` | **仅** MCP 数据面 Role id（Spec 131）；**不是**「WebUI Admin」概念。若某实例恰好存在同名 Web 登录 id，跑次须分开写「Web 登录 id＝…」「数据面 Role＝lucy_admin」 |
| RDS | 可用于数据侧核对；**不是**网页登录账号 |
| 身份锚点 | 跑次绑定候选**三元组**：源码提交 + 镜像 digest + 包 SHA256（若已封包） |

## 3. 文档与台账结构

| 产物 | 路径 | 职责 |
|---|---|---|
| Runbook（操作 SOT） | `docs/runbooks/lucy-cloud-enterprise-smoke.md` | 入口、凭据路径、三元组绑定、固定步骤、增量填法、边界、发客户包前软检查表 |
| UAT 套件 | `docs/qa/uat/suites/cloud-enterprise-smoke/`（`suite.md`／`cases.md`／`fixtures.md`／`runs/`） | 可复现剧本与证据槽 |
| 测试台登记 | `docs/qa/uat/INDEX.md` + `docs/qa/uat/README.md` | Suite ID `UAT-SUITE-CLOUD-ENTERPRISE-SMOKE`；必做环境＝腾讯演示公网 |
| 勾连 | `docs/governance/e2e-ledger.md` | 增行；总账列 `—（测试台基建）` |
| 客户包软挂钩 | `customer-amd64-image-build-checklist.md` **独立软证据小节**内 **S-CLOUD-1**；v2 升级清单仅**非编号**「参见」一句 | 软证据；**不**挤进「缺一步不得出包」硬表 |

### 角色分工

| 角色 | 写什么 | 不写什么 |
|---|---|---|
| 执行者（Agent／人工） | `runs/` 全真证据；可交 INDEX 草稿建议 | 不得自行把未验收 PASS 写入 INDEX |
| 验收者（Cursor／委托人） | 复核 runs 后更新 INDEX／README／e2e-ledger | 不把 CR／读代码当 PASS |

## 4. 环境与凭据（fixtures 可写／禁写）

### 可写

| 键 | 值 |
|---|---|
| WebUI | `http://124.222.172.229:5174`（登录页 `/login`） |
| Health | `http://124.222.172.229:5174/api/health` |
| MCP URL（首选） | 实例对外 MCP Proxy URL（服务端事实；演示现状多为 `http://124.222.172.229:7879/mcp`）。**明文 HTTP＝演示现状，非客户交付形态**（客户须 TLS Ingress） |
| MCP 客户端别名（可选） | 如 Cursor `user-lucy-tencent-cloud`——**仅本机标签，随客户端而异**，不作 SOT |
| WebUI 凭据文件 | `/Users/forrest/Nutstore Files/AI Workspace/97-账号信息/rds&lucy webui.txt`（路径固定；**段标题／账号 id 由首跑核实后写入 fixtures，不在设计里写死段结构**） |
| Web owner 登录 id | 跑次填写（首跑从凭据文件核实；示例可能与数据面 Role 同名，必须分列登记） |
| 业务用户 id | 跑次填写；至少 1 个；不写密码 |
| MCP 凭据（管理员面） | 文件路径（只写路径）；绑定**测试 Agent A ＋ Role**（对照面可为 `lucy_admin` 或其它宽 Role）；跑次记 Agent id／Role id／到期日，**不记 token** |
| MCP 凭据（业务面） | 另一文件路径或同文件另一条目；绑定 **Agent B ＋ 收窄 Role**；与 A **不得**共用同一 Bearer |
| 公网可见连接／源 | 跑次由 `lucy_catalog` 实测写入 fixtures／跑次（仓库无权威清单） |
| RDS（可选） | 主机／端口／账号 id；**禁写口令** |

### 禁写与回退

- 禁写：密码、token、secret 正文、客户生产口令。
- 桌面 `lucy-cloud-login.txt`：**不以「近似同名文件」自动顶替**；缺失时以 Nutstore 路径为准，须人工确认，不得静默改用其它桌面文件。
- **首跑必做**：核实凭据文件实际结构，回写 `fixtures.md`（段标题、Web owner id、业务用户 id、两条 MCP 凭据路径）。

### 认证前置

`GET /api/auth/status` → `mode="required"`，否则整波 `ENV-BLOCKED`（模式不符 ≠ 产品 FAIL）。

## 5. 固定用例

### 实例状态三态（R0／增量共用）

| 态 | 条件 | 增量槽 | 套件最高判定 |
|---|---|---|---|
| **已含候选面** | 实例 `gitSha`（及可得的镜像身份）与本轮候选三元组对齐 | 逐条测新增行为面 | 可达 `PASS` |
| **实例落后** | 实例身份 ≠ 候选（常见于「发客户包前」而公网尚未升级） | 记 `DEFERRED（实例落后）`；两侧身份写入跑次 | **`PASS WITH GAP`**；**不得**记 `PASS` |
| **不可达** | 连接拒绝／health 不可用／认证模式不符 | 不跑 | `ENV-BLOCKED` |

### 用例表

| ID | 必做／可选 | 步骤摘要 | 期望 |
|---|---|---|---|
| `UAT-CLOUD-R0` | 必做 | 打开登录页；`GET /api/health`；记录实例 `lucyVersion`／`gitSha`／`data.status`；记录本轮候选**三元组**（提交＋镜像 digest＋包 SHA256 若已封包）；判定上表三态 | 可达且 `data.status="ok"`（`degraded` → FAIL 或注明后按约定）；**R0 ≠ G4c／G4d**（G4c／G4d 仍在构建宿主对候选 tar 执行） |
| `UAT-CLOUD-01` | 必做 | **owner Web 登录 id** 登录（非「Role＝lucy_admin」语义） | 已登录；owner 专属管理面可开 |
| `UAT-CLOUD-02` | 必做 | 至少 1 个业务用户 Web 登录 | **仅**证明能登录（控制面）。可选加验：若该账号为 `operator`，不具备 owner 专属写路径（账户管理／委托签发）。**不做**「菜单／源列表窄于管理员」——WebUI 无此产品行为 |
| `UAT-CLOUD-03` | 必做 | 用 Agent A 建 MCP session：`lucy_catalog` → 钉定四元组的最小 `lucy_query` | 见下「最小问数」；成功；不编造数据 |
| `UAT-CLOUD-04` | **必做（业务对照）** | **双会话**：Bearer A 与 Bearer B 各建独立 session；分别 `lucy_catalog`／只读抽检；对比可见连接／源 | B 面严格不宽于 A；**禁止同 session 对比两角色**。缺 B 凭据 → `CRED-BLOCKED` 或（委托人已批可选时）`PASS WITH GAP` 并上报 |

### 最小问数（`UAT-CLOUD-03`）

跑次／fixtures 钉死四元组：**连接 id ＋ 源 ＋ 度量 ＋ 原样问句**。  
问句须避开歧义词；若命中 `source_ambiguity_gate`，属**执行者选词不当**：改用钉定问句重试**一次**，仍失败才记 `ASSERT-FAIL`。

## 6. 增量 MCP 槽

| 规则 | 说明 |
|---|---|
| 用例族 | `UAT-CLOUD-NEW-*`（跑次内编号） |
| 「新增」定义 | **仅行为面**：新 MCP tool／新必填参数行为／新门闩。**不含** initialize instructions 措辞改动（可登记，不触发增量必测） |
| 基线 | 以**本轮候选包**为准；「上一已发／拟发客户包」仅作 diff 参考；跑次写 git range |
| 跑次必填 | 本轮增量清单 + 每条**最小证据三件套**（见下） |
| 无新增 | `N/A` 必须写：基线包 tag＋digest、diff 范围、diff 结论；缺任一 → 不得 N/A（记 BLOCKED）。本轮确有新增却写 N/A → `FAIL`（登记不实） |
| 实例落后 | 增量 `DEFERRED`；套件不得 `PASS`（见 §5 三态） |
| 与本机关系 | 本机功能合同已测**不免除**公网最小烟测 |

### 最小证据三件套（每条增量必填，不可留空）

1. **调用凭证**：工具名＋脱敏参数摘要＋调用时间  
2. **响应**：关键字段摘录或结构化错误码  
3. **存在性判定**：存在 → PASS；不存在（实例落后）→ DEFERRED；存在但报错 → FAIL  

建议增量清单默认由 `git diff` 机械生成后再人工筛（proxy／MCP spec 等路径），筛除理由写入跑次。

## 7. 套件级判定

### 优先级（唯一出口）

`CRED-BLOCKED`／`ENV-BLOCKED` ＞ `FAIL`（含 `PRODUCT-FAIL`／`ASSERT-FAIL`）＞ `PASS WITH GAP` ＞ `PASS`

| 结果 | 条件 |
|---|---|
| `PASS` | 实例**已含候选面**；固定层全绿；增量全绿或带证据的 N/A |
| `PASS WITH GAP` | 固定层绿＋增量 `DEFERRED（实例落后）`；或委托人已批的可选业务对照跳过且已写明 |
| `FAIL` | 固定／增量断言失败或产品／协议类失败（须写理由；**不**自动挡出包） |
| `CRED-BLOCKED` | 401／403／token 撤销／账号停用／凭据过期 → **停表；禁止换 token 再试掩盖**；上报委托人重签 |
| `ENV-BLOCKED` | 实例不可达／`auth.mode≠required`／health 不可用 → 停表待环境；附「已上报委托人／日期／授权或待批」 |

约定遵循 [`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)。

## 8. 发客户包前软检查表（写入 Runbook）

1. 云端入口可达：`http://124.222.172.229:5174/login`  
2. 跑次已记候选**三元组**＋实例身份，并判定 §5 三态；**并行候选**时写明对应哪一个 digest  
3. 固定层 `UAT-CLOUD-R0`…`04` 已全真执行（04 按必做／已批可选执行）  
4. 增量层：已按 §6 填清单＋最小证据三件套，或带证据的 N/A／DEFERRED  
5. 执行者已交 `runs/`；**验收者**已更新 INDEX（未验收前 INDEX 结果为 `—`）  
6. 若 FAIL／BLOCKED／GAP：跑次有原因；出包说明引用落点＝**S-CLOUD-1 行备注**（v2 清单仅参见，不重复写结论）  
7. **候选重建**（同 tag 新 digest）→ 本跑次作废，须重跑  
8. **凭据轮换**→ 旧跑次标 `STALE（凭据轮换）`，须以新凭据重跑；**不得**沿用上一包结论  

## 9. Checklist 挂钩文案（落地时原文）

在 `customer-amd64-image-build-checklist.md` 增加**独立小节**（标题明示不在「缺一步不得出包」适用范围）：

> ### 附：软证据（不在「缺一步不得出包」适用范围）
>
> **S-CLOUD-1（软证据）**：发放客户包前，按 [`lucy-cloud-enterprise-smoke.md`](../runbooks/lucy-cloud-enterprise-smoke.md) 跑 `UAT-SUITE-CLOUD-ENTERPRISE-SMOKE`，由验收者更新 INDEX 留跑次。FAIL／BLOCKED／PASS WITH GAP 须写理由并在本行备注引用跑次链接；**不**替代 **G2–G4d＋G8＋H3–H5＋K6**，也**不**因本项失败而禁止 `docker save`。

`customer-v2-upgrade-release-checklist.md`：仅加非编号「参见 S-CLOUD-1／公网精简套件」一句，不进 C01–C20。

## 10. 落地范围（定稿后另批实现）

1. 新增 Runbook `docs/runbooks/lucy-cloud-enterprise-smoke.md`  
2. 新增 UAT 树 `docs/qa/uat/suites/cloud-enterprise-smoke/{suite,cases,fixtures}.md` + `runs/README.md`  
3. `docs/qa/uat/INDEX.md` 增行（最近跑次先 `—`）  
4. `docs/qa/uat/README.md` 套件表同步  
5. `docs/qa/uat/CONVENTIONS.md` 前缀表增 `UAT-CLOUD-*`（**必做**；注明与共享 `UAT-R0` 关系）  
6. `docs/governance/e2e-ledger.md` 勾连行  
7. amd64 checklist 独立软小节 S-CLOUD-1；v2 清单参见句  
8. **不改**出包脚本退出码；**不改**运行产品代码；**不**把本套件结果写入 P0 六套件  

## 11. 对抗关闭核对（相对 R1／R2「落地前必须关闭」）

| # | ID | v0.2 落点 |
|---|---|---|
| 1 | B1 | §2／§4／§5：Web 登录≠`lucy_admin` Role；分列登记 |
| 2 | B2 | §5 三态；增量 DEFERRED → 套件不得 PASS |
| 3 | M1 | §4 MCP 凭据路径两行 |
| 4 | M2 | §5 CLOUD-04 双会话 |
| 5 | M3 | §5 CLOUD-02 仅登录事实 |
| 6 | M4 | §5 04 必做；§7 优先级＋BLOCKED 上报 |
| 7 | M5 | §1／§3／§10 e2e-ledger |
| 8 | M6 | §3 角色分工；§8 验收写 INDEX |
| 9 | M7 | §4 不写死段结构；首跑核实 |
| 10 | M8 | §6 行为面定义；N/A 证据 |
| 11 | M9 | §9 独立软小节；硬门禁集合对齐；R0≠G4c／G4d |
| 12 | R2-N1 | §2／§5／§8 三元组；重建作废 |
| 13 | R2-N2 | §7 失败分类；禁换 token 掩盖 |
| 14 | R2-N3 | §7 CRED-BLOCKED；§8 STALE |
| 15 | R2-N4 | §5 最小问数四元组 |
| 16 | R2-N5 | §6 最小证据三件套 |

## 12. 设计自检

- [x] 无未定义口径的占位；允许跑次填写的字段已在 §4／§5 标明  
- [x] 与本机 P0／客户硬门禁无矛盾双写；软硬分区清楚  
- [x] 硬边界在 §1／§7 复述  
- [x] 凭据只路径；Web 登录 id／MCP Role／RDS 不混  
- [x] 增量行为面＋N/A／DEFERRED 有证据规则  
- [x] 范围克制：无脚本硬失败、无 0.30 功能总账强制行；有 e2e-ledger 勾连  
- [x] R1／R2 十六条必关项已对照关闭  

---

**设计定稿 v0.2（2026-11-14）。** 落地 Runbook／UAT／checklist 须委托人另发实现授权后再开落地 Plan。
