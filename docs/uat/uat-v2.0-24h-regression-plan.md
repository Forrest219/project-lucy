# lucy-v2.0 近 24H 提交分批 UAT 测试计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | lucy-v2.0 近 24H 提交分批 UAT 测试计划 |
| 文档类型 | UAT Plan / Test Cases |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-13 |
| 分支 | `lucy-v2.0` |
| 覆盖区间 | `f63807a`（10-11 18:57，上一版镜像基线）→ `623456a`（10-13 00:24，HEAD） |
| 提交总数 | 25 |
| 委托人 | Forrest |
| 基于材料 | `git log --since="24 hours ago"`；`docs/qa/e2e-sop.md`；`docs/qa/suite-user-journey.md`；`docs/governance/test-layers-and-release-gates.md`；`docs/governance/DEVELOPMENT.md` |
| 适用范围 | 对上述 25 个提交做真实浏览器 UAT 验收；不含单测 / 门禁覆盖率评估 |
| 输出位置 | 本计划 `docs/uat/`；证据与截图 `inbox/uat-v2.0-24h/` |

## Terminology Compliance

本计划遵循 `webui/docs/00-product-terminology-standard.md`。

| 概念 | UI 主术语 | 英文辅助 | 禁止文案 |
|---|---|---|---|
| 分批 UAT | 分批 UAT | batched UAT | 把 6 个批次一次性串跑 |
| 截图槽位 | 截图槽位 | screenshot slot | 「截图可选」「必要时补图」 |
| 浏览器控制 | 浏览器控制 | browser control | 用 `curl` 代替浏览器断言后报 Pass |
| 失败即停 | 失败即停 | fail-stop | 必看项不满足仍继续并记 Pass |
| blocked | blocked | blocked | 环境不可用记 Pass |

本计划不新增产品概念。用例中的按钮 / 导航 / Toast 文案以 `webui/src` 现行为准。

---

## 1. 本计划证明什么

对这 25 个提交，逐批在**真实浏览器**里走用户可见路径，每一步都留下**指定截图槽位**的证据，最后产出带截图索引的批次报告。

**不证明**：单测覆盖率、`npm run smoke:*` 门禁结果、KTX 运行时兼容性、eval 口径 gold。那些仍走 [`docs/governance/test-layers-and-release-gates.md`](../governance/test-layers-and-release-gates.md) 三层模型。

### 1.1 两条不可协商的规则

| 规则 | 内容 | 违反后果 |
|---|---|---|
| **R1 浏览器优先** | 主执行器是**浏览器控制**（会话内 Browser，Electron 右侧 FilePanel）。`curl` / `npm` 门禁只能作为**辅助证据**补充，**不能**替代浏览器断言后判 Pass。每条用例必须真正在浏览器里点过、看见过。 | 该用例记 blocked，整批不通过 |
| **R2 截图不可分割** | 每条用例的每个「截图槽位」必须有一张**真实页面截图**。**报告缺任一槽位截图 = 该报告无效**，对应批次判定为 blocked，不得记 Pass、不得进入下一批。截图不是报告的附录，是报告的组成部分。 | 报告作废，批次重跑 |

R2 的判定是硬的：不是「截图不全扣分」，而是「不全即无效」。

---

## 2. 提交 → 批次映射

25 个提交按**变更面**聚成 6 个批次。批次之间按依赖排序：批次 0 必须先过，之后 1→5 可按顺序跑，批次 6 收口。

