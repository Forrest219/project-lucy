# v0.25 P0 / P1 发布前测试决议（2026-10-28）

本决议覆盖六份预发布核对，外加已授权的一轮落地修复。结论词汇只用 `passed_automation` / `failed` / `blocked` / `not_run`。

**没有任何一条记为 UAT 通过，也没有产品验收签字。** 定向 vitest 通过、历史 HTTP 200、文档状态句对齐，都不能代替验收矩阵。

本轮不包含：P2（OIDC、Skill owner、SMTP）、升级 E2E（L25-07、L25-13）、L25-11、L25-10、L25-12、L25-15、L25-16。不授权第二轮 debug。未 git commit。未清 volume。

下文「授权执行波」是 2026-10-29 在已恢复磁盘之后、对当前演示容器做的取证。它替换文末原来的「健康检查没有返回 200」。更早的六份报告写于容器尚未带上三处修复、或磁盘写满之时；那些报告里的矩阵状态仍然有效，Docker 段落以本节为准。

## 授权执行波（2026-10-29）

平滑升级 `BUILDPLATFORM=linux/arm64 npm run demo:upgrade` 退出码 0。`compose_lucy-demo-data` 保留。`/api/health` 返回 200。运行中的镜像 `gitSha` 为 `fd197e5b55a9eb65ab8748bf8276a7b92b4f73fe`，`gitDirty` 为 true。容器内源码含三处已落地修复：删除确认走 `removeRole: true`、`markPendingWikiBatchItemsNeedsReview`、`projectAttributionAsOfS`。健康响应里 demo-mysql、invest-db、mysql-aliyun 的 execution 仍是 unknown；随后对 demo-mysql 的手动库内表读取返回了表清单。

演示库已有所有者 `xingchen`。仓库里没有登录口令。本次在容器内为该既有账户签发短期会话，用于接口和页面，结束时 `POST /api/auth/logout` 返回 200。没有改 `admins.yaml`，没有重新播种，没有打印口令或会话。

页面用本机无头 Chromium 打开 `http://127.0.0.1:55176`，不是 Playwright 夹具套件，也没有做移动窄屏。

| 条目 | 本波结论 | 证据 |
|---|---|---|
| 重建门禁 | `passed_automation` | 健康 200，volume 保留，镜像含三处修复 |
| 宿主机点名测试 | `passed_automation` | 9 个文件 / 185 通过。独立临时 `KTX_PROJECT_ROOT`，`--maxWorkers=1`。不是全量，不是 UAT |
| L25-14 删除确认 | `passed_automation` | 演示卷接口与浏览器都走过。取消删除时角色还在；确认删除后临时角色消失，原有 10 个角色不变。V15、V19/V22 仍 `blocked`。D-03 台账仍开 |
| Spec 193 列表授权 | `passed_automation` | 列表 3 行都带授权。浏览器打开 `wiki/global` 看到 3 篇无人可见；批量抽屉未提交；未保存草稿时「管理访问权限」禁用。重启后的 `needs_review` 本波 `not_run` |
| L25-09 单条问询 | `passed_automation` | 存量问询 `lucy_bed03823-d8e4-4838-8a11-1ab62671c6e0` 的问询对账 200，`asOfProof.ok` 为 true，`missingTotal` 为 0。带 `hours=168` 同样成立 |
| L25-02/03 用量与 Token 正式读取 | `failed` | `GET /api/admin/audit/reconciliation/usage` 正式模式 409 `RECONCILIATION_AS_OF_S_UNPROVABLE`。诊断模式 `ok: false`，`missingTotal` 564（baseFacts 563，aggregates 1，revisions 0，relations 0）。对账页因此只显示该失败，Token 卡片和单问询区块都没有渲染。问询接口本身可用。这与「用量路由的 `proveAsOfSForSelection` 不做自动回放」一致，本波不改代码 |
| L25-01 授权摘要 | `passed_automation` | `demo_agent` 页面读出 1 个连接、3 张表中的 3 张、授权路径 3 条，行边界为全部行。深链指向 `/admin/access-map?agent=demo_agent` |
| L25-08 访问关系图 | `passed_automation` | 点击深链后画布打开，子图含 Demo Agent、`demo_readonly`、`demo-mysql` 与三张 superstore 表。`window=168h` 的接口：grant `ok`，30 个节点、23 条边；休眠 23，需复核 0，确凿越权 0。ASV / SC 全矩阵仍未执行。MCP 调试台试调 `not_run` |
| Spec 189 一个数字 | `passed_automation` | 使用概况 168 小时：Agent 活跃 1/4（25%），Token 配置 7、活跃 1（14.3%），授权表活跃 1/13（7.7%）。调用监控近 7 天调用量 14，拒绝率 28.6%，与接口 `businessCalls` 14、`deniedCalls` 4 一致。两页窗口锚点不同：概况是滚动 168 小时，调用监控是上海时区 7 个自然日（起点 `2026-10-22T16:00:00.000Z`）。这份存量里两个数字相同 |
| Spec 190 demo 连接 | `passed_automation` | `demo-mysql` / `dataforai` 手动 `live-tables`：`status=ok`，3 张表，`wireProtocol=mysql`，非缓存。连接页显示库内 3、已发现 3、已启用 3，持续感知未开启（discovery `enabled=false`，`never_run`）。客户存量连接仍 `blocked` |
| Spec 191 AC-12 | `not_run` | `LUCY_RELOAD_VERIFY_IMAGE=project-lucy:demo --container` 打印 NOT RUN，退出码 2，没有打印 PASSED，没有另起容器 |

