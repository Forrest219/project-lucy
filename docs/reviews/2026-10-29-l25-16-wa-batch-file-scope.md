# L25-16 W-A 批次：工作树影响面清单与提交纪律

| 元数据 | 内容 |
|---|---|
| 文档类型 | 事实清单（实现批次的影响面取证），不是 Spec、不授权实现 |
| 日期 / 测量时刻 | 2026-10-29 09:35（行数为该时刻 `git diff --numstat` 实测快照） |
| 对象 | L25-16 运维控制面 MCP（`lucy_ops_*`）W-A 实现批次（连接表配置 + 源表导入，S1–S4） |
| 触发 | PM 指令「检查本进程进展」后核实外部执行器（`claude -p` 无头进程，PID 13252）的产出与归属 |
| 结论 | **批次影响面远大于 `webui/server/ops/` 目录**：另触及 **14 个既有文件**；另有 **2 个文件归属混杂**（既是本批次产物，又被其它并发会话在 2026-10-29 09:30–09:31 继续改动）⇒ **共享工作树内无法做行级归属，提交必须按文件范围显式 `git add`，禁止 `git add -A`** |
| 口径 | Spec v1.2／Plan v0.10、G1–G38、VOPS-01–78（**全部未执行**）、W-A 已授权实现 S1–S4、**D8 与 L25-15 S0 已由 PM 于 2026-10-29 签下**（D8 = (b) 显式批次交接；S0 = (a) 单独立项修既有路径，须另立工作项）、第 8 轮独立复审未做 |

---

## 1. 为什么不能用 mtime 判定归属

执行器窗口为 **2026-10-29 01:00:34 – 01:46**（`inbox/l25-16-wa-claude-log.txt`：`01:43:46` 最后写盘，`01:46` 写入 `EXIT:1`，死因 `API Error: Request rejected (429) · Token Plan 用量上限 (2067)`）。

工作树内 **40 余个已跟踪文件的 mtime 完全相同（`01:09:58`）**——这是某次批量恢复操作留下的痕迹，**不是**逐个编辑的时间戳。因此：

- ❌ **mtime 对这批文件无区分力**；
- ✅ **唯一可靠判据是 diff 内容**（是否含 L25-16 的实现标记：工具名、`allow.ops`、`control-plane`、`delegated_from`、`OpsGrant` 等）。

本清单按内容判据得出，并另用 mtime 区分「窗口内写盘」与「窗口外仍在变动」两类。

---

## 2. 新增文件（17 个，未跟踪）

| 路径 | 行数 | 说明 |
|---|---|---|
| `webui/server/ops/control-plane.ts` | 93 | 工具登记表（单一事实源） |
| `webui/server/ops/ops-outcome.ts` | 181 | 状态模型；**`aggregateOperationState` 唯一定义点（`:160`）** |
| `webui/server/ops/ops-grants.ts` | 218 | 授权判定（逐对象完整匹配） |
| `webui/server/ops/ops-delegation.ts` | 56 | 委托身份 |
| `webui/server/ops/ops-envelope.ts` | 48 | 入参形状适配 |
| `webui/server/ops/ops-locks.ts` | 157 | 锁顺序封装 |
| `webui/server/ops/ops-audit.ts` | 247 | 审计行写入 |
| `webui/server/ops/ops-idempotency.ts` | 486 | 业务幂等存储（`getAuditDb()`，同库 `audit.sqlite`） |
| `webui/server/ops/ops-recovery.ts` | 364 | G34 文件写窗口最小恢复协议 |
| `webui/server/ops/ops-manifest-groups.ts` | 111 | Manifest / Overlay 共享文件分组 |
| `webui/server/ops/ops-ktx-batch.ts` | 543 | 连接表批量（整批全成或全拒） |
| `webui/server/ops/ops-source-batch.ts` | 684 | 源表导入批量（组间可部分成功） |
| `webui/server/ops/ops-batch.ts` | 875 | 批次编排与聚合 |
| `webui/server/ops/ops-tools.ts` | 305 | MCP 工具描述与调用入口 |
| `webui/server/ops/__tests__/ops-authorization.test.ts` | — | 测试（**未运行**） |
| `webui/server/ops/__tests__/ops-delegation.test.ts` | 115 | 测试（**未运行**） |
| `webui/server/ops/__tests__/ops-outcome.test.ts` | 117 | 测试（**未运行**） |

另有 `webui/server/enabled-tables.ts`（**290 行，新文件**）——从 `index.ts` 抽取的 ktx.yaml 校验与 patch 逻辑，供 WebUI 与控制面**共用同一套**实现（避免两套 patch 逻辑分叉）。

> `webui/server/ops/call-monitor.ts`（21 行）是**该目录既有的非本批次文件**，已跟踪，不计入。

---

## 3. 既有文件改动（14 个，写盘在执行器窗口内）