| 批次 | 主题 | 提交数 | 提交 | 主要变更面 |
|---|---|---|---|---|
| **B0** | 环境重建与基线 | —（前置） | 无 | 镜像重建、健康基线、证据目录初始化 |
| **B1** | 接入向导与连接配置 | 9 | `0127691` `b49c088` `0e28cc9` `2987282` `4fa70f1` `aaf867b` `582d35f` `e4d1599` `b05fadf` | `/connections`、`/connections/enabled-tables`、添加 Schema 抽屉、接入向导 Step2/Step5 |
| **B2** | Agent 角色集与角色连接授权 | 3 | `fdbd000` `1a8c80e` `a3ba6be` | `/admin/agents`、`/admin/roles` |
| **B3** | Skill / Wiki 开放访问（Spec 170） | 7 | `b8beb4a` `5cef765` `1b265f8` `06d7490` `8816bea` `24ef555` `623456a` | `/skills`、`/admin/roles` 工具授权、`/admin/audit`、MCP Proxy 工具面 |
| **B4** | 使用概况与调用监控降噪 | 2 | `5782300` `bb67095` | `/admin/usage`、`/ops/calls`、治理总览 |
| **B5** | 运行时护栏与发布校验 | 4 | `0fe14a2` `7516cd0` `0228771` `d5ca16c` | `/publish/workbench`、MCP Proxy live path、Docker 构建参数 |
| **B6** | 跨批回归收口 | —（收口） | 无 | 主链路回归 + 报告汇总 |

### 2.1 为什么这么切

- **B3 风险最高，单独成批**：`b8beb4a` 把「已发布 skill 与 wiki 对所有 resolved agent 开放」，同时 `5cef765` 从控制台删掉 skill/wiki 对象授权。**权限语义变更**，放最后单独验，失败不污染其他批次结论。
- **B1 提交最多但互相独立**：9 个提交都是 `/connections` 与接入向导的交互改造，彼此不共享权限语义，可在一个环境里连续验。
- **B2 与 B3 都动 `/admin/roles`**，但 B2 动的是**连接授权**、B3 动的是**工具授权**，断言点不同，分开写避免用例互相掩盖。

---

## 3. 批次 0：环境重建与基线（前置，不可跳过）

### 3.1 为什么必须先做

当前运行的 demo 栈**不包含这 25 个提交中的任何一个**：

| 事实 | 值 |
|---|---|
| `project-lucy:demo` 镜像构建时间 | `2026-10-12T06:31:38Z`（北京 10-12 14:31） |
| 构建时仓库 HEAD | `f63807a`（10-11 18:57 `feat(proxy): slow-call signal...`） |
| 当前 HEAD | `623456a`（10-13 00:24） |
| 结论 | B1–B5 全部 UI 断言在旧镜像上跑会**假阴性或假阳性**，无意义 |

### 3.2 平滑升级硬约束（不可协商）

**本批次只做平滑升级，不清空、不重置。**

| 约束 | 内容 |
|---|---|
| **禁止 `--fresh`** | 任何形式的 zero-state reseed / 清空 `/data/lucy`。`upgrade-lucy.sh` 默认即 `mode=preserve`，**不得**传 `--fresh`。 |
| **必须备份** | 升级前打 tar 备份，落在 `inbox/backups/`，便于回滚与前后比对。 |
| **必须保留校验** | 依赖脚本内置 preserve marker 前后比对，输出须为 `preserved=true`；**不得**用 `--skip-preserve-check` 绕过。 |
| **必须前后对比** | 升级后逐项核对 B0-3 记录的存量资产仍在，见 §3.5。 |

**为什么必须平滑升级（技术原因，非偏好）**

`8816bea` 新增的 `patch_lucy_admin_tools()` 是 entrypoint 里的**幂等迁移补丁**，只在
**存量卷**上才有意义：它要求 `${PROJECT_ROOT}/webui/config/access.yaml` 已存在，且
`sync_context_from_template` 只同步 `semantic-layer` / `wiki` / `skills` / `evals`，
**不同步 `access.yaml`**。

```text
清空重建 → seed 直接写入新模板 access.yaml（工具已齐）→ 补丁 inserted=0 空跑 → 该提交零覆盖
平滑升级 → 保留旧 access.yaml → 补丁实际补工具 → 这才是 8816bea 的真实路径
```

也就是说，**清空重建会让 B3-06 变成空测**，同时也让所有存量资产丢失。

### 3.3 步骤

