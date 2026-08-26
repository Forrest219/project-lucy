# 分表 E2E-USER-JOURNEY：用户旅程剧本

| 元数据 | 内容 |
|---|---|
| 文档名称 | 分表 E2E-USER-JOURNEY：用户旅程剧本 |
| 文档类型 | QA / Test Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-25 |
| 撰写人 | Cursor Grok 4.6 |
| 委托人 | xingchen |
| 基于材料 | `docs/plans/2026-08-25-user-journey-playbook-design.md`；`webui/src/app/navigation.ts`；术语标准；selector-contract |
| 适用范围 | 测试集 `E2E-USER-JOURNEY`：按真实用户逐步操作验收；供后续 Agent 自动化执行 |
| 输出位置 | `docs/qa/suite-user-journey.md` |
| 父指引 | [`e2e-sop.md`](e2e-sop.md) |
| 设计 | [`../plans/2026-08-25-user-journey-playbook-design.md`](../plans/2026-08-25-user-journey-playbook-design.md) |

> **先读父指引** [`e2e-sop.md`](e2e-sop.md) 确认本分表是正确测试集。已写正文：ENG-01、ANA-01～05、ADM-01、ONB-01～03。其余 P0 先占位。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| 概念 | UI 主术语 | 英文辅助 | 禁止文案 |
|---|---|---|---|
| 用户旅程剧本 | 用户旅程剧本 | user-journey playbook | 把本分表当成 Playwright 或 eval YAML 的替代 |
| 失败即停 | 失败即停 | fail-stop | 失败后继续点后续步骤并报 Pass |
| blocked | blocked | blocked | 把环境不可用当成 Pass |

本分表不新增产品概念。按钮 / 导航 / Toast 必须与现行 UI 及术语标准一致。

## 1. 本分表证明什么

人（或 Agent）可以按剧本走完四类用户的主操作，每步有可观察结果。不证明 selector 契约、口径 gold、Docker 进程健康——那些仍走既有测试集。

执行器：

| 前缀 | 执行器 | 表面 |
|---|---|---|
| `UJ-ENG` / `UJ-ADM` / `UJ-ONB` | `agent-browser` | WebUI |
| `UJ-ANA` | `agent-mcp` | Lucy MCP |
| `UJ-ONB-02` | `mixed` | WebUI 复制配置 + 新开 MCP session |

## 2. 共同约定

### 2.1 环境（禁止混用）

每条用例头上的参数表写死 `WEBUI_BASE` / MCP / `CONN_ID`。WebUI 与 MCP 必须同一套实例。

| 旅程 | 默认 | 写入 |
|---|---|---|
| ENG / ADM | `WEBUI_BASE`（Docker 常 `http://127.0.0.1:55176`）；`LUCY_PROJECT_DIR` → fixture（`scripts/init-e2e-fixture.sh`） | 只写 fixture；真实仓库只读 |
| ANA | 本会话已鉴权 Lucy MCP；先 `lucy_catalog` | 只读 |
| ONB | 与 ANA 同实例 | 可复制 MCP 配置；不改 `customer-config` |

密钥、明文 Token 不进本文件与证据。Token 证据只记「已签发 / 已撤销」和后四位。

### 2.2 失败即停

- 某步「必须看见」不满足 → 整条 **FAIL**，停止。
- 环境起不来、token 无效、Visible Scope 对不上 → **blocked**，不当 Pass。
- ANA 查询工具失败：允许按该条剧本重试一次；仍失败则记录「结论不可用」，禁止用 Wiki 或记忆补数字。
- ENG / ADM 写操作失败：按该条「清理」处理（或重置 fixture）后再报 FAIL。

### 2.3 单步四行

```text
n. 操作：用户做什么（界面中文文案，不用内部函数名）
   定位：路由 + 按钮/导航文案（括注现行 data-testid）；MCP 则写工具名 + 合格 key
   必须看见：URL / 标题 / Toast / 表格行 / 工具成功字段
   失败即停：不满足则整条 FAIL；blocked 单独写
```

禁止：同一步塞多个意图；`等待 3 秒`；「页面流畅」类主观断言。

### 2.4 证据

落 `inbox/uj-<id>-<YYYYMMDD>/`。ENG/ADM/ONB 在标注「截图」的步骤留图；ANA 记录工具名、关键参数、行数/字段。

### 2.5 与现有测试

| 已有 | 本分表不重复 |
|---|---|
| Playwright [`lucy-webui-e2e-test-suite.md`](lucy-webui-e2e-test-suite.md) | 术语扫描、翻译防御、越权路径 |
| eval YAML | 把某天样本数字写成唯一价值 |
| Docker smoke | 只证明进程起来 |

交叉引用 `E2E-*` / eval id。**现行 UI 文案与旧 Playwright 注释冲突时，以 `webui/src` 为准。**

## 3. P0 矩阵

| ID | 名称 | 状态 | 交叉引用 |
|---|---|---|---|
| **UJ-ENG-01** | 接入 → 维护语义 → Wiki → 同步索引并生效 | **已写** | `E2E-PUB-01`（意图对齐；CTA 文案以现行 UI 为准） |
| UJ-ENG-02 | 连接概览巡检 + 刷新本地目录 | 待写 | `E2E-CON-01` `E2E-CON-05` |
| UJ-ENG-03 | 添加 Schema 抽屉 | 待写 | `E2E-CON-02` |
| UJ-ENG-04 | 上传 Manifest；已存在时覆盖确认 | 待写 | `E2E-CON-03` `E2E-CON-04` |
| UJ-ENG-05 | 维护启用表范围 | 待写 | `E2E-WHL-01` |
| UJ-ENG-06 | 表目录 → 维护语义 → 保存并校验 | 待写 | `E2E-SEM-01` |
| UJ-ENG-07 | Wiki 阅读 / 编辑 / 保存预检 / `sl_ref` | 待写 | `E2E-WIKI-01` `E2E-WIKI-03` `E2E-WIKI-04` |
| UJ-ANA-01 | 简单事实问数 | **已写** | `demo-ad-date-coverage-001` / `demo-ad-anchor-max-date-001` |
| UJ-ANA-02 | 带维度/过滤的对比题 | **已写** | `demo-ad-top-spend-last30-001` |
| UJ-ANA-03 | 先 Wiki 口径再查数 | **已写** | `demo-ad-default-cpa-is-appointment-001` |
| UJ-ANA-04 | 空结果 / 无权限 / 工具失败不得编造 | **已写** | eval 健壮性 |
| UJ-ANA-05 | 同会话追问口径不漂移 | **已写** | eval 多轮 |
| UJ-ADM-01 | 创建 Agent → 角色 → 签发 Token → 复制 MCP 配置 | **已写** | Admin 模块 |
| UJ-ADM-02 | 角色权限：预览有效 tools / 连接 / 表 | 待写 | Admin 模块 |
| UJ-ADM-03 | 访问日志：问询与调用流水 | 待写 | Admin 模块 |
| UJ-ADM-04 | MCP 调试台受控 `tools/list` | 待写 | Admin 模块 |
| UJ-ADM-05 | 撤销 Token 或停用 Agent | 待写 | Admin 模块 |
| UJ-ONB-01 | 系统概览核对健康项 | **已写** | `/overview` |
| UJ-ONB-02 | 复制 MCP 配置，新 session 见 Visible Scope | **已写** | Onboarding + MCP |
| UJ-ONB-03 | 从连接卡片做连通测试 | **已写** | 连接卡片测试 Drawer |

## 4. UJ-ENG-01 接入到同步索引并生效

