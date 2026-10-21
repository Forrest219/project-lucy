# 升级功能验收 Checklist

适用当前 `lucy-v2.0` 的 14 条客户升级说明。用例存在不等于运行通过；本地 SQLite、HTTP/MCP 与桌面浏览器结果不替代真实 Agent、AWS 或 amd64 Kubernetes 验收。

本表同时列出本地、支线和目标环境要求。机器报告中的 `passed` 只代表本地 spec 用例通过，不代表该行全部发布要求完成。离线流程用例调用跑批核心并通过真实 HTTP/MCP 查询；完整离线 CLI 入口未纳入该用例。

机器映射：[upgrade-features.yaml](../../scripts/e2e/contracts/upgrade-features.yaml)。真实页面与 MCP 用例：[upgrade-features.spec.ts](../../webui/tests/upgrade-e2e/upgrade-features.spec.ts)。每次运行结果写入 `inbox/e2e/<runId>/upgrade-checklist.json`，不在本文件手填通过。

| ID | 客户价值 | 必须验证 |
|---|---|---|
| UPG-01 | 登录及会话安全 | 匿名拒绝；首建/登录；退出后原 Cookie 重放失败；并发首建仅一个成功 |
| UPG-02 | 多角色可保存且可用 | 页面勾选两个角色、保存、刷新仍保留；允许查询返回正确值；域外表拒绝 |
| UPG-03 | 启用表是共同边界 | 点名但未启用的表不可读；页面收窄后立即拒绝，恢复后允许；管理员跟随新连接且业务角色不跟随 |
| UPG-04 | Skill/Wiki 按角色隔离 | 授权者可读、未授权者不可读；缺失 ACL 默认拒绝；Skill 草稿/停用不可读；同角色闭合 |
| UPG-05 | 删除连接不破坏引用 | 页面显示引用及禁用确认；直接提交也拒绝；配置未被删除；无引用对照可删除 |
| UPG-06 | 列表和监控易用 | 大表列表按 Schema 折叠；状态筛选正确；调用与使用页面正常；慢/失败区域由配套性能用例验证 |
| UPG-07 | 版本与目录可核验 | 页面版本与健康接口一致；残留镜像提示可见；目录单向同步；目标包另执行 C01–C20，尤其 C12–C16 |
| UPG-08 | 无模型评测可归档 | 套件下载、真实跑批、结果上传、趋势和明细；1 对/1 错/1 未答时通过率 1/2；不完整结果拒绝 |
| UPG-09 | 发布前拦截错误类型 | number 对照通过；float 指到列并失败；修复后再次通过，不能仅验证错误文案 |
| UPG-10 | 问询到顶可停止 | 同一明确登记问询第 21 次停止；最多续办一次；120 秒分支；未登记兼容范围；过滤提示不泄露未授权来源 |
| UPG-11 | 中文关键词可检索 | 中文命中、无结果正常、权限过滤；不把字符串匹配写成词义理解 |
| UPG-12 | 问询记录不误归属 | 显式关联确认；候选不当确认；迟报不回绑早期业务调用；筛选变化编号稳定 |
| UPG-13 | 审计异常不放行数据 | admitted/prepared/delivered 顺序；提交失败 503 且无内容；崩溃及投影恢复不漏不重 |
| UPG-14 | Athena 配置与接入 | 页面使用 AWS 凭据、不收数据库密码；真实目标另跑 UPG-14-live，缺凭据记 blocked |

## 执行

```bash
npm --prefix webui run build
node scripts/e2e/run-upgrade-features.mjs --ktx-bin /absolute/path/to/ktx-0.16.0/bin/ktx
node --test scripts/e2e/__tests__/upgrade-feature-coverage.test.mjs
```

运行器只创建自己的隔离工程，真实 SQLite 数据和 KTX 0.16.0；没有网络响应 mock。截图、录像、trace 关闭，凭据不进入报告。退出码 0 为该局部范围通过，1 为失败，2 为有阻塞；结果固定 `releaseEligible=false`。不接受用本地通过替代 [E2E 发布证据清单](e2e-release-checklist.md)、[人工 GUI](manual-gui-e2e-checklist.md) 或 [客户升级交付 Checklist](../runbooks/customer-v2-upgrade-release-checklist.md)。

AWS 接入必须使用本 run 中配置的连接和受控测试凭据。客户升级/恢复按最终包及目标集群保留证据。原有冻结目录 255 个必测变体保持不变；本表补充功能映射，不移除原发布分母。

## Terminology Compliance

遵守 `webui/docs/00-product-terminology-standard.md`；无新增产品术语。

## 2026-10-20 实测

- Claude Code 最终独立 run：`inbox/e2e/upgrade-20261020-claude-confirm/`，桌面浏览器 19 条用例，18 通过、1 因缺 AWS 阻塞；14 个本地功能汇总通过。
- 支线：45 个文件、603 条通过。映射与源码守卫：34 条通过。构建、术语及 IA 边界检查通过。
- 全量 `test:e2e-harness`：725 条，715 通过、10 失败，集中在 `collect-gate-carrier.test.mjs` 的载体绑定判定，仍是发布前待处理项。
- AWS 连通性、真实 Agent 问答、完整离线 CLI、客户 amd64 Kubernetes 升级与恢复仍需相应环境验收；本地通过不替代这些结论。

复核与证据：[升级功能验证报告](../reviews/2026-10-20-upgrade-feature-validation.md)。