| # | 操作 | 必须看见 | 截图槽位 |
|---|---|---|---|
| B0-1 | 确认无残留容器：`docker ps --filter ancestor=project-lucy:demo` | 只剩 `compose-lucy-1`；`quirky_booth` 是一次性调试残留（跑着 `find skills`），应清理 | — |
| B0-2 | **记录升级前状态**：`docker exec compose-lucy-1 cat /data/lucy/webui/config/access.yaml` + `GET /api/admin/agents` + 角色清单，落 `inbox/uat-v2.0-24h/b0/before/` | 存量角色清单含 **`chatbi-analyst`**（模板里没有、只存在于本卷）；`lucy_admin.connections` 为 `- demo-mysql`（`a3ba6be` 之前的显式写法） | `B0-2a-before-access-yaml.png`、`B0-2b-before-roles.png` |
| B0-3 | 备份：`npm run demo:rebuild -- --backup-dir inbox/backups`（**不得加 `--fresh`**） | 脚本输出 `mode=preserve`；产生 `inbox/backups/lucy-data-*.tgz`；尾部 `[lucy-upgrade] ok volume=... preserved=true` 与 `[lucy-demo] ok image=linux/arm64 ...` | `B0-3-smooth-upgrade-log.png`（终端输出截图） |
| B0-4 | 校验镜像时间戳已晚于 HEAD 提交时间 | `docker image inspect project-lucy:demo` 的 `Created` > `2026-10-13 00:24` | — |
| B0-5 | **核对存量资产未丢**（平滑升级是否真的成功，见 §3.5） | `chatbi-analyst` 角色仍在；`demo_agent` 及其 token 仍在；审计记录仍在；`lucy_admin` 仍 `catalog_bound` | `B0-5a-after-roles-preserved.png`、`B0-5b-after-access-yaml.png` |
| B0-6 | 浏览器打开 `http://127.0.0.1:55176/`，登录页若出现则处理；确认进 `/overview` | 侧边栏 6 组导航齐全；系统概览健康卡片为绿 | `B0-6-overview-baseline.png` |
| B0-7 | 建立证据目录 `inbox/uat-v2.0-24h/b0..b6/` | 目录存在 | — |

### 3.4 通过标准

- B0-3 输出 `mode=preserve` 且 `preserved=true`；B0-4 时间戳校验通过。**这两条是硬门禁**，不通过则 B1–B6 全部 blocked。
- B0-5 存量资产逐项在位（**这是平滑升级本身的验收项**，不通过说明升级破坏了数据，停止并回滚）。
- B0-6 浏览器可达 `/overview` 且无红色降级标记。
- 管理台 API 处于开放模式（本机 demo 无登录账户）：`GET /api/admin/agents` 返回 `200`。若已被配置登录账户，先走 `/api/auth/status` 判定，再决定登录或记 blocked。

### 3.5 存量资产保留核对表

升级后逐行核对，任一缺失即判 B0 FAIL 并回滚：

| # | 存量项 | 依据 | 保留则 |
|---|---|---|---|
| 1 | `chatbi-analyst` 角色 | 只存在于本卷，模板无 | 平滑升级正确 |
| 2 | `demo_agent` 用户 + 其 token | B0-2 before 快照 | 平滑升级正确 |
| 3 | 审计记录 | `/admin/audit` 有历史条目 | 平滑升级正确 |
| 4 | `lucy_admin.connections` | 仍为 `- demo-mysql` | **正常**：服务端 `resolveCatalogConnections` 对 `lucy_admin` 直接返回全部已启用连接，不依赖 YAML（见 B2-04） |
| 5 | `lucy_admin` 的 5 个 post-seed 工具 | `sl_validate` / `lucy_skill_search` / `lucy_skill_read` / `lucy_certified_route` / `lucy_report_template` | **注意**：本卷已含这 5 项，补丁会 `inserted=0` 空跑 —— B3-06 须按 §6.3 单独构造前置态再验 |

---

## 4. 批次 1：接入向导与连接配置

**涉及提交（9）**：`0127691` `b49c088` `0e28cc9` `2987282` `4fa70f1` `aaf867b` `582d35f` `e4d1599` `b05fadf`
**变更路由**：`/connections`、`/connections/enabled-tables`、添加 Schema 抽屉、接入向导 Step2 / Step5

### 4.1 用例