**用例 ID 与名称**：`UJ-ENG-01` / 数据工程师把一张新 Schema 接到可被 Agent 检索  
**优先级**：P0  
**执行器**：`agent-browser`  
**交叉引用**：`E2E-PUB-01`（旧注释里的「发布并重建索引」已废弃；本页主按钮是 **同步索引并生效**）

### 4.1 参数表

| 参数 | 默认（fixture） | 说明 |
|---|---|---|
| `WEBUI_BASE` | `http://127.0.0.1:55176` | 以实际启动为准 |
| `CONN_ID` | `mysql-aliyun` | 连接卡片 id |
| `SCHEMA` | `finance_mart` | 必须是当前 fixture **尚未**配置的 Schema |
| `TABLE` | `fact_revenue` | Manifest 内第一张事实表 |
| `MANIFEST` | `webui/tests/e2e/fixtures/data/finance_mart.yaml` | 粘贴上传 |
| `WIKI_DIR` | `global` | 新建文档目录 |
| `WIKI_FILE` | `finance-playbook.md` | 新建文档文件名 |
| `MEASURE_NAME` | `gross_profit` | 指标名 |
| `MEASURE_EXPR` | `sum(profit)` | 指标表达式 |

### 4.2 前置

- Fixture 已初始化：`bash scripts/init-e2e-fixture.sh`；WebUI 以 `LUCY_PROJECT_DIR` 指向该副本启动。
- `ktx.yaml` 中 `CONN_ID` 的 `schemas` **不含** `SCHEMA`。
- `wiki/WIKI_DIR/WIKI_FILE` 不存在。
- 浏览器无残留未保存草稿。
- 真实项目仓库全程只读。

**blocked**：WebUI 打不开、fixture 未挂上、`CONN_ID` 卡片不存在。

### 4.3 步骤

#### 阶段 A · 数据接入

1. 操作：打开连接概览。  
   定位：侧栏「数据接入」→「连接概览」→ `/connections`（`page-header`）。  
   必须看见：页标题「连接概览」；连接卡片 `connection-card-${CONN_ID}`；Schema 表存在。  
   失败即停：无该连接卡片 → FAIL。  
   截图：连接概览。

2. 操作：在该连接上点「+ 添加 Schema」。  
   定位：`add-schema-${CONN_ID}`。  
   必须看见：抽屉标题含「添加 Schema」（`add-schema-drawer`）；步骤条含「输入 Schema」「测试连接」「确认并完成」。  
   失败即停：抽屉未打开 → FAIL。

3. 操作：填入 Schema 名 `SCHEMA`。若出现库内下拉且列表没有该项，先点「手动输入 Schema 名称」再输入。  
   定位：`add-schema-select` 或 `add-schema-input`；手动入口 `add-schema-manual-toggle`。  
   必须看见：输入框或选择值为 `finance_mart`；无 `add-schema-input-error`。  
   失败即停：名称校验红字 → FAIL。

4. 操作：点「下一步」。  
   定位：`add-schema-preview-btn`（pending 文案「生成预览...」）。  
   必须看见：进入预览，出现「ktx.yaml 计划变更」和 unified diff；无 `add-schema-connection-test-failed`。  
   失败即停：预览失败或致命错误 → FAIL。连接/权限类错误可标 blocked。

5. 操作：点「确认写入」。  
   定位：`add-schema-confirm-btn`。  
   必须看见：成功文案「✓ 已添加 Schema：finance_mart」（`add-schema-success-message`）；Toast「已添加 Schema: finance_mart」。  
   失败即停：未成功 → FAIL。  
   截图：添加成功。

6. 操作：在成功页点「上传 Schema Manifest」。  
   定位：`add-schema-upload-yaml`（若已关抽屉：Schema 行 `schema-row-${CONN_ID}-${SCHEMA}` 内「上传 Manifest」）。  
   必须看见：上传抽屉 `catalog-asset-upload-drawer`，标题含「上传 … Schema Manifest」。  
   失败即停：抽屉未开 → FAIL。

7. 操作：把 `MANIFEST` 全文粘进文本框，点「上传并同步配置变更」。本条要求目标文件尚不存在，**不要**勾「确认覆盖现有 YAML」。  
   定位：`catalog-asset-upload-textarea`；提交 `catalog-asset-upload-submit`。  
   必须看见：成功区 `catalog-asset-upload-success` 含「✓ 已上传 Schema Manifest」；解析表数 ≥ 1；行状态变为「已存在」（`schema-asset-status-${CONN_ID}-${SCHEMA}`）。  
   失败即停：校验失败或未成功 → FAIL。误走到覆盖确认 → FAIL（覆盖是 `UJ-ENG-04`）。  
   截图：上传成功。

8. 操作：为该 Schema 启用 `TABLE`。点行内「维护启用表范围」，勾选 `fact_revenue`（及其他 Manifest 表如需出现在语义资产中），点「保存变更」。  
   定位：`schema-whitelist-${CONN_ID}-${SCHEMA}` → `/connections/enabled-tables?connection=…&schema=…`；保存 `whitelist-save-changes`。  
   必须看见：Toast「启用表范围已保存」；浮动条消失或「已修改 0 张表」。  
   失败即停：保存失败 → FAIL。  
   截图：启用表范围已保存。

#### 阶段 B · 维护语义

9. 操作：打开语义资产，找到 `fact_revenue`，点「维护语义」。  
   定位：侧栏「语义建模」→「语义资产」→ `/catalog`；行内按钮文案「维护语义」。  
   必须看见：URL 为 `/catalog/${CONN_ID}/${SCHEMA}/${TABLE}`（旧 `/sources/…` 会重定向到此）；页头出现表名。  
   失败即停：目录没有该表 → FAIL（先回头查步骤 7–8）。

10. 操作：在「基础语义」把行粒度勾选为 `order_id` 与 `line_id`。  
    定位：Tab「基础语义」；`grain-picker`。  
    必须看见：已选芯片含 `order_id`、`line_id`。  
    失败即停：字段不在表中 → FAIL（Manifest 与编辑器不一致）。

11. 操作：切到「指标」，点「新增」，名称填 `gross_profit`，表达式填 `sum(profit)`。  
    定位：Tab「指标」；按钮「新增」。  
    必须看见：一行指标名称/表达式已填。  
    失败即停：无法新增 → FAIL。

12. 操作：点「保存」，再点「校验」。  
    定位：页头「保存」「校验」。  
    必须看见：Toast「已保存到语义层」；保存状态不是「保存失败」；校验结果无失败告警（或 Inspector 校验通过）。  
    失败即停：保存/校验失败 → FAIL。  
    截图：表明细已保存。

#### 阶段 C · 业务 Wiki

13. 操作：页头「更多」→「查看关联的业务 Wiki」。  
    定位：`table-editor-more-wiki`。  
    必须看见：进入 `/wiki`；提示「当前上下文：`${CONN_ID}/${SCHEMA}/${TABLE}`」。无已有文档时为「（新草稿）」。  
    失败即停：未带上 `sl_ref` → FAIL。

14. 操作：若仍在库首页，点「新建文档」，目录 `global`、文件名 `finance-playbook.md`，确认创建。若已是该 `sl_ref` 的新草稿，则确认目标路径含 `wiki/global/finance-playbook.md`（没有则新建）。进入编辑后写一段说明利润口径的 Markdown（可含标题「Finance Mart 利润分析」）。  
    定位：`wiki-new-button` / `wiki-new-document-dialog`；编辑 `wiki-edit-button`；`wiki-edit-textarea`。  
    必须看见：编辑态；文本区有正文；状态可为「未保存草稿」或「有未保存修改」。  
    失败即停：无法进入编辑 → FAIL。

