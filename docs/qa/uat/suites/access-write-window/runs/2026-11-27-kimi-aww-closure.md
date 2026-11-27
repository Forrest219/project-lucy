# 跑次：2026-11-27 kimi AWW-08 浏览器阶段（E4/E8b 返工后复测·诊断推进）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-WRITE-WINDOW` |
| 日期／Agent | 2026-11-27／Kimi |
| 环境 | 隔离栈 `lucy-req0117-uat` 以 HEAD `8305c87e`＋未提交修复重建（`LUCY_GIT_DIRTY=1`）；**容器重建时未按规程同步重播夹具**（见诊断 2）；WebUI `:55386` |
| 判定 | **AWW-08 仍未收口**（E4/E8b 失败点推进，跑器两处修正＋产品 UX 修复一项落地；夹具复位后复测未执行——委托人指示本轮止步于代码修正。套件总判定维持 BLOCKED） |

## 逐用例（阶段 1 normal，`runs/2026-11-27-kimi-aww-closure/browser/browser.json`）

| 用例 | 判定 | 证据 |
|---|---|---|
| E1/E5 列表加载＋创建入口 | PASS | primaryReady 2.0 s |
| E3 读己之写 | PASS | apiWriteMs 18.4 s |
| E4/E12 编辑保存提交态＋重叠成交 | FAIL | `API 重叠写未成交：503`（诊断 1）；**提交态断言已过**——`save-submit-state` 捕获「保存中…」，testid 定位修复生效 |
| E8b 同对象版本冲突提示 | FAIL | `API 抢改失败 409`（诊断 2，环境性）；未走到 UI 确认步 |
| E13/E17、E18 | PASS | 5.1 s／7.1 s |

## 诊断与返工

1. **E4 断言严于 Spec（跑器，已修）**：Spec E4/E10 原文为「重叠提交经有界等待后**成交或得到可重试提示**」；夹具规模写窗 ~18–45 s 超 15 s 等待上限时，503 `PUBLISH_COORDINATOR_BUSY`＋`Retry-After` 是合规分支（overlapApiMs 16.6 s 实测吻合预算）。跑器已改为双分支均判合规（503 分支必须带重试指引），并记录实际分支；`dryB`/`dry2` 补状态检查与错误体。
2. **夹具半状态（环境，非产品缺陷）**：`stack up` 重建容器时 MySQL 匿名卷与语义注册态未随规程复位，跑次中段起新角色 selector 解析持续 `role resolves to 0 source`（存量 v2 物理名角色不受影响），E8b 抢改 409 即此期间 `PREVIEW_INPUT_CHANGED` 表现。`fixture.mjs clean && up` 完整复位（含 manifest 上传）后物理表/声明/启用表齐备；**复位后浏览器复测未跑**（委托人指示本轮仅落代码修正）。
3. **产品 UX 修复（随本跑次授权落地）**：`RoleDetail.handleClassifiedWriteError` 两个恢复面板分支进入时 `setReview(null)`（modal 抽屉不再遮挡「配置已变化／有变更正在保存」面板，草稿保留）；`RolePermissionReviewDrawer` 确认按钮补 `data-testid="role-review-confirm"`；`role-detail.test.tsx` 43/43 绿（含新增 409 分支关抽屉用例）。跑器 E8b/E2 已加「抽屉关闭」断言待下轮验证。

## 边界与结论

- 套件总判定维持 **BLOCKED**；下轮动作：夹具已复位，直接重跑阶段 1（E4 双分支＋E8b 全链）与阶段 2（refuse，E2/E8a），无需再改代码。
- 本轮遗留探针角色均未落库（dryRun 或 400 拒绝），栈 `lucy-req0117-uat` 保留运行。
- **≠ 功能合同收口；≠ UAT PASS；≠ 可上线。**