| ID | 操作 | 定位 | 必须看见 | 截图槽位 |
|---|---|---|---|---|
| **B1-01** | 连接概览卡片收敛 | `/connections` | `b49c088`+`0127691`+`0e28cc9`：卡片无每卡运行时条；健康摘要可点开连通性测试 | `B1-01a-overview-card.png`、`B1-01b-connectivity-test.png` |
| **B1-02** | 新增 Schema 后读取表结构 | `/connections` → 添加 Schema | `4fa70f1`：加完 schema 后出现「下一步：读取表结构」引导 | `B1-02a-after-add-schema.png`、`B1-02b-structure-prep.png` |
| **B1-03** | 目录有候选时下线手工录入 | 同上 | `2987282`：catalog 有候选时**看不到**手工输入框 | `B1-03-no-manual-entry.png` |
| **B1-04** | Manifest 缺失提示置顶 | `/connections/enabled-tables` | `aaf867b`：缺失 Manifest 的提示在启用表列表**上方**，不是底部 | `B1-04-missing-manifest-on-top.png` |
| **B1-05** | 大表列表按 schema 折叠 | 同上 | `582d35f`：表多的 schema 分组折叠，默认收起，展示每组表数 | `B1-05a-collapsed-by-schema.png`、`B1-05b-expanded.png` |
| **B1-06** | 启用表状态筛选 | 同上工具条 | `b05fadf`：工具条出现状态筛选；选「已启用」后只留已启用表 | `B1-06a-filter-toolbar.png`、`B1-06b-filtered-result.png` |
| **B1-07** | 接入向导写作提示 | 接入向导 Step2 上传 Manifest | `e4d1599`：出现 authoring how-to 提醒，文案可读不遮挡表单 | `B1-07-step2-howto.png` |
| **B1-08** | 接入向导 Step5 Wiki 提示 | 接入向导 Step5 业务 Wiki | `e4d1599`：Step5 同样出现写作提示 | `B1-08-step5-howto.png` |

### 4.2 通过标准

- 8 条用例全 PASS，且 **12 个截图槽位全部有图**（R2）。
- `B1-03` 是负向断言：必须截图证明手工录入框**不存在**，不能只写「没找到」。
- B1-05 折叠状态需前后各一张，证明交互生效而非静态样式。
- 失败即停：任一「必须看见」不满足 → 该用例 FAIL，停止本批，不继续点后续步骤。

---

## 5. 批次 2：Agent 角色集与角色连接授权

**涉及提交（3）**：`fdbd000`（保存角色集而非单角色）、`1a8c80e`（要求两个 Agent 角色）、`a3ba6be`（`lucy_admin` 跟随所有已配置连接）
**变更路由**：`/admin/agents`、`/admin/roles`

### 5.1 用例

| ID | 操作 | 定位 | 必须看见 | 截图槽位 |
|---|---|---|---|---|
| **B2-01** | Agent 详情页显示角色集 | `/admin/agents` → 任一 Agent 详情 | `fdbd000`：角色字段是**多选集合**，不再是一个单值下拉 | `B2-01a-list.png`、`B2-01b-detail-multiselect.png` |
| **B2-02** | 保存多个角色并回读 | 同上，勾选 ≥2 个角色后保存 | 刷新页面后角色集合**完整保留**（不只保留一个、不丢一个） | `B2-02a-two-selected.png`、`B2-02b-after-reload.png` |
| **B2-03** | Agent 列表页角色列渲染多角色 | `/admin/agents` | `1a8c80e`：列表行展示多角色，不塌成空或单值 | `B2-03-list-roles.png` |
| **B2-04** | `lucy_admin` 跟随所有已配置连接（**行为断言**） | `/admin/roles` → `lucy_admin` + 新增一条连接后回看 | `a3ba6be`：在**存量卷**上 `lucy_admin.connections` 仍是 `- demo-mysql`，但**服务端** `resolveCatalogConnections` 对 `lucy_admin` 返回全部已启用连接——新增连接无需改 allow 列表即可纳入 | `B2-04a-role-detail.png`、`B2-04b-new-connection-followed.png` |
| **B2-05** | API 层复核角色集 | 浏览器 Network 面板 + 辅助 `GET /api/admin/agents` | Agent 记录里角色字段是**数组**，非字符串 | `B2-05-network-payload.png` |