15. 操作：点「保存预检」，核对目标路径与 Diff 后点「保存」。  
    定位：`wiki-save-preflight-button`；对话框 `wiki-save-preflight`；确认 `wiki-save-preflight-confirm`。  
    必须看见：预检含「目标」「校验」；目标路径含 `wiki/global/finance-playbook.md`；确认后回到阅读态或清除「有未保存修改」。  
    失败即停：预检 error 级发现或保存失败 → FAIL。  
    截图：保存预检目标路径。

16. 操作：阅读态确认关联语义对象可点回表。  
    定位：阅读视图中的关联语义对象（`sl_ref` Badge / 链接）。  
    必须看见：能跳回 `/catalog/${CONN_ID}/${SCHEMA}/${TABLE}`。  
    失败即停：没有关联或跳转错误 → FAIL。

#### 阶段 D · 语义发布

17. 操作：打开发布工作台。  
    定位：侧栏「语义发布」→「发布工作台」→ `/publish/workbench`（`publish-workbench-layout`）。  
    必须看见：Badge `workbench-pending-count` 为「N 个待同步文件」（N≥1），**不是**「暂无待同步变更」。  
    失败即停：无待同步文件 → FAIL（保存未落盘或未产生 diff）。  
    截图：待同步文件数。

18. 操作：点「校验变更」，等到通过。  
    定位：`workbench-validate`。  
    必须看见：页头出现「校验通过 N 张」或等效通过态；主按钮「同步索引并生效」可点（`workbench-publish-and-reindex`）。  
    失败即停：校验失败 → FAIL，读失败列表，不点同步。

19. 操作：点「同步索引并生效」，在确认侧栏再点一次「同步索引并生效」。  
    定位：`workbench-publish-and-reindex`；确认 `workbench-publish-confirm-drawer`（标题「确认同步索引并生效」）；提交 `workbench-publish-confirm-submit`。  
    必须看见：结果区 `workbench-reindex-result` 出现（超时 60s 内）；无 `workbench-reindex-error`。  
    失败即停：确认框标题仍是「发布语义资产 / 发布并重建索引」视为文案回归 FAIL；reindex 失败 → FAIL。  
    截图：同步结果。

20. 操作：打开发布记录，看最新一批。  
    定位：侧栏「发布记录」→ `/publish/history`。  
    必须看见：首行 `publish-history-row` 触发方式含「WebUI 发布」；`publish-history-reindex-status` 含「成功」。  
    失败即停：无记录或状态非成功 → FAIL。  
    截图：发布记录首行。

### 4.4 全程 Pass

- 步骤 1–20 均满足「必须看见」。
- fixture 外的真实仓库无新的未提交写入。
- 证据目录含阶段 A/B/C/D 标注的截图。

### 4.5 清理

- 重置 fixture：`bash scripts/init-e2e-fixture.sh`（或该环境约定的 reset）。
- 不要在真实仓库 `git checkout` 来撤 E2E 写入。

### 4.6 已知漂移（执行时勿用旧文案）

| 旧文档 / 旧 Playwright 注释 | 现行 UI（2026-08-25 代码） |
|---|---|
| 表目录 `/`，「维护语义」后 `/sources/…` | 导航「语义资产」`/catalog`；表明细 `/catalog/:conn/:schema/:table` |
| 启用表范围 `/connections/whitelist`，「维护启用范围」 | `/connections/enabled-tables`，「维护启用表范围」 |
| 发布主按钮「发布并重建索引」；Badge「N 个待发布文件」 | 「同步索引并生效」；「N 个待同步文件」 |
| 「强制重建索引」 | 「更多」里「全量重建索引」（本条不点） |
| 添加 Schema 主按钮「测试连接可用性 / 写入 ktx.yaml 并完成」 | 「下一步」→「确认写入」 |
| 上传提交「上传」 | 「上传并同步配置变更」 |

## 5. UJ-ANA-01 简单事实问数

**用例 ID 与名称**：`UJ-ANA-01` / 分析师问一个有数的简单事实，必须查库后先给数字  
**优先级**：P0  
**执行器**：`agent-mcp`  
**交叉引用**：eval `demo-ad-anchor-max-date-001`（相对时间锚定 `max(date)`）；口径见 `wiki/global/demo-ad-account-funnel-playbook.md`。本条测**操作路径与答法**，不把某一天的花费写成唯一价值。

分析师不打开 WebUI。用户在 Cursor（或其它已接 Lucy MCP 的客户端）里用自然语言提问；执行者只用本会话可见的 Lucy 工具取数。

### 5.1 参数表

| 参数 | 默认（lucy-demo / mysql-aliyun） | 说明 |
|---|---|---|
| `MCP` | 本会话 Lucy MCP（如 Cursor `user-lucy-demo`） | 必须与 WebUI 同实例；禁止拿远程 MCP 答本地库 |
| `CONN_ID` | `mysql-aliyun` | `lucy_catalog` 里必须出现 |
| `SOURCE` | `ad_account_daily` | 物理表 `dataforai.ad_account_daily` |
| `MEASURE` | `ad_account_daily.spend` | 合格 semantic key；失败后**不要**改成未加 source 前缀的 `spend` |
| `DATE_FIELD` | `ad_account_daily.date` | 业务日；按上海时区解读（若 source 文档如此写） |
| `QUESTION` | 有数的最近一天，全部账户花费合计是多少？ | 用户原话；换主题只改参数表 |

### 5.2 前置

- MCP session 已建立，initialize 的 Visible Scope 含 `CONN_ID` 与 `SOURCE`。
- 执行者身份对应只读 Agent（如 `demo_agent`）；不改语义、不改 ACL。
- 用户本回合只问 `QUESTION` 这一件事实，没有要求画图、改口径或解释权限。

**blocked**：MCP 未鉴权、Visible Scope 没有 `CONN_ID`/`SOURCE`、catalog 调用失败且重试仍失败。

### 5.3 用户原话（模拟）

```text
有数的最近一天，全部账户花费合计是多少？
```

### 5.4 步骤

1. 操作：把用户原话记为本回合唯一业务问题（不要改写成另一道题）。  
   定位：聊天输入；无 WebUI。  
   必须看见：本回合问题原文与参数 `QUESTION` 一致。  
   失败即停：执行者擅自换成别的指标/日期范围 → FAIL。

2. 操作：调用一次 `lucy_begin_question`。  
   定位：MCP `lucy_begin_question`；`question` = 用户原话；`intentSummary` = 取投放日表最新业务日的花费合计。  
   必须看见：调用成功或可忽略的软失败（跳过此工具不得阻塞后续）。  
   失败即停：无。本步失败不当 blocked，继续步骤 3。

3. 操作：调用 `lucy_catalog`，确认路由。  
   定位：MCP `lucy_catalog`（无参数）。  
   必须看见：连接列表含 `CONN_ID`；sources 含 `SOURCE`（或 `mysql-aliyun.dataforai.ad_account_daily`）。  
   失败即停：没有该连接/表 → **blocked**（权限或接错实例）。catalog 失败可重试一次，仍失败 → blocked。

4. 操作：调用 `lucy_read_source`，确认花费指标与日期字段。  
   定位：`connectionId=CONN_ID`，`sourceName=SOURCE`。  
   必须看见：存在 measure `spend`（合格 key `ad_account_daily.spend`）；时间字段为 `date`；文档或描述表明相对「最近」锚定 `max(date)`，不用操作系统今天。  
   失败即停：source 不可读 → FAIL/blocked（按错误是否权限）。本步不要改去 `wiki_search` 代替读表。

