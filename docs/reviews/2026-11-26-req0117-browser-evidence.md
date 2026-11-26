# REQ-0117 浏览器验证证据（中断快照）

| 元数据 | 内容 |
|---|---|
| 文档名称 | REQ-0117 浏览器验证证据（中断快照） |
| 文档类型 | Other（测试证据记录） |
| 版本 | v0.1 |
| 撰写日期 | 2026-11-26 |
| 撰写人 | Claude (kscc) |
| 委托人 | 张星辰 |
| 基于材料 | UAT-SUITE-ACCESS-WRITE-WINDOW 跑次 2026-11-26-claude-aww-partial／browser.json＋截图 |
| 适用范围 | Spec「浏览器验证」证据槽；AWW-08 续跑后以新版本覆盖 |
| 输出位置 | docs/reviews/2026-11-26-req0117-browser-evidence.md |

路由：/admin/roles、/admin/roles/:roleId、/admin/agents
视口：1920×1080（真实前台 Chrome，`headless:false`／`channel:chrome`／`bringToFront`＋visible/focus 断言）

跑次中断于 AWW-08 两阶段完成前（委托人 2026-11-26 指示终止测试）；以下为已完成用例的结果，其余待续跑。

- E1：通过（role-list 表格可见，primaryReady 903–1154ms；截图 E1-E5-roles-list-load.png）
- E2：失败（未验——超限拒绝提示的浏览器臂在 refuse 阶段，未及执行；API 侧证据 AWW-03 已 PASS）
- E3：失败（未验——读己之写浏览器断言被展示重建长尾打断；API 侧 AWW-05/06 已 PASS；修复后 API 冷读 193ms fresh）
- E4：失败（未验——重叠成交浏览器断言未完成；API 侧 AWW-02 已 PASS）
- E5：通过（「新建 Role」primary 可见，同 E1 截图）
- E6：失败（未验——保存进行中提示的浏览器断言未完成）
- E7：失败（未验）
- E8：失败（未验——409「配置已变化」提示浏览器断言未完成；API 侧 AWW-04 已 PASS）
- E9：失败（未验）
- E10：失败（未验——提交态「保存中…」断言未完成；单测与代码路径已验 mutationPending 禁用）
- E11：失败（未验）
- E12：失败（未验）
- E13：失败（未验——名册断言早前用错文本定位器；已改 testid，未重跑）
- E14：失败（未验）
- E15：失败（未验）
- E16：失败（未验）
- E17：失败（未验——「新建 Agent」primary 断言未完成）
- E18：通过（写窗内名册读取无错误终态文案；截图 E18-agents-no-error-terminal-during-write.png）

「失败」在此表示**未验**（用例未执行到断言），不是产品缺陷判定；API 侧同合同点均已 PASS（见跑次记录）。续跑按 `scripts/uat/access-write-window-browser.mjs <runDir> normal|refuse` 两阶段执行后覆盖本文件。