### 5.2 通过标准

- 5 条全 PASS，**8 个截图槽位**齐全。
- **B2-02 是本批核心**：必须证明「保存 → 刷新 → 仍一致」，只截保存成功 Toast 不算数。
- B2-05 需截浏览器 Network 面板中的响应体，证明是浏览器真实拿到的数据，非 curl 补证。
- **B2-04 不得读 YAML 下结论**：`a3ba6be` 是**服务端**实现（`proxy/acl.ts` 的 `resolveCatalogConnections` 对 `lucy_admin` 直接返回 `[...enabledByConnection.keys()]`，忽略声明值）。存量卷升级后 YAML 仍写 `- demo-mysql` 属**正常**，不是缺陷。断言必须是行为：新加一条连接后 `lucy_admin` 无需改配置即自动纳入。
- `resolveRoleForWrite` 仅在**写入角色**时把 `connections` 收敛为 `["*"]`，并拒绝非 `lucy_admin` 使用 `*`；因此不要把「YAML 是否变成 `\"*\"`」当验收点。

---

## 6. 批次 3：Skill / Wiki 开放访问（Spec 170）——风险最高

**涉及提交（7）**：`b8beb4a`（published skill 与 wiki 对所有 resolved agent 开放）、`5cef765`（控制台移除 skill/wiki 对象授权）、`06d7490`（下线 warehouse/analysis skills）、`8816bea`（存量卷补发 MCP 工具）、`1b265f8` `24ef555` `623456a`（文档与 spec 编号对齐）
**变更路由**：`/skills`、`/admin/roles` 工具授权、`/admin/audit`、MCP Proxy 工具面

### 6.1 用例

| ID | 操作 | 定位 | 必须看见 | 截图槽位 |
|---|---|---|---|---|
| **B3-01** | 角色详情移除 skill/wiki 对象授权 | `/admin/roles` → 任一角色 | `5cef765`：**没有** skill / wiki 对象授权区块；工具授权区仍在 | `B3-01-role-detail-no-object-grant.png` |
| **B3-02** | 工具授权仍可配置 | 同上 | 工具授权仍可勾选并保存，未被误删 | `B3-02-tool-grants-editable.png` |
| **B3-03** | 技能列表页 | `/skills` | `5cef765`+`06d7490`：列表正常渲染；**warehouse / analysis 类技能不再出现** | `B3-03a-skills-list.png`、`B3-03b-retired-absent.png` |
| **B3-04** | 审计页可读 | `/admin/audit` | `b8beb4a`：审计条目可查，skill / wiki 访问有留痕 | `B3-04-audit-entries.png` |
| **B3-05** | **反向验证：受限 Agent 仍能读已发布 skill** | MCP 控制台 `/admin/mcp-playground`，用 `demo_readonly` | `b8beb4a` 核心：权限窄的 Agent 调用 `lucy_skill_search` / `wiki_search` **成功**，不再因对象授权缺失被拒 | `B3-05a-playground-skill-search.png`、`B3-05b-playground-wiki-search.png` |
| **B3-06** | **存量卷工具补发迁移** | 需先构造前置态，见 §6.3 | `8816bea`：entrypoint 日志出现 `[lucy] patched lucy_admin tools (+5)`，且 5 个 post-seed 工具真的写回 `access.yaml` | `B3-06a-entrypoint-patch-log.png`、`B3-06b-tools-written-back.png` |

### 6.2 通过标准

- 6 条全 PASS，**9 个截图槽位**齐全。
- **B3-05 是整批的验收核心**，不可用「工具列表里有这个工具」代替「实际调用成功」。
- B3-01 与 B3-03 含**负向断言**，必须截图证明区块 / 技能**确实不存在**。
- **B3-06 必须先做 §6.3 的前置态构造**，否则是空测（现状：卷内 `lucy_admin` 已含这 5 个工具，补丁会 `inserted=0` 空跑）。
- 本批任一 FAIL，**不进入批次 4**，先修后重跑本批。