5. 操作：调用 `lucy_query` 取最新有数日的花费合计。  
   定位：
   ```text
   connectionId: mysql-aliyun
   measures: ["ad_account_daily.spend"]
   dimensions: [{ field: "ad_account_daily.date" }]
   order_by: [{ field: "ad_account_daily.date", direction: "desc" }]
   limit: 1
   ```
   必须看见：工具成功；恰好 1 行（或第一行）含日期与花费；花费为数值（含 0）；日期不是执行机「今天」除非碰巧与 `max(date)` 相同。  
   失败即停：失败则按剧本**只重试一次**（参数保持合格 key，不要缩短成 `spend`）。第二次仍失败 → FAIL，**禁止**用 Wiki、记忆或其它表补一个数字。0 行 → FAIL（表空或过滤把最新日滤掉），答「当前可查询数据没有行」，不得编造。  
   证据：记录工具名、上述参数、返回行数、日期列、花费列（可截断）。

6. 操作：向用户作答。  
   定位：聊天回复，不调用 `lucy_explain_query` / `entity_details`（用户没问元数据或权限诊断）。  
   必须看见：
   - **先给数字**：花费合计出现在回复前部（表格或一行结论均可）；
   - 写明该数字对应的业务日（步骤 5 的日期）；
   - 一句来源：`ad_account_daily` / 花费 = `sum(spend)`，相对「最近」锚定表内 `max(date)`；
   - 未把本条写成审计长文（无大段工具清单、无权限论文）。  
   失败即停：没有数字却下结论 → FAIL；数字与步骤 5 返回不一致 → FAIL；未说明业务日 → FAIL；声称「今天」但未核对该日等于 `max(date)` → FAIL。

### 5.5 全程 Pass

- 步骤 3–6 满足「必须看见」。
- 未编造、未在查询失败后用 Wiki 顶替。
- 证据目录 `inbox/uj-ana-01-<YYYYMMDD>/` 含 catalog 摘要与 query 返回（无 token）。

### 5.6 清理

- 无写入。不必重置 fixture。
- 不要为对答案去改 `enabled_tables` 或 ACL。

### 5.7 本条不测

- 渠道/账户拆分、CPA、Wiki 口径（`UJ-ANA-02` / `UJ-ANA-03`）。
- 空结果与权限拒绝的话术（`UJ-ANA-04`）。
- 追问是否改口径（`UJ-ANA-05`）。
- eval gold 是否仍等于 2026-07-06 那份快照（换日可重跑；数字以本次 `lucy_query` 为准）。

## 6. UJ-ANA-02 带维度与过滤的对比

**用例 ID 与名称**：`UJ-ANA-02` / 分析师问「近 30 天谁花得多」，必须按表内最大日锚定窗口并给出对比表  
**优先级**：P0  
**执行器**：`agent-mcp`  
**交叉引用**：eval `demo-ad-top-spend-last30-001`（意图对齐）；**禁止**把 gold 里的 `2026-06-07`～`2026-07-06` 写进步骤当死日期。

相对 `UJ-ANA-01` 多出来的用户意图：按账户拆开比、有时间窗口。仍不读 Wiki（那是 `UJ-ANA-03`），仍不用 CPA（避免和口径反模式缠在一起）。

### 6.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `MCP` | 本会话 Lucy MCP | 与 `UJ-ANA-01` 同实例约定 |
| `CONN_ID` | `mysql-aliyun` | |
| `SOURCE` | `ad_account_daily` | |
| `MEASURE` | `ad_account_daily.spend` | |
| `DATE_FIELD` | `ad_account_daily.date` | |
| `DIM` | `ad_account_daily.account_name` | 对比维度 |
| `WINDOW_DAYS` | `30` | 含最大日在内的近 N 个业务日 |
| `TOP_N` | `3` | 返回前 N 名 |
| `QUESTION` | 最近 30 天哪个账户花钱最多？前三名分别花了多少？ | 用户原话 |

### 6.2 前置

- 同 `UJ-ANA-01`：Visible Scope 含 `CONN_ID` / `SOURCE`；只读。
- 本条可独立跑，不依赖 ANA-01 的会话状态；仍要自己 `lucy_catalog`。

**blocked**：同 ANA-01（鉴权、Scope、catalog 连续失败）。

### 6.3 用户原话（模拟）

```text
最近 30 天哪个账户花钱最多？前三名分别花了多少？
```

### 6.4 步骤

1. 操作：锁定用户原话，不要改成「今天往前 30 个自然日」或某个写死月份。  
   定位：聊天输入。  
   必须看见：问题含「最近 30 天」+ 账户花费对比。  
   失败即停：执行者改用系统日历今天，或改问 CPA → FAIL。

2. 操作：`lucy_begin_question` 一次。  
   定位：`question` = 用户原话；`intentSummary` = 按表内 max(date) 锚定近 30 天，按账户合计花费取前三。  
   必须看见：成功或软失败。  
   失败即停：无。

3. 操作：`lucy_catalog`。  
   定位：无参数。  
   必须看见：`CONN_ID` 与 `SOURCE` 在可见范围。  
   失败即停：没有 → **blocked**；失败可重试一次。

4. 操作：先查业务末日（不要猜、不要用本机日期）。  
   定位：`lucy_query`
   ```text
   connectionId: mysql-aliyun
   measures: ["ad_account_daily.spend"]
   dimensions: [{ field: "ad_account_daily.date" }]
   order_by: [{ field: "ad_account_daily.date", direction: "desc" }]
   limit: 1
   ```
   必须看见：成功；得到 `MAX_DATE`。记 `START_DATE` = `MAX_DATE` 往前共 `WINDOW_DAYS` 个业务日的闭区间起点（含首尾时即 `MAX_DATE - (WINDOW_DAYS - 1)` 天）。  
   失败即停：查询失败则重试一次；仍失败 → FAIL，不得用 2026-07-06 等历史 gold 日期顶替。

5. 操作：按账户合计花费，限制在 `[START_DATE, MAX_DATE]`，取前 `TOP_N`。  
   定位：`lucy_query`
   ```text
   connectionId: mysql-aliyun
   measures: ["ad_account_daily.spend"]
   dimensions: [{ field: "ad_account_daily.account_name" }]
   filters:
     - { field: "ad_account_daily.date", op: ">=", value: "<START_DATE>" }
     - { field: "ad_account_daily.date", op: "<=", value: "<MAX_DATE>" }
   order_by: [{ field: "ad_account_daily.spend", direction: "desc" }]
   limit: 3
   ```
   必须看见：成功；行数 1–3（账户不足 3 个时按实际行数，须在答复里说明）；每行有账户名与花费；花费为数值。  
   失败即停：未加日期过滤 → FAIL；用系统今天做窗口 → FAIL；key 被缩短成未加 source 前缀且第一次报错后仍不改回合格 key → FAIL；失败重试一次仍失败 → FAIL，禁止编造排名。  
   证据：两次 query 的参数（含算出的日期）与返回行。

6. 操作：向用户作答。  
   定位：聊天回复；不要 `lucy_explain_query`。  
   必须看见：
   - 先给对比表（账户 / 花费），第一行即花钱最多的账户；
   - 写明窗口：`START_DATE`～`MAX_DATE`（业务日），并点明锚定的是表内最大日、不是操作系统今天；
   - 一句来源：`ad_account_daily.spend` = `sum(spend)`，维度 `account_name`；
   - 不把日花费再平均；不展开 CPA。  
   失败即停：只有文字没有可核对的前三数字 → FAIL；窗口日期与步骤 4–5 不一致 → FAIL；排名与 query 顺序不一致 → FAIL。