| 文件 | 行数 | 本批次改动性质 |
|---|---|---|
| `webui/server/proxy/acl.ts` | +129 / -7 | 控制面工具分类分支（**先于** `lucy_` 前缀分支，符合 Spec 冻结边界） |
| `webui/server/proxy/mcp-proxy.ts` ⚠️ | +125 / -1 | 控制面工具由代理**本地**服务；工具可见性只看 `role.allow.ops` |
| `webui/server/admin/roles.ts` | +138 / -28 | 新增 `allow.ops` 授权维度 |
| `webui/server/admin/agents.ts` | +117 / -3 | 委托身份（`user.delegated_from`） |
| `webui/server/admin/audit.ts` | +54 / -10 | 审计执行主体 `mcp_control_plane` |
| `webui/server/admin/access-config.ts` | +24 / -5 | `access.yaml` 的 `allow.ops` schema 解析 |
| `webui/server/admin/mcp-tools.ts` | +4 / -1 | 工具目录登记两个 `lucy_ops_*` 工具 |
| `webui/server/admin/tokens.ts` | +8 / -1 | `user.delegated_from` 透传 |
| `webui/server/auth/guard.ts` | +36 / -0 | 委托授权规则 8（仅提升 owner-only 操作与审计归因） |
| `webui/server/proxy/identity.ts` | +15 / -0 | 委托身份字段 |
| `webui/server/project.ts` | +38 / -3 | 写集合说明（连接表写集宽于 `ktx.yaml`） |
| `webui/server/index.ts` | +23 / -194 | **抽取式重构**：YAML patch 逻辑搬到 `enabled-tables.ts`（`escapeRegExp`／`lineIndent`／`findYamlBlockEnd`／`assertProposedKtxYaml`／`patchConnectionEnabledTablesYaml` 等移出）。**-194 不是功能删除**，`previewSourceYamlImport` 等既有导出仍存在（`semantic-layer.ts:959`、`index.ts:89,768`） |
| `webui/server/table-yaml-history.ts` | +126 / -0 | **纯新增** `createTableYamlVersionSnapshotDeferred`（G27：裁剪延后到组终结之后），未删任何既有行 |
| `webui/server/semantic-layer.ts` ⚠️ | +103 / -24 | N05 / G17：旧源表导入入口接入**同一把** `ktx.yaml` 写锁 |
| `scripts/lint-spec.mjs` | +53 / -2 | `allow.ops` schema 校验 + 控制面工具登记表与 `ops/control-plane.ts` 交叉核对 + 禁止用 `allow.tools` 授予控制面工具（**收紧，非放宽**） |
| `webui/config/access.yaml.example` | +3 / -0 | 两条进 `defaults.known_tools`（工具名目录），**不是** `allow.tools` 授权 |

---

## 4. 归属混杂（2 个）——提交时的真实风险点

| 文件 | 混杂情况 |
|---|---|
| `webui/server/proxy/mcp-proxy.ts` | 写盘 mtime **2026-10-29 09:30:38**（执行器窗口外）——本批次内容仍在，但**在 09:30 被其它并发会话继续改动** |
| `webui/server/semantic-layer.ts` | 写盘 mtime **2026-10-29 09:31:14**（执行器窗口外）——同上 |

⇒ 这两个文件里**本批次的行与其它会话的行已混在一起**，共享工作树内**无法做行级归属**。实测证据：09:29 与 09:31 两次测量，`semantic-layer.ts` 的 numstat 从 `+82/-10` 变为 `+103/-24`。

**处置**：

- 这两个文件**不应由实现方单独提交**，应先与并发会话对齐、或等并发会话落盘后再一次性提交；
- 若必须单独提交，需由实现方逐 hunk 复核后用 `git add -p` 挑拣，**并把挑拣结果写进实施记录**。

---

## 5. 明确**不属于**本批次的文件（防止误归因）

`webui/docs/149-ops-evidence-connection-spec.md`、`webui/docs/plans/wo-202609-25-ops-evidence-connection.md`、`webui/docs/README.md`、`webui/docs/00-product-terminology-standard.md`。

这些文件里的 `ops` 指**运维问数连接**（`lucy-ops` 连接、`lucy_ops_reader`），是**另一个条目**，与 L25-16 的 `lucy_ops_*` 控制面工具无关。关键词检索会命中，**不得计入 L25-16 批次**。

---

## 6. 提交纪律

1. **禁止 `git add -A`／`git add .`**：工作树内另有 40 余个文件属其它并发会话（L25-09 审计增量、L25-14 行权限、L25-13 Wiki 访问、L25-15 语义恢复等），一次全量暂存会把它们全部裹进本批次的提交。
2. **按 §2／§3 清单逐路径 `git add <path>`**；§4 的两个文件按上述处置单独决定。
3. **提交必须配套实施记录**（`docs/reviews/` 下的实施记录文档）＋ 对应 VOPS 证据，缺一不得宣称实现完成。
4. **代码存在 ≠ 实现完成 ≠ 已验收**：本批次测试文件已写但**从未运行**；`tsc --noEmit` 下 `server/ops/` 零类型错误只证明**中断未留下语法断裂**，**不构成任何验收证据**。

---

## 7. 未取证声明

- VOPS-01–78 **全部未执行**，本条目**不产生**任何验收证据；
- 实现批次**未提交**（全部为未跟踪／未暂存状态）；
- 本条目只做**只读**取证与归属判定，未修改任何实现代码，未运行任何测试。