### L25-14 在演示卷上的写入

临时 Role `uat_p0_rowtmp`（`permission_model_version: 2`，`demo-mysql.dataforai.superstore_orders` 的 scoped 行策略）按预览确认创建，`written: true`。不带 `rowPolicyConfirmation` 的 `DELETE`（`dryRun: false`）返回 409 `ROW_POLICY_PREVIEW_REQUIRED`，理由 `missing`，文案为「保存前必须先取得最终行约束预览确认；缺少确认，本次未写入任何配置。」随后 GET 该 Role 仍是 200。`removeRole: true` 的预览发出确认后，删除返回 200 且 `written: true`，再 GET 为 404。删除前后 Role 集合都是原来的 10 个，临时 Role 不在其中。

v1 模型拒绝 scoped，所以临时 Role 使用版本 2。这是现有合同，没有改规格。

### 浏览器点击（2026-10-29）

用所有者账户登录演示页 `http://127.0.0.1:55176` 后点过这两条。没有提交，没有改既有角色或 Wiki 正文。

- **L25-14。** 临时 Role `uat_p0_webtmp` 带 `superstore_orders` 的行约束 `region=East`。详情页授权摘要写明 1 张表有行约束。点「删除 Role」出现确认抽屉；点「取消」后角色仍在。再点「确认删除」后回到角色列表，该角色 GET 为 404，正式 Role 仍是原来的 10 个。
- **Spec 193。** `wiki/global` 列出 3 篇，每篇标为无人可见。批量管理打开后，未选文档时「继续」不可用；勾选 1 篇后抽屉写明只影响这 1 篇，预检和提交都是禁用，关闭后没有写入。空白草稿 `global/new-note.md` 未保存时，「管理访问权限」禁用，并提示「请先保存或放弃正文草稿」。取消后 Wiki 列表仍是 3 篇，没有这份草稿文件。

### 本波仍然不做

客户存量连接、客户 Kubernetes、完整故障注入、客户大小写敏感文件系统、A01–A12、F-01 独立入口、全量 vitest、E2E、移动窄屏、AC-12 的容器步骤。这些保持 `not_run` 或 `blocked`。没有第二轮修复。

## 总决议