### 6.5 全程 Pass

- 步骤 3–6 满足「必须看见」。
- 日期窗口由本次查询推出，文档与证据里没有写死 gold 快照日。
- 证据目录 `inbox/uj-ana-02-<YYYYMMDD>/`。

### 6.6 清理

- 无写入。

### 6.7 本条不测

- 默认 CPA / SUM/SUM 反模式（可在后续 P1 或 ANA 扩展）。
- 自运营 vs 代理 segment（可用同一模板换 `QUESTION` + `segments`，不在本条强制）。
- Wiki、失败话术、追问口径。

## 8. UJ-ADM-01 创建 Agent、签发 Token、复制 MCP 配置

**用例 ID 与名称**：`UJ-ADM-01` / 管理员给新使用者开好 Agent、角色、一次性 Token 和可粘贴的 MCP 配置  
**优先级**：P0  
**执行器**：`agent-browser`  
**交叉引用**：`/admin/agents`、`/admin/agents/:id/tokens/new`；术语标准 § Agent / Token / 角色标识。

新建时**必须同时选角色**（表单校验：用户 ID + 显示名 + 有效角色）。本条不测事后改角色 diff（那是详情页另一条路径），不测撤销（`UJ-ADM-05`）。

### 8.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `WEBUI_BASE` | 同 ENG | fixture 项目 |
| `AGENT_ID` | `uj_adm01` | 用户 ID；1–32 位 `A-Za-z0-9_-`；执行前列表中不得已存在 |
| `AGENT_NAME` | `UJ 管理员旅程` | 显示名 |
| `ROLE_ID` | 页面上第一个**未**标「待修复」的正式角色 | 下拉禁用项不要选；无可用角色 → blocked |
| `TOKEN_LABEL` | `uj-adm01-cursor` | Token 标签，必填 |
| `CLIENT_TAB` | `通用客户端` | 复制配置时的客户端 Tab（现行还有 Hermes / Claude Code / Codex） |

### 8.2 前置

- WebUI 指向 fixture；真实 `access.yaml` 只读。
- `/admin/roles` 至少有一个可创建 Agent 的正式角色。
- 列表中无 `AGENT_ID`。
- 本条结束必须按 §8.6 删掉该 Agent，避免污染后续 ADM 用例。

**blocked**：打不开访问治理、没有任何可选角色、保存提示 `runtimeAck≠true`。

### 8.3 步骤

1. 操作：打开 Agent 列表。  
   定位：侧栏「访问治理」→「Agent」→ `/admin/agents`（`agent-list-section`）。  
   必须看见：页头「Agent」；主按钮「新建 Agent」。  
   失败即停：无该导航 → FAIL。  
   截图：Agent 列表。

2. 操作：点「新建 Agent」。  
   定位：页头「新建 Agent」（空列表时也可以是「新建第一个 Agent」）。  
   必须看见：对话框标题「新建 Agent」；字段「用户 ID」「显示名」「角色」。  
   失败即停：对话框未开 → FAIL。

3. 操作：填写用户 ID `AGENT_ID`、显示名 `AGENT_NAME`，角色选 `ROLE_ID`。  
   定位：三个必填控件。  
   必须看见：角色摘要卡出现（`role-summary-card`）；所选 option 不是「待修复」。  
   失败即停：无可用角色 → **blocked**；ID 格式红字 → FAIL。

4. 操作：点「下一步：预览配置」。  
   定位：主按钮文案即此（pending「生成中…」）。  
   必须看见：说明「以下改动将写入 access.yaml」；出现 YAML diff。  
   失败即停：预览失败 → FAIL。

5. 操作：点「确认创建」。  
   定位：预览步主按钮。  
   必须看见：Toast「Agent \<显示名\> 已创建」；列表出现行 `agent-row-${AGENT_ID}`；该行角色为 `ROLE_ID`（`agent-role-line-${AGENT_ID}`）。  
   失败即停：未出现新行 → FAIL。  
   截图：列表新行。

6. 操作：在该行点「编辑」，核对详情页角色。  
   定位：行内「编辑」（不要点「查看详情」，那是对象抽屉）。URL `/admin/agents/${AGENT_ID}`。  
   必须看见：页头为显示名；徽章含 `role: ${ROLE_ID}` 且「已启用」。  
   失败即停：角色为空或仍是 legacy allow → FAIL。

7. 操作：打开「Token」标签，点「+ 生成新 Token」。  
   定位：Tab「Token」；链接 aria-label「生成新 Token」→ `/admin/agents/${AGENT_ID}/tokens/new`。  
   必须看见：页头「为 ${AGENT_ID} 创建新 Token」；「Token 标签 *」。  
   失败即停：进不了生成页 → FAIL。

8. 操作：标签填 `TOKEN_LABEL`（设备名、过期可留空），点「生成 Token」。  
   定位：主按钮「生成 Token」。  
   必须看见：页头变为「Token 已生成」；出现明文 token；警告含「关闭后无法再次查看 token 明文」；有客户端 Tab 与「复制 Token」「复制当前配置」。  
   失败即停：生成失败 → FAIL。Endpoint 不可用导致没有 snippet 时：token 仍算生成，但本条「复制 MCP 配置」**FAIL**（记 blocked 若是环境没配 MCP URL）。  
   截图：Token 已生成页（**打码明文**，证据只许后四位）。

9. 操作：点「复制 Token」；切到 `CLIENT_TAB`（默认 通用客户端），点「复制当前配置」。  
   定位：aria-label「复制 token 明文」；`snippet-active`；「复制当前配置」。  
   必须看见：按钮短暂变为「已复制」；Toast「客户端配置已复制」；snippet 含 MCP URL，且含本次 token 或文档声明的占位规则（现行生成页嵌入本次明文，不是 `${LUCY_AGENT_TOKEN}` 安全模板）。  
   失败即停：snippet 是空的 → FAIL。证据**禁止**写入完整 token。

10. 操作：点「我已保存，关闭」，回到详情，确认有效 token 数。  
    定位：关闭按钮；详情页头徽章「N 有效 token」。  
    必须看见：N ≥ 1；Token 列表出现标签 `TOKEN_LABEL` 且未显示已撤销。  
    失败即停：有效 token 仍为 0 → FAIL。  
    截图：详情 Token 列表（无明文）。

### 8.4 全程 Pass

- 步骤 1–10 满足「必须看见」。
- 证据无完整 token / 无完整 `access.yaml` 密钥。
- 清理已执行（§8.6），列表不再有 `AGENT_ID`。

### 8.5 本条不测

- 创建 Role（无角色时 blocked，不在本条建角色）。
- 详情页改角色并确认 diff。
- MCP 调试台试调（`UJ-ADM-04`）。
- 撤销 Token / 停用 Agent（`UJ-ADM-05`）。
- 用新 token 真的连上 MCP 问数（`UJ-ONB-02`）。

### 8.6 清理（必做）

1. 详情页点「删除」。  
2. 浏览器 confirm：`确定要删除 Agent "uj_adm01" 吗？此操作将同时撤销所有关联 token。` → 确定。  
3. 回到 `/admin/agents`，无 `agent-row-uj_adm01`。  

清理失败则本条不能报 Pass（fixture 残留会影响后续用例）。不要用真实仓库的 `git checkout` 撤 `access.yaml`。

## 9. UJ-ONB-01 系统概览核对健康项

**用例 ID 与名称**：`UJ-ONB-01` / 客户或实施人员打开系统概览，确认 Lucy MCP 与 KTX Runtime 可服务  
**优先级**：P0  
**执行器**：`agent-browser`  
**交叉引用**：`/overview`（旧书签 `/onboarding` 会重定向并保留 query）；术语「系统概览」。