### 6.3 B3-06 前置态构造（不做就是空测）

**现状问题**：本卷 `access.yaml` 里 `lucy_admin` **已经**包含 `sl_validate`、`lucy_skill_search`、
`lucy_skill_read`、`lucy_certified_route`、`lucy_report_template`。`patch_lucy_admin_tools()`
是幂等的，遇到已存在的工具会 `inserted=0` 直接退出。此时「升级后工具齐全」是**升级前就成立的事实**，
与 `8816bea` 无关。

**正确做法**：先造一个真实的迁移前状态，再让它被迁移修复。

| 步 | 操作 | 必须看见 |
|---|---|---|
| 1 | 备份：`docker exec compose-lucy-1 cp /data/lucy/webui/config/access.yaml /data/lucy/webui/config/access.yaml.bak` | 备份存在 |
| 2 | 从卷内 `lucy_admin` 的 `tools:` 中移除这 5 项 | `access.yaml` 里搜不到 `lucy_certified_route` |
| 3 | 重启容器触发 entrypoint：`docker compose -f deploy/compose/docker-compose.demo.yml restart lucy` | 日志出现 `[lucy] patched lucy_admin tools (+5)` |
| 4 | 复核 | 5 项全部写回；再 restart 一次应 `inserted=0`（幂等，不重复插入） |
| 5 | 清理 | 删除 `access.yaml.bak`；确认 `chatbi-analyst` 等存量角色未被改动 |

**失败判定**：步 3 没有 `patched lucy_admin tools` 日志，或步 4 未写回 → `8816bea` 的迁移路径失效，记 B3-06 FAIL。
**注意**：步 2 只删 `lucy_admin` 的 5 个工具，**不得**动其他角色或用户。

---

## 7. 批次 4：使用概况与调用监控降噪

**涉及提交（2）**：`5782300`（使用排名与调用监控降噪）、`bb67095`（移除调用监控头部新鲜度与状态徽标）
**变更路由**：`/admin/usage`、`/ops/calls`、治理总览

| ID | 操作 | 定位 | 必须看见 | 截图槽位 |
|---|---|---|---|---|
| **B4-01** | 使用概况页 | `/admin/usage` | `5782300`：排名行视觉降噪，指标卡不喧宾夺主 | `B4-01-usage-page.png` |
| **B4-02** | 调用监控页头部 | `/ops/calls` | `bb67095`：头部**无**新鲜度文案、**无**状态徽标 | `B4-02-calls-header.png` |
| **B4-03** | 治理总览 | 治理总览入口 | `5782300`：MetricCard 密度调整后信息层级清晰，数值不截断 | `B4-03-governance-overview.png` |
| **B4-04** | 窗口序列交互 | `/ops/calls` 切换时间窗口 | 切换窗口后图表与指标同步刷新，无残留旧数据 | `B4-04a-window-default.png`、`B4-04b-window-switched.png` |

**通过标准**：4 条全 PASS，**5 个截图槽位**齐全。B4-04 需前后两张证明切换生效。

---

## 8. 批次 5：运行时护栏与发布校验

**涉及提交（4）**：`0fe14a2`（live path 查询护栏与慢调用标记）、`7516cd0`（发布时拒绝 KTX 不接受的 SQL 列类型）、`0228771`（invest-db 数据问答 UAT 用例）、`d5ca16c`（镜像构建可选 npm registry）
**变更路由**：`/publish/workbench`、MCP Proxy live path

| ID | 操作 | 定位 | 必须看见 | 截图槽位 |
|---|---|---|---|---|
| **B5-01** | 发布校验拒绝非法列类型 | `/publish/workbench`，提交含 KTX 不接受列类型的语义 | `7516cd0`：发布被拒，错误信息**指名列类型问题**，不是泛化失败 | `B5-01-publish-rejected.png` |
| **B5-02** | 查询护栏生效 | MCP 控制台发起超范围查询 | `0fe14a2`：护栏拦截并给出明确 deny 原因 | `B5-02a-guardrail-blocked.png` |
| **B5-03** | 慢调用标记 | `/ops/calls` 观察慢调用 | `0fe14a2`：慢调用有标记，调用监控页可见 | `B5-03-slow-call-mark.png` |
| **B5-04** | invest-db 数据问答 | 参照 `docs/uat/uat-invest-db-data-qa.md` 的 `INV-00` 与至少 1 条场景用例 | `0228771`：连接可用、可问答 | `B5-04-invest-db-qa.png` |