| 去向 | 条目 | 含义 |
|---|---|---|
| 演示容器上已取到只读证据，仍不得验收通过 | L25-01、L25-08、Spec 189、Spec 190 的 demo 连接、Spec 193 列表 | 授权执行波为 `passed_automation`。ASV / SC 全矩阵、客户存量、MCP 试调仍未执行 |
| 删除确认已在演示卷和浏览器上走通，仍不得验收通过 | L25-14 | 取消时角色还在；确认后临时 Role 已删净。V 矩阵未执行。D-03 台账仍开 |
| 退回，正式用量对账失败关闭 | L25-09 与 L25-02/03 | 单条存量问询的 as-of 证明为真。用量 / Token 正式读取 409，诊断缺失 564 行。A/V 与 F-01 仍未执行 |
| 保持 blocked | 下列环境项 | 本环境做不到，不计通过 |

## 可以排队做下一类取证

这些条的实现核对没有发现需要本轮再改的代码缺陷。状态保持「已实现，未验收」。

- **L25-01 授权摘要、L25-08 访问关系图。** 报告：[2026-10-28-uat-p1-l25-01-08-access-summary-and-map.md](2026-10-28-uat-p1-l25-01-08-access-summary-and-map.md)。ASV-01–14 与 SC-01–11、SC-13、SC-14 为 `passed_automation`；SC-12 与实机 capability dry-run 仍是 `not_run`。授权执行波已在演示容器上打开摘要页和关系图深链，见文首表格。矩阵仍写未执行。
- **Spec 189 用量口径。** 报告：[2026-10-28-uat-p1-spec-189-190-usage-and-discovery.md](2026-10-28-uat-p1-spec-189-190-usage-and-discovery.md)。定向自动化没有实现缺陷。文首与 §11 已统一为「已实施；未验收」。§10 的 4213 / 4212 与工单的 349/4205 改为历史声称，不再当作当前 HEAD 的全量证据。授权执行波已核对演示容器上的一个数字（调用量 14），不是全矩阵。
- **Spec 190 的夹具 SC-1–34。** `passed_automation`。客户存量连接保持 `blocked`，不在本决议里放行。
- **Spec 191 本机生命周期。** 报告：[2026-10-28-uat-p0-spec-191-runtime-reload.md](2026-10-28-uat-p0-spec-191-runtime-reload.md)。`--local` 16 项通过。授权执行波再次确认 `--container` 退出码 2 且不打印 PASSED。AC-12 仍是 `not_run`：容器检查步骤没有实现。

## 落地偏差已修，仍不得验收通过

### L25-14 行权限

报告：[2026-10-28-uat-p0-l25-14-row-policy.md](2026-10-28-uat-p0-l25-14-row-policy.md)。C19 与 V01–V22 不改为已执行。D-03 台账保持 `open` / `fixedIn: null` / `verifiedBy: []`。

本轮只修报告里的五处落地偏差：

1. 删除带行策略的 Role 在写入前消费 `rowPolicyConfirmation`；候选是从配置中移除该 Role。没有确认时返回 409 `ROW_POLICY_PREVIEW_REQUIRED`，配置不写。删除结果走 `accessWriteResponseBody`：`recovery_required` 为 503 且 `written: false`。
2. 读旧 `access.yaml` 时，只有 ENOENT / ENOTDIR 当作文件不存在；其他 I/O 在写入前抛出。回滚必须比较运行态 digest 与恢复点 digest，空基线不再直接当成已证明。
3. 目录装载不再返回进程内的旧缓存，预览和保存读到当前 Manifest / overlay。
4. 逐 Agent 的 `finalRowsBySource` 缺该表键时，预览失败关闭，不用全局 OR 当 fallback。
5. `LUCY_ROW_POLICY_CATALOG_CAPABILITY` 只能制造 `unknown`。`proven` 必须走适配器合同。

规格状态句改为「C14–C18 已实施、未验收」。§14.4.1 不再写「v0.25 不修 D-03」。删除确认的「无适用授予」已写进 §14.2.1：那不是全部行。