只读。不在本条复制 MCP 配置（`UJ-ONB-02`），不做连接卡片连通测试（`UJ-ONB-03`）。

### 9.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `WEBUI_BASE` | 与将要验收的 MCP **同一实例** | Docker 常 `:55176` |
| `EXPECT_HEALTHY` | `true` | 为 true 时出现「系统异常」则 FAIL；排障时可改为 false 只记录状态 |

### 9.2 前置

- WebUI 已启动；本条不要求 fixture 写入。
- 执行者知道这是目标环境（禁止用 A 的 WebUI 判断 B 的 MCP）。

**blocked**：页面一直「正在加载系统概览...」或首次加载就「系统概览加载失败」。

### 9.3 步骤

1. 操作：打开系统概览。  
   定位：侧栏置顶「系统概览」→ `/overview`（`page-header`）。若误开 `/onboarding`，应被重定向到 `/overview`。  
   必须看见：标题「系统概览」；描述含 Lucy MCP、KTX Runtime、语义资产、Agent。  
   失败即停：标题不对或整页错误 → blocked/FAIL。  
   截图：首屏。

2. 操作：看顶部运行状态，不要点进别的模块。  
   定位：健康摘要 `ops-service-health-summary`，或危急告警 `ops-service-health-critical`。  
   必须看见（`EXPECT_HEALTHY=true`）：摘要文案「Lucy MCP 与 KTX Runtime 运行正常」；副文含「核心接入链路可用」；**没有** role=alert 的「系统异常」。  
   必须看见（异常时）：告警标题「系统异常」+ 具体原因（MCP 未就绪 / KTX 不可用）；并出现「检查 MCP 接入」或「查看连接概览」等深链。  
   失败即停：`EXPECT_HEALTHY=true` 却出现系统异常 → FAIL（记下 alert 全文）。  
   截图：健康摘要或系统异常。

3. 操作：扫一眼「待处理事项」。  
   定位：`ops-action-required`；计数 `ops-action-required-count`。  
   必须看见：小节标题「待处理事项」。计数可以是 0（空态「暂无高优先级待处理事项」）或 N 项列表。**有待办不等于本条 FAIL**（语义缺口是治理队列，不是进程挂了）。  
   失败即停：整块缺失 → FAIL。

4. 操作：确认质量快照、访问风险、MCP 接入三块都在。  
   定位：`ops-quality-snapshot`；`ops-access-risk`（含 Agent 启用与禁用、近 7 天 ACL 拒绝、可用 Token）；`ops-mcp-access`。  
   必须看见：MCP 接入下有 Endpoint 的 `code`（或「—」）；有按钮「复制 MCP 配置」「查看配置」「打开 MCP 调试台」。本条**不要**点复制。  
   失败即停：MCP 接入区缺失 → FAIL。Endpoint 为「—」且下一步还要给客户拷配置时，在证据里标风险，本条仍可 Pass（拷贝验收在 ONB-02）。  
   截图：MCP 接入（含 Endpoint，无 token）。

5. 操作：点「刷新首页数据」，确认页面仍可读。  
   定位：`onboarding-refresh-button`；徽章 `onboarding-last-updated`。  
   必须看见：按钮可点；刷新后 Toast「系统概览已刷新」或徽章「上次更新」仍在；没有变成整页加载失败。  
   失败即停：刷新后整页错误 → FAIL。Toast「系统概览刷新失败」→ FAIL。

### 9.4 全程 Pass

- 步骤 1–5 满足「必须看见」。
- `EXPECT_HEALTHY=true` 时无「系统异常」。
- 证据 `inbox/uj-onb-01-<YYYYMMDD>/`，不含 token。

### 9.5 清理

- 无写入。

### 9.6 本条不测

- 复制 MCP 配置并新开 session（`UJ-ONB-02`）。
- 连接卡片连通测试（`UJ-ONB-03`）。
- 待处理事项是否为 0（那是治理完成度，不是上线进程健康）。
- `LUCY_PUBLIC_MCP_URL` 是否已配（fallback 提示只记录，拷贝对错由 ONB-02 判）。

## 10. UJ-ONB-02 复制 MCP 配置并核对 Visible Scope

**用例 ID 与名称**：`UJ-ONB-02` / 从系统概览拷出 MCP JSON，换成已有 Token 后新开 session，catalog 能看到授权范围  
**优先级**：P0  
**执行器**：`mixed`（浏览器拷配置 + MCP `lucy_catalog`）  
**交叉引用**：`UJ-ONB-01`（健康前提）；`UJ-ADM-01`（Token 从哪来，本条不新建 Agent）。

系统概览复制的是**安全模板**：`Authorization: Bearer <LUCY_AGENT_TOKEN>`，与签发页「Token 已生成」嵌入明文不同。

### 10.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `WEBUI_BASE` | 同 ONB-01 | 必须与 MCP 同实例 |
| `DEPLOYMENT` | `local` | `local` 允许 Endpoint 为 `127.0.0.1`；`customer` 时若出现 fallback 本地默认 URL → FAIL |
| `TOKEN` | 本机已有 Agent token | **不写进本文件**；从 1Password / 环境变量取 |
| `EXPECT_CONN` | `mysql-aliyun` | 新 session 的 catalog 必须出现 |
| `EXPECT_SOURCE` | 至少 1 个该连接下的 source | 例 `ad_account_daily`；以该 token 的 role 为准 |

### 10.2 前置

- `UJ-ONB-01` 在同一 `WEBUI_BASE` 为 Pass（无系统异常），或本条步骤 1 当场确认「运行正常」。
- 已有可用 Token（启用中的 Agent，未撤销）。没有 token → **blocked**（去 `UJ-ADM-01`，不要在本条签发）。
- 执行者能把 JSON 贴进客户端并**新开** MCP session（Cursor：改配置后重载 MCP / 开新 Agent 对话，不要用旧 session 的缓存 Scope）。

### 10.3 步骤

1. 操作：打开 `/overview`，进入「MCP 接入」。  
   定位：侧栏系统概览；`ops-mcp-access`。  
   必须看见：Endpoint 的 `code` 不是空、不是「—」。  
   失败即停：Endpoint 不可用 → FAIL/blocked。  
   截图：MCP 接入（无 token）。

2. 操作：点「查看配置」。  
   定位：`mcp-config-view-button`；抽屉 `mcp-config-drawer`。  
   必须看见：标题「MCP 配置」；Endpoint 与页上一致；JSON 含 `"type": "http"`、`"url":` 同 Endpoint、`"Authorization": "Bearer <LUCY_AGENT_TOKEN>"`。说明文字要求把 `<LUCY_AGENT_TOKEN>` 换成明文。  
   失败即停：JSON 里已是真实 token → FAIL（概览不应泄露明文）。抽屉 Endpoint 与页上不一致 → FAIL。

3. 操作：关闭抽屉，点「复制 MCP 配置」。  
   定位：`mcp-config-copy-button`。  
   必须看见：按钮短暂「已复制」；Toast「MCP 配置已复制」。若按钮 disabled：Toast「Endpoint 不可用，无法复制配置」→ FAIL。  
   失败即停：复制失败 → FAIL。  
   `DEPLOYMENT=customer` 且页上有 `mcp-fallback-notice`（本地默认 Endpoint）→ FAIL（客户会把只能本机访问的地址拷走）。`local` 仅记录该 notice。