**通过标准**：4 条全 PASS，**4 个截图槽位**齐全。
**说明**：`d5ca16c` 是构建参数变更（`NPM_REGISTRY` 可选传入），属 B0 重建时顺带验证项，不单独占用例；若 B0-2 重建因 registry 失败，记 B5 FAIL。

---

## 9. 批次 6：跨批回归收口

B1–B5 全部跑完后执行，确认改动之间没有互相破坏。

| ID | 操作 | 定位 | 必须看见 | 截图槽位 |
|---|---|---|---|---|
| **B6-01** | 主链路巡检 | `/overview` → `/connections` → `/publish/workbench` → `/publish/history` | 四页均正常渲染，无错误态 | `B6-01a-overview.png`、`B6-01b-connections.png`、`B6-01c-workbench.png`、`B6-01d-history.png` |
| **B6-02** | 导航完整性 | 侧边栏全部 6 组 | 每组展开后条目齐全，**无死链**（`navigation.ts` 本批有改动） | `B6-02-navigation.png` |
| **B6-03** | 术语与翻译防御 | 上述页面 | 无禁用术语；专业英文节点带 `translate="no"` | `B6-03-terminology.png` |
| **B6-04** | 证据完整性自检 | `inbox/uat-v2.0-24h/` | 全部批次截图槽位齐全，**含 B0 在内共 51 张**：B0:6 · B1:12 · B2:8 · B3:9 · B4:5 · B5:4 · B6:7 | `B6-04-evidence-index.png` |

**通过标准**：4 条全 PASS；**51 张截图一张不缺**（分母须含 B0 的 6 张：6+12+8+9+5+4+7=51）。

---

## 10. 浏览器执行规约

### 10.1 工具

| 项 | 约定 |
|---|---|
| 主执行器 | **浏览器控制**（会话内 Browser，Electron 右侧 FilePanel 可见） |
| 辅助 | `curl` / `npm run smoke:*` 仅作辅助证据，**不替代**浏览器断言 |
| 禁止 | 用 curl 判 Pass；只跑 Playwright 而不真机看页面；用单测结果冒充 UAT |

### 10.2 单步四行

```text
n. 操作：用户做什么（界面中文文案，不用内部函数名）
   定位：路由 + 按钮/导航文案（括注现行 data-testid）；辅助证据写工具名
   必须看见：URL / 标题 / Toast / 表格行 / 工具成功字段
   失败即停：不满足则整条 FAIL
```

### 10.3 禁止

- 同一步塞多个意图
- `等待 3 秒` 式等待——用元素可见 / 网络空闲等可观察条件
- 「页面流畅」「观感良好」类主观断言
- 凭记忆截图——必须当场截、当场存

### 10.4 环境

| 项 | 值 |
|---|---|
| `WEBUI_BASE` | `http://127.0.0.1:55176` |
| MCP | `http://127.0.0.1:57881/mcp` |
| 鉴权 | demo 实例为开放模式（无登录账户），管理台 API 直接可访问；若已被配置账户，先查 `/api/auth/status` |
| 写入边界 | 只写 demo 栈的 `/data/lucy`；**真实仓库只读**，不得因 UAT 产生 tracked 改动 |

---

## 11. 截图证据规约（不可分割条款）

### 11.1 命名

```text
inbox/uat-v2.0-24h/b<N>/<CASE-ID><slot-letter>-<slug>.png
例：inbox/uat-v2.0-24h/b1/B1-05a-collapsed-by-schema.png
```

### 11.2 硬性要求