R1 模板写入口的同类三态缺口保持 `out_of_scope`，本轮没有扩进去。

### Spec 193 业务 Wiki 访问

报告：[2026-10-28-uat-p0-spec-193-wiki-access.md](2026-10-28-uat-p0-spec-193-wiki-access.md)。

1. `GET /api/wiki` 先读一次 Role / Agent 快照，再交给列表。同一次请求不再读第二遍。
2. 重启后，字节已经是扩权目标、security operation 未提交的 journal 项改为 `needs_review`。批量信封可以仍是 `pending`。不自动 commit，不重放。
3. §10.2 补上已经落地的 `wiki_batch_blocked` 与 `wiki_access_frontmatter_invalid`。§19.3 的 SC-21 不再把「journal 仍为 pending」写成恢复已完成。状态行改为已实施、未验收。

SC-09、SC-20、SC-23、SC-24 与移动窄屏仍是 `not_run`。授权执行波只核对了列表聚合：一次响应里每行带授权，演示页 `wiki/global` 列出 3 篇。重启后的 `needs_review` 本波没有再制造故障。

## 退回

**L25-09 审计与 L25-02/03 对账。** 报告：[2026-10-28-uat-p0-l25-09-audit-and-reconciliation.md](2026-10-28-uat-p0-l25-09-audit-and-reconciliation.md)。

- F-02：同一水位的归属改写按前像回放后才允许证明通过；晚于水位且已排除的 source 不使该水位失败；缺少前像列时仍然不可证明。这不是 A08 / A10-ASOF 通过。
- F-03：`outcome=ok` 不再推断授权为 allowed。
- F-01 独立入口证据仍未建立。
- A01–A12、V01–V12 未执行。用量 / token 路由上的 `proveAsOfSForSelection` 没有改成自动回放：展示行尚未投影时，同水位改写继续失败关闭。

在 A/V 矩阵实际执行之前，这一条保持退回。

## 保持 blocked / not_run

- **第一次 Docker 重建（历史）：失败。** 磁盘写满时 `demo:upgrade` 在 entrypoint `printf` 处 `No space left on device`，健康检查没有返回 200。该段不是当前状态。清理后的平滑升级已在文首「授权执行波」记为健康 200。
- **Spec 191 AC-12：`not_run`。** 空的 `--container` 必须保持退出码 2。授权执行波已再次确认。
- **Spec 190 客户存量连接：`blocked`。** demo-mysql 的库内表读取不代替客户存量。
- **L25-14 V15 完整故障注入、V19/V22 客户大小写敏感文件系统：`blocked`。** macOS 上的 mock 不填 `verifiedBy`。
- **L25-09 V12：`blocked`。**
- **移动窄屏：`not_run`。** 删除确认的界面点击路径本波也是 `not_run`；接口路径已在演示卷上走通。

## 本轮复测

`npx vitest run --maxWorkers=1`，独立 `KTX_PROJECT_ROOT`，没有跑全量。

- 行权限、Wiki 批量恢复、角色删除、目录归因：4 个文件 / 72 通过。其中包括缺键失败关闭、无确认删除返回 409、夹具 `proven` 不能短路。
- 同一轮还通过：Wiki 路由、角色详情组件、D-03 大小写、行权限视图、Wiki 访问效果、行策略模板。这些文件与上一批有重叠，不把重叠用例加成一份新的全量数字。

这只说明被点名的落地偏差有回归锁。它不关闭 C19、SC、AC、ASV 或 A/V。

## 明确不做

- 不把任何矩阵项改成 UAT 通过。
- 不关闭 D-03 台账。
- 不实现 Spec 191 的容器检查步骤，也不为了 AC-12 再起容器。
- 不扩 R1/R3、不补 F-01 入口计数、不做 F-04、不改权限代数。
- 不授权第二轮 debug。授权执行波只记录新的落地现象，不据此再改代码。
