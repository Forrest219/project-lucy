# 跑次：2026-11-28 kscc AWW-08 浏览器最终收口（E4/E8b 返工复测＋阶段 2 refuse 首跑）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 跑次：2026-11-28 kscc AWW-08 浏览器最终收口 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-28 |
| 撰写人 | Claude（kscc） |
| 委托人 | xingchen |
| 基于材料 | UAT-SUITE-ACCESS-WRITE-WINDOW suite/cases；[2026-11-27-claude-aww-final](2026-11-27-claude-aww-final.md)（E4/E8b 诊断）；[2026-11-27-kimi-aww-closure](2026-11-27-kimi-aww-closure.md)（跑器/产品返工）；`cf42b42a` 已入库返工 |
| 适用范围 | UAT-AWW-08 前台浏览器 E1–E18 收口判定；REQ-0117 套件总判定推进 |
| 输出位置 | docs/qa/uat/suites/access-write-window/runs/2026-11-28-kscc-aww-final.md |

## 环境

| 项 | 值 |
|---|---|
| 栈 | 隔离 compose `lucy-req0117-uat`（WebUI `:55386`／MCP `:57995`） |
| 镜像 | `project-lucy:demo` 重建于 HEAD `5c5ce3ee`（工作树当时含未提交跑器修复；`LUCY_GIT_DIRTY=1`）；容器标注 gitSha `8057bf76`（重启时树 HEAD，`5c5ce3ee..8057bf76` 仅 P1-91 收口 docs 提交，产品代码无差） |
| 夹具 | req0117 2000 物理表＋schema manifest＋启用表 2003 张（`fixture.mjs` 重播后经 `stack up` data-init 复位再重播一次，全程幂等） |
| 阶段 2 容器 | `access-write-window-wait-override.yml`（`LUCY_PUBLISH_WAIT_BUDGET_MS=200`／`MAX_WAITERS=1`／`RETRY_AFTER=5`）重建，跑毕以基础 compose 还原并验证 env 注销 |

## 诊断与跑器返工（本跑次授权轨道内，未改产品代码）

1. **E4/E18 角色定义 META-only bug（跑器，已修）**：重叠写与 E18 角色原定义 `tools:["lucy_catalog"]` 为 META-only；按 Spec 182 口径 `capabilities=(tools∩DataPlane)×sources`，META-only＋selectors 角色解析为 0 capability，dryRun 恒 400「resolves to 0 source」。容器内 tsx 直查实证：`["lucy_catalog"]→sources 0`、`["lucy_catalog","lucy_query"]→sources 1`。两处角色定义补 `lucy_query`；E18 补写状态断言（此前写 400 被静默吞掉，PASS 为空转）。
2. **E8b racs 绑定取值错位（跑器，已修）**：PATCH `dryRun` 不带 `baseObjectVersion` 时服务端不签发 racs 绑定（响应无 `previewToken`），跑器抢改 409 `PREVIEW_TOKEN_REQUIRED`；补带 `baseObjectVersion` 后实测签发（`previewToken`＋`baseObjectVersion`＋`compileInputsDigest`），并用绑定值（而非 GET 旧值）发抢改写。
3. **阶段 2 持窗时序竞争（跑器，已修）**：原序「confirm 点击→发持窗写」下 UI 写可能先抢协调器，持窗写反被 503（refuse 首轮实测）；改为持窗写先发在途（1 s 间隔）→ confirm → UI 写 200 ms 预算超限 → 诚实拒绝，持窗写最终 200 收尾。
4. **环境事件如实登记**：跑次中段有并行会话操作宿主 Docker（AWW 栈被外部停止 exit 143/137、新起 Doris 栈）；经委托人裁定（「停掉对方，我继续」）停 Doris 容器并恢复 AWW 栈后继续。`browser`／`browser2`／`refuse` 三个受污染轮次证据保留不作判定依据。

## 逐用例判定（判定证据＝`browser4`＋`refuse2`）

| 用例 | 判定 | 证据 |
|---|---|---|
| E1/E5 列表加载＋创建入口 | **PASS** | primaryReady 867 ms；`runDir/browser4/` |
| E3 读己之写 | **PASS** | apiWriteMs 6093 ms（暖编译缓存；对照 claude-final 冷启 71.5 s）／frontMs 1343 |
| E4/E12 编辑保存提交态＋重叠成交 | **PASS** | `save-submit-state`=「保存中…」捕获成功（kimi testid 修复生效）；重叠写走诚实拒绝分支：503＋`Retry-After: 5`＋holder=`role_policy_save`（Spec E4/E10 双分支合规） |
| E8b 同对象版本冲突提示 | **PASS** | 409 → 审阅抽屉关闭 → 「配置已变化」恢复面板可见 → 草稿保留（`draftKept: true`） |
| E13/E17 Agent 名册加载＋入口 | **PASS** | primaryReady 4064 ms |
| E18 写窗内名册无错误终态 | **PASS** | 写窗真实在途（apiWriteMs 67707 ms 内页面读取无错误终态）；写成交或诚实拒绝断言通过 |
| E2/E8a 超限诚实拒绝＋草稿保留（阶段 2） | **PASS** | 持窗写 200（持有 26.7 s）；UI 写 200 ms 预算超限 → 抽屉关闭 → 「有变更正在保存，请稍后重试」可见 → 草稿保留；`refuse2/` |

## 边界与结论

- **AWW-08 前台浏览器 E1–E18 全绿**（阶段 1＋阶段 2 首次成套完成）；此前登记的「ReviewDrawer 提交态时序 Debugger 排查（潜在回归候选）」**关闭**：根因为跑器定位/合同错位（kimi `cf42b42a`＋本跑次三处修正），非产品回归。
- R0／01–07（API＋单测侧）沿用 [2026-11-26-claude-aww-partial](2026-11-26-claude-aww-partial.md)／[2026-11-27-claude-aww-final](2026-11-27-claude-aww-final.md) PASS 证据（套件先例：栈重建仅重播夹具＋重跑浏览器阶段；`8b8fb83c→5c5ce3ee` 无 acl／roles 产品代码改动）。
- 跑器修正四处未提交，随本跑次交委托人决定入库。
- **≠ 功能合同收口；≠ 可上线。**