4. 操作：在剪贴板/抽屉 JSON 上把 `<LUCY_AGENT_TOKEN>` 换成参数 `TOKEN`，写入客户端 MCP 配置（Cursor `.mcp.json` 或等价）。**不要**把替换后的文件提交进 git。  
   定位：本地 MCP 配置；无 WebUI。  
   必须看见：url 仍是步骤 1 的 Endpoint；Bearer 后是 token 而非占位符。  
   失败即停：url 被改成另一端口/主机 → FAIL（串实例）。

5. 操作：新开 MCP session，调用 `lucy_catalog`（不要先凭记忆答 Visible Scope）。  
   定位：MCP `lucy_catalog`。  
   必须看见：调用成功；连接含 `EXPECT_CONN`；sources 含 `EXPECT_SOURCE`（或该 role 文档列出的表）。  
   失败即停：鉴权失败 / 空 catalog → FAIL（token 错、未重开 session、或指错 Endpoint）。失败可重试一次 catalog，不得编造 Scope。  
   证据：catalog 连接名与 source 列表；**禁止** token。

6. 操作：对照 initialize / catalog，确认没有把别的实例的表写进结论。  
   定位：同一 session 的 Visible Scope。  
   必须看见：列出的 source 都来自本次 catalog；没有「我想起来还有 xx 表」。  
   失败即停：回答里出现 catalog 没有的 connection/source → FAIL。

### 10.4 全程 Pass

- 步骤 1–6 满足「必须看见」。
- 概览拷贝件始终是占位符模板；真实 token 只存在本机客户端配置。
- 证据 `inbox/uj-onb-02-<YYYYMMDD>/`。

### 10.5 清理

- 可选：从本机 MCP 配置里去掉本次测试 server，避免别人误用。
- 不撤销生产 Token。不改仓库 `access.yaml`。

### 10.6 本条不测

- 系统概览其它健康卡（`UJ-ONB-01`）。
- 连通测试 Drawer（`UJ-ONB-03`）。
- 用该 token 跑完整问数（那是 `UJ-ANA-*`）。
- MCP 调试台 dry-run（`UJ-ADM-04`）。

## 11. UJ-ONB-03 连接卡片连通测试

**用例 ID 与名称**：`UJ-ONB-03` / 客户从连接概览卡片打开连通测试，确认库能连上且不扫表  
**优先级**：P0  
**执行器**：`agent-browser`  
**交叉引用**：`/connections` 卡片 `connection-health-${CONN_ID}`；抽屉「连通测试」。主导航已无「连通测试」项，**不要**走 `/connections/test` 兼容页作为本条主路径。

本条会打到真实数据库（凭据探测）。不写 `ktx.yaml`、不 `Catalog Reload`、不改启用表范围。

### 11.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `WEBUI_BASE` | 同 ONB-01 | 与 MCP 同实例 |
| `CONN_ID` | `mysql-aliyun` | 卡片必须存在 |

### 11.2 前置

- 连接卡片可见；secret 文件在该实例已配置（否则会「不通」）。
- 不要求 fixture 写入；用目标环境真实连接。

**blocked**：没有该连接卡片；WebUI 指向了另一套 `ktx.yaml`。

### 11.3 步骤

1. 操作：打开连接概览。  
   定位：侧栏「数据接入」→「连接概览」→ `/connections`。  
   必须看见：卡片 `connection-card-${CONN_ID}`；右侧连通健康按钮 `connection-health-${CONN_ID}`（文案为「通 / 不通 / 偏慢 / 需关注 / 探测中」之一，可能带 `ms`）。  
   失败即停：无该卡片 → blocked。  
   截图：连接卡片含健康摘要。

2. 操作：点该连通健康区域。  
   定位：`connection-health-${CONN_ID}`（title「查看连通诊断；进页会自动探测一次」）。  
   必须看见：抽屉 `connection-test-drawer`；标题「连通测试」；说明含「不访问表数据，不会触发 Catalog Reload」；主按钮「重新测试连接」（`connection-test-drawer-run`）。  
   失败即停：抽屉未开 → FAIL。侧栏或 Header 出现「连通测试」导航项 → FAIL（v1.9.0 已移出主导航）。

3. 操作：阅读当前结果条（打开抽屉时用的是卡片已有探测，不一定要先点按钮）。  
   定位：`connection-test-banner`；`connection-test-panel`。  
   必须看见：banner 为「正在测试连接...」或「连接成功 (Connection Passed)」或「连接失败 (Connection Failed)」或「尚未测试」四者之一。  
   失败即停：面板缺失 → FAIL。

4. 操作：点「重新测试连接」，等到结束。  
   定位：`connection-test-drawer-run`（pending「测试中...」）。  
   必须看见（Pass 健康）：banner「连接成功 (Connection Passed)」；`connection-test-latency` 含「响应延时: N ms」；`connection-test-exit-code` 为 `0`。卡片健康可变为「通」或「偏慢」（偏慢仍算连上，本条 Pass，证据记下延时）。  
   失败即停：banner「连接失败」或退出码非 0 → FAIL（凭据/网络/驱动问题）。一直停在「正在测试连接...」超时 → FAIL。  
   截图：成功 banner + 退出码（可含 stdout 折叠，不要截密码）。

5. 操作：确认这不是扫库目录。  
   定位：抽屉说明 + 结果区。  
   必须看见：仍有「不访问表数据 / 不会触发 Catalog Reload」；没有「刷新本地目录」被这次点击触发后的新 Toast（本条过程中不要点「刷新本地目录」）。  
   失败即停：误点刷新本地目录或添加 Schema → 本条作废，按污染处理。

6. 操作：点「关闭」。  
   定位：`connection-test-drawer-close`。  
   必须看见：抽屉消失；仍在 `/connections`；卡片还在。  
   失败即停：被导航到 `/connections/test` → FAIL（走了兼容页）。

### 11.4 全程 Pass

- 步骤 1–6 满足；重新测试为连接成功且退出码 0。
- 未写入语义 / 启用表 / access.yaml。
- 证据 `inbox/uj-onb-03-<YYYYMMDD>/`。

### 11.5 清理

- 无写入。关掉抽屉即可。

### 11.6 本条不测

- 添加 Schema / 上传 Manifest（`UJ-ENG-*`）。
- 刷新本地目录不连库（`UJ-ENG-02`）。
- MCP Visible Scope（`UJ-ONB-02`）。
- `/connections/test` 兼容路由（仅当用户书签误入时手动确认重定向/可用性，不作为本条步骤）。

## 12. UJ-ANA-03 先 Wiki 再查数

**用例 ID 与名称**：`UJ-ANA-03` / 分析师问默认获客成本：必须先读口径 Wiki，再用预约 CPA 查数  
**优先级**：P0  
**执行器**：`agent-mcp`  
**交叉引用**：eval `demo-ad-default-cpa-is-appointment-001`；Wiki `global/demo-ad-account-funnel-playbook.md`。数字以本次 query 为准，不绑 gold `853.82`。

相对 ANA-01/02：本条**禁止**跳过 Wiki 直接 `lucy_query`。查完 Wiki 后仍必须查数，禁止只用 Wiki 口头估一个成本。

### 12.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `CONN_ID` / `SOURCE` | 同 ANA-01 | `ad_account_daily` |
| `WIKI_QUERY` | `获客成本 CPA 预约` | `wiki_search` |
| `WIKI_KEY` | `global/demo-ad-account-funnel-playbook.md` | `wiki_read` 的 canonical key |
| `MEASURE` | `ad_account_daily.预约CPA` | 默认获客成本 |
| `WINDOW_DAYS` | `7` | Wiki：用户只说「最近」且「按默认」→ 末日近 7 天 |
| `QUESTION` | 最近获客成本大概多少？默认口径是哪个指标？ | |

### 12.2 前置

- Visible Scope 含该 source；Wiki 对该 Agent 可读。
- **blocked**：wiki_search 无权限且重试失败。

### 12.3 用户原话

```text
最近获客成本大概多少？默认口径是哪个指标？
```

### 12.4 步骤

1. 操作：`lucy_begin_question`（原话 + intent：默认获客成本=预约 CPA，近窗口查数）。  
   失败即停：无。

2. 操作：`lucy_catalog`。  
   必须看见：`CONN_ID` / `SOURCE`。  
   失败即停：没有 → blocked。

3. 操作：`wiki_search`，query=`WIKI_QUERY`。  
   必须看见：命中列表里能得到可交给 `wiki_read` 的 key（应为 `WIKI_KEY` 或同页别名）。  
   失败即停：0 命中 → FAIL（不要改去只读语义 YAML 充当 Wiki）。  
   证据：search 返回的 key 列表。

4. 操作：`wiki_read` `key=WIKI_KEY`。  
   必须看见：默认获客成本 = **预约 CPA** = 花费合计÷预约合计；**禁止**按日 CPA 再平均；相对「最近」锚定 `max(date)`。  
   失败即停：读失败或页上口径与上句冲突却仍往下编 → FAIL。

5. 操作：`lucy_query` 先取 `MAX_DATE`（同 ANA-02 步骤 4），再查近 `WINDOW_DAYS` 天的 `ad_account_daily.预约CPA`（可无 dimension 的标量，或带 date 窗口 filter）。  
   必须看见：成功数值；filter 窗口由 `MAX_DATE` 推出。  
   失败即停：用了 `AVG` 日 CPA、或查了 `有效客户CPA` 却声称默认口径 → FAIL；query 失败不得用 Wiki 数字顶替（Wiki 没有当天花费）。

6. 操作：作答。  
   必须看见：先给获客成本数字；写明默认=预约 CPA（SUM/SUM）；写明日期窗口；一句「不是按天平均再汇总」。  
   失败即停：没数字、或口径说成有效客户 CPA、或未写窗口 → FAIL。

### 12.5 Pass / 清理 / 不测

- Pass：步骤 2–6；工具顺序上 Wiki 在最终 query 之前。
- 清理：无写入。
- 不测：空结果话术（ANA-04）；追问换口径（ANA-05）。

## 13. UJ-ANA-04 失败与空结果不得编造

**用例 ID 与名称**：`UJ-ANA-04` / 空行、无权限、工具失败时必须说明，禁止编数字  
**优先级**：P0  
**执行器**：`agent-mcp`  
**交叉引用**：数据问答 runtime：工具失败不得用 Wiki/记忆补数；区分 0 行 vs NULL vs 推断。

三条子场景**都要做**；任一条编造 → 整条 FAIL。每条失败允许按剧本重试一次 query。

### 13.1 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `CONN_ID` / `SOURCE` | 同 ANA-01 | 有权限的表 |
| `EMPTY_ACCOUNT` | `__uj_no_such_account__` | `account_name` contains，预期 0 行 |
| `DENIED_CONN` | catalog 里**没有**的 connectionId，如 `not-in-scope-conn` | 预期 ACL/不可见 |
| `BAD_MEASURE` | `ad_account_daily.__no_such_measure__` | 预期 query 失败 |

### 13.2 前置

- 本会话 Scope **不含** `DENIED_CONN`。
- catalog 先成功一次（可复用本回合第一次 catalog）。

### 13.3 子场景 A · 空结果

1. 用户原话：`账户名包含 __uj_no_such_account__ 的最近花费是多少？`  
2. `lucy_query`：`measures=["ad_account_daily.spend"]`，filter `account_name` contains `EMPTY_ACCOUNT`。  
   必须看见：成功且 **0 行**（或明确无匹配）。  
3. 作答：说明当前可查询数据没有行；**不得**给花费数字，不得用全表合计顶替。  
   失败即停：捏造金额 → FAIL。把 0 行写成「数据是 NULL」→ FAIL。

### 13.4 子场景 B · 无权限 / 不可见

1. 用户原话：`用 not-in-scope-conn 查一下花费。`  
2. `lucy_query` `connectionId=DENIED_CONN`（或 Scope 外 source）。  
   必须看见：工具失败或 deny，**不是**一张编出来的表。  
3. 作答：说明无权/不在可见范围；列出本会话实际可见连接（来自 catalog）；不编 Scope 外数字。  
   失败即停：改用有权限表查出数却假装答了用户指定连接 → FAIL。

### 13.5 子场景 C · 工具失败

1. 用户原话：`用指标 __no_such_measure__ 看花费。`  
2. `lucy_query` `measures=["ad_account_daily.__no_such_measure__"]`。  
   必须看见：失败。按剧本重试一次（合格 key **不要**偷偷换成 `spend` 来「救」这一问）。  
3. 作答：写明查询失败、是否重试、结论不可用；禁止给出花费。  
   失败即停：改成正确 measure 查出数当作本问答案 → FAIL（那是换题）。允许另外说明「若改用 spend 可以再问」。

### 13.6 Pass / 清理

- 三子场景均未编造。证据分 A/B/C 记下错误信息摘要（无 token）。
- 不测：正常获客成本路径（ANA-03）。

## 14. UJ-ANA-05 追问口径不漂移

**用例 ID 与名称**：`UJ-ANA-05` / 同一会话先问花费再问获客成本，日期锚与默认 CPA 不得改口  
**优先级**：P0  
**执行器**：`agent-mcp`  
**交叉引用**：eval 多轮一致性；Wiki 默认 CPA=预约 CPA。

必须在**同一 MCP 会话、同一用户问题线程**里连续两问。不要新开对话。

### 14.1 用户原话

```text
# 第一问
有数的最近一天，全部账户花费合计是多少？
# 用户紧接着第二问（不要重开 session）
那获客成本呢？
```

### 14.2 步骤

1. 按 `UJ-ANA-01` 最短路径答第一问（catalog 若本会话已做过可不再重复，但仍须 `lucy_query` 取 `MAX_DATE` + 当日 `spend`）。  
   必须看见：花费数字 + 业务日 `MAX_DATE`。  
   记下：`D1` = 该业务日，`S1` = 花费。

2. 第二问：不要换成系统今天，不要换成近 30 天，除非用户改口。  
   操作：`lucy_begin_question` 可用第二问原话；`lucy_query` 同一 `D1` 上的 `ad_account_daily.预约CPA`（filter date = D1，或 date 维度等于 D1）。  
   必须看见：成功数值 `C1`。  
   失败即停：用有效客户 CPA；或对日 CPA 再平均；或日期改成另一天却不声明 → FAIL。

3. 作答第二问。  
   必须看见：获客成本数字 `C1`；声明默认=预约 CPA（花费合计÷预约合计）；业务日仍是 `D1`；可引用第一问花费作分子来源但不改日。  
   失败即停：第二问只复读第一问花费当获客成本 → FAIL；说「还是刚才那个数」却不查 CPA → FAIL。

### 14.3 Pass / 清理 / 不测

- Pass：两问都有查数；第二问口径=预约 CPA；日期锚=`D1`。
- 清理：无写入。
- 不测：用户明确改口「用有效客户 CPA / 改成近 30 天」（那是正确换口径，另案）。

## 15. 其余 P0 正文

待已写各条审定后，按同一模板续写 §3 矩阵中「待写」项（数据工程师 ENG-02～07、管理员 ADM-02～05）。