1. **一张不落**：本计划列出的 **51** 个截图槽位（**含 B0 的 6 张**：B0:6 · B1:12 · B2:8 · B3:9 · B4:5 · B5:4 · B6:7），每槽位一张真实页面截图。
   注意：统计脚本的槽位正则必须同时匹配 `B0-1`（单位）与 `B1-01`（两位）两种编号，否则会漏掉 B0 造成分母偏小。
2. **当场截**：截图必须由执行浏览器当场产生，不得事后用其他工具补图、拼图、裁剪伪造。
3. **可判定**：截图里必须能看清断言对象（元素、文案、状态）。截图本身说不清问题的，**不算证据**，需重截。
4. **负向断言必须留证**：证明「某元素不存在」的用例，截取该区域的完整视图，而非截一个空白角落。
5. **不落密钥**：截图与报告均不得包含明文 Token / 口令；Token 只记「已签发 / 已撤销」与后四位。

### 11.3 报告与截图的关系

```text
报告 = 结论 + 判定依据 + 截图索引
其中截图索引必须逐条指向真实存在的 PNG 文件路径
```

**缺图判定**：任一槽位无对应 PNG → 该批次报告标记 `blocked（证据不完整）`，**不得**记 Pass，**不得**推进下一批次。补齐截图后该批次重判。

---

## 12. 批次报告模板

每批次一份，落在 `inbox/uat-v2.0-24h/report-b<N>.md`：

```md
# 批次 N 报告：<主题>

| 元数据 | 内容 |
|---|---|
| 执行时间 | YYYY-MM-DD HH:MM |
| 镜像构建时间 | docker image inspect project-lucy:demo → Created |
| HEAD | <commit> |
| 用例总数 / PASS / FAIL / blocked | n / n / 0 / 0 |
| 截图槽位 / 实际截图 | 12 / 12 |

## 用例判定

| ID | 判定 | 必须看见 | 截图 |
|---|---|---|---|
| B1-01 | PASS | … | [01a](b1/B1-01a-overview-card.png) / [01b](b1/B1-01b-connectivity-test.png) |

## 缺陷

| 编号 | 用例 | 现象 | 截图 |
|---|---|---|---|

## 结论

<批次是否通过；未通过则阻断哪一批>
```

---

## 13. 风险与前置

| 风险 | 处置 |
|---|---|
| `npm run demo:rebuild` 会重建镜像并 recreate 容器（`/data/lucy` **保留**）。属有副作用操作，**执行前须经 Forrest 确认**，不自行触发 | 已按 Forrest 要求定为**平滑升级**：禁 `--fresh`、必带 `--backup-dir`、必过 `preserved=true` 校验 |
| 本卷含**模板里不存在**的存量角色 `chatbi-analyst`（及 `demo_agent` 的 token、审计记录） | 清空会**永久丢失**。已列为 §3.5 核对表，B0-5 逐项验收，缺失即回滚 |
| B3-06 在「工具已齐全」的卷上会 `inserted=0` 空跑 | 已加 §6.3 前置态构造：先移除 5 项再 restart 触发迁移，否则该提交零覆盖 |
| `quirky_booth` 容器是跑着 `find skills` 的一次性调试残留 | B0-1 清理；属临时产物，可回收删除 |
| `lucy_admin` 在 `access.yaml` 中标注「非 WebUI 登录账户」 | B3-06 走 MCP / API 工具面验证，不试图用浏览器登录该角色 |
| B3 权限语义变更影响面大 | 单独成批，失败即阻断后续批次 |
| 25 个提交集中在 10-12 20:23–10-13 00:24 的短窗口 | 批次 1 提交最多，若时间不足优先保证 B0 → B3 → B6，B1/B2/B4/B5 可次日补 |

---

## 14. 执行顺序

```text
B0 环境重建 · 平滑升级（硬门禁，禁 --fresh）
  ↓
B1 接入向导（9 提交，12 图）
  ↓
B2 Agent 角色集（3 提交，8 图）
  ↓
B3 Skill/Wiki 开放（7 提交，9 图）★ 风险最高，失败阻断
  ↓
B4 可观测性降噪（2 提交，5 图）
  ↓
B5 运行时护栏（4 提交，4 图）
  ↓
B6 回归收口（7 图）+ 51 图完整性自检（含 B0）
```