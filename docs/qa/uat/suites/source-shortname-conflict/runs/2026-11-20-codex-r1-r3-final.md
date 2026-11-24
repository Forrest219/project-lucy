# P1-64 R1–R3 整改：Docker 与真实前台浏览器复验

| 元数据 | 内容 |
|---|---|
| 类型／版本／日期 | Test Report／v1.0／2026-11-20 |
| 执行人／套件 | Codex／UAT-SUITE-SOURCE-SHORTNAME-CONFLICT；P1-64／REQ-030-085 |
| 授权 | 委托人本轮明示修复、回归、Docker UAT、真实前台浏览器计时与台账同步 |
| 完整跑次 | `2026-11-20T03:43:51.543826+00:00` → `2026-11-20T03:45:10.580843+00:00`；**R0／01–12 共 13 项 PASS** |
| 浏览器补跑 | `2026-11-20T03:45:39.224277+00:00` → `2026-11-20T03:46:24.773647+00:00`；**R0／12 选择器 PASS**，新增视口内断言；不冒充全套复跑 |
| 候选 | `project-lucy:p164-final-fix`；linux/arm64；`sha256:d7c23943eba33c9f13405c80e18e45661842c175eeb61b97de37d84c5cebb90f` |
| 源码 | `7e8ee88442c006d839e4fe13334f7fc45056d85e`＋本轮 P1-64 修改（dirty）；与原受审 `0019a0f1` 的 HEAD 树内容相同；未提交、未推送 |
| 原始证据 | [完整 summary](2026-11-20-codex-r1-r3-final-artifacts/full/summary.json)；[视口补跑 summary](2026-11-20-codex-r1-r3-final-artifacts/viewport-supplement/summary.json)；[最终宿主 hash](2026-11-20-codex-r1-r3-final-artifacts/final-host-hashes.json) |
| 清理 | 两跑次 `cleanedUp=true`；独立容器、网络与私有目录删除；保留候选标签与脱敏证据；共享 demo 未改 |
| 合同边界 | Docker UAT PASS；**SC-09 全库 TypeScript 未通过**，功能合同未收口；本报告不主张可交付用户更新／可上线 |

## 用例结果

| 编号 | 实际证明 | 结果 |
|---|---|---|
| R0 | 独立 Docker Lucy＋真实 mysql:8.4；随机 bootstrap／Agent 身份；五份运行源码 hash 与宿主一致 | PASS |
| 01 | weather.city 扫描、上传、启用与合法 MCP 查询，COUNT=1 | PASS |
| 02 | 原事故不手改扫描结果：ods.city 自动分配 ods_city；保存 ack=true；两个物理表可查 | PASS |
| 03 | 重扫不改变合法旧别名，Role／overlay／查询夹具保持 | PASS |
| 04 | 裸 city 冲突 validate／upload 400，文件与状态不推进；合法 MCP 仍可用 | PASS |
| 05 | 前缀二次占用分配 ods_city_2，真实查询成功 | PASS |
| 06 | 两候选先各自 validate；并发恰一成功，另一为具名 PUBLISH_COORDINATOR_BUSY；窗口结束后原样重试必为 400 DUPLICATE_SOURCE_NAME，失败侧无 Manifest、上传记录不变、journal文件集合不变 | PASS |
| 07 | 旧冲突注入后 ack=false 且具体 Source Map issue；API 修复后无需重启恢复 | PASS |
| 08 | 六组旧冲突逐份增量修复，最终 ack 与查询恢复 | PASS |
| 09 | 响应、摘要、查询证据脱敏留存，资源清理 | PASS |
| 10／R1 | 先确立 ods_zebra→ods.zebra，再新建 ods.ods_zebra；重扫保留旧映射，新增 ods_ods_zebra；SQL 分别命中旧／新物理表，COUNT=1／2 | PASS |
| 11／R2 | 真实 aux.City 在 columns／namesOnly 扫描中分配 aux_City；Manifest 与实际 SQL 保留 aux.City，查询 COUNT=1 | PASS |
| 12 | 启用表保存与新建连接，分别实测成功／未确认／恢复；未确认显示 issue、错误反馈且无成功 Toast | PASS |

06 证明真实 API 争用与过期候选拒绝；受控“锁前合法、锁内过期”时序另由 Vitest 的 beforePublishLock 屏障测试证明，不能把 busy 本身当作唯一性复核证明。判定器另有 5 项回归，任意非预期 5xx／4xx、双成功均失败。

当前候选包含 P1-60：无绑定时 tools/list 隐藏 begin，旧客户端强调 begin 返回精确 begin_not_available。runner 只接受“工具确已隐藏＋HTTP200＋isError＋精确原因”的窄分支；tools/list／catalog／read／query 必须真实成功。**不将隐藏 begin 算为调用成功，也不豁免 query 失败。**

## 浏览器实测

安装版 Chrome `157.0.8103.79`，Playwright headed，1440×1000（本套件明确视口）。所有导航／反馈样本 `visibility=visible`、`hasFocus=true`，无 pageerror。真实 UI 登录与提交；无 API 拦截、无假 DOM。连接创建后逐份经正常 API 清理合成连接，避免前次夹具触发端点重复门禁；故障只注入独立临时项目，最后恢复原 Manifest。

以下是增加视口内断言后的补跑数据，单位 ms；完整跑次原始计时另保留在 full/browser/summary.json。

| 场景 | 导航→关键内容可见 | 点击提交→反馈可见 | 同次写 API | runtimeAck |
|---|---:|---:|---:|---|
| whitelist-success | 124 | 1594 | 1308 | true |
| connection-success | 128 | 2071 | 2007 | true |
| whitelist-unconfirmed | 134 | 1593 | 1313 | false |
| connection-unconfirmed | 83 | 2258 | 2179 | false |
| whitelist-recovered | 80 | 1562 | 1292 | true |
| connection-recovered | 91 | 2804 | 2703 | true |

计时按用户结果出现的里程碑；启用表的成功样本可能显示“正在刷新本地目录”，**不声明后台目录刷新完成**。本合同没有另立性能预算，单次样本不推断 p95。源名 source map 诊断内部规范化可为小写，大小写物理身份以实际 YAML／SQL 为证。

[启用表未确认截图](2026-11-20-codex-r1-r3-final-artifacts/viewport-supplement/browser/whitelist-unconfirmed.png)；[连接未确认截图](2026-11-20-codex-r1-r3-final-artifacts/viewport-supplement/browser/connection-unconfirmed.png)。其余六场景截图和响应在两份原始目录中。

## 自动化与候选构建

- 聚焦 Vitest：12 文件 **169 PASS**（在 webui 工作目录运行）；[日志](2026-11-20-codex-r1-r3-final-artifacts/regression-final.log)。R1／R2 的五个新增用例改前失败、改后通过，[改前](2026-11-20-codex-r1-r3-final-artifacts/r1-r2-before.log)／[改后](2026-11-20-codex-r1-r3-final-artifacts/r1-r2-after.log)。
- runner 判定器：**5 PASS**；[日志](2026-11-20-codex-r1-r3-final-artifacts/runner-tests-final.log)。
- 全库 TypeScript：HEAD 基线 50 条，本轮后 49 条，新增 0；修复了本功能测试夹具漏 sourceNameConflicts 的一条。**仍为 FAIL，不豁免 SC-09**；[差集](2026-11-20-codex-r1-r3-final-artifacts/typecheck-delta.json)、[基线](2026-11-20-codex-r1-r3-final-artifacts/typecheck-baseline.log)、[改后](2026-11-20-codex-r1-r3-final-artifacts/typecheck-after.log)。
- 标准构建镜像源 403 后，本次复用本地依赖镜像 `c1cd67a0df3dffd33b7c9d0c3914ca4a759bb5a6e4e8af3f9fe6b8c66323a218`：校验两份 lockfile 一致，git archive HEAD 加本轮 P1-64 源码／测试覆盖，在隔离容器完整运行 WebUI build，然后恢复 ENTRYPOINT／CMD／UID10001 固化为上述候选。**这是功能验证候选，未证明标准 Dockerfile 从零构建或发布出包。**[构建日志](2026-11-20-codex-r1-r3-final-artifacts/container-build.log)／[源码来源](2026-11-20-codex-r1-r3-final-artifacts/candidate-source.json)。
- R0 的运行源码绑定到候选摘要；runner／浏览器为宿主验收器。全套完成后只增加浏览器视口断言，已同镜像选择器补跑；宿主最终 hash 单列，未冒称全套在新增断言后再次执行。
- 合成 MySQL 共享链路，不扩称 Hive／SelectDB 元数据适配、客户现场资产或客户升级验收。标准出包不在本轮执行范围。

历史改前 FAIL 与上一轮 verify 保留；上一轮 06 的任意失败判定和无浏览器证据不足，由本跑次替代当前验收，不回改历史事实。三台账指向本跑次，合同全库类型门禁仍开。

最终评审见 [R1–R3终审](../../../../../reviews/2026-11-20-p1-64-r1-r3-final-review.md)。文档／术语／IA／台账五项门禁退出0，日志见本跑次artifacts的gate-*.log；其中共享工作树另一个未跟踪Plan有5项WARN，本功能链接与状态镜像另核对通过。
