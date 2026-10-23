# 升级功能测试验证与复核

日期：2026-10-20。分支：`lucy-v2.0`，最终独立 run 的 HEAD `c854d55e68f06570c5540ad2be2a76bb9e1e94a3`，含未提交改动。客户说明继续使用升级批次名 v0.20；代码产品版本为 2.0.0。

## 结论

已修订客户说明，建立 14 项功能映射与 Checklist，新增 19 条真实桌面浏览器 / HTTP / MCP 用例。最终独立运行 18 通过、1 因缺真实 AWS 连接阻塞。查询访问真实 KTX 0.16.0 和隔离 SQLite，已验证订单合计为 600；没有网络响应 mock。

该结果只覆盖声明的本地范围。原有冻结目录仍为 255 个必测变体，未被本专项替代；全量测试工具还有 10 条失败，不能据此签署发布通过。

## 修订与修复

1. 客户文案：将“全部 Skill/Wiki 可读”改为按角色授权、缺失授权默认拒绝；将“一问一条记录”改为明确关联与候选关联分开；补充登录、启用表边界、删除引用保护、审计、版本目录诊断及 Athena 验收边界。保持简约客户措辞，不承诺语义搜索或客户环境秒级响应。
2. 真实用例发现并修复：本地工具提前返回绕过问询预算；Wiki 上游空索引漏掉当前生效目录的中文关键词命中；问询关联状态及 original/effective 字段未写入审计投影；跑批结果缺 suite hash，导致结果上传被拒绝。
3. 测试接线：补齐审计路由 mock；修正密码选择器和保存确认时序；修正测试模板 YAML、旧目录摘要及引导凭据静态检查误报。恢复非法列类型后重新校验，避免污染后续用例。
4. 用例执行器：保留失败和阻塞，记录候选摘要、KTX 版本、原始报告摘要及凭据扫描结果；禁止运行中源码变化被误算通过。固定 `releaseEligible=false`。

## 实际验证

| 验证 | 结果 | 原始证据 |
|---|---|---|
| Codex 支线回归 | 45 文件，603/603 通过 | `inbox/upgrade-feature-verification/branch-final.json` |
| 功能映射、浏览器源码守卫、目录与清单链接 | 34/34 通过 | `inbox/upgrade-feature-verification/coverage-final.log` |
| 版本与客户发布工作流支线 | 26/26 通过 | `inbox/upgrade-feature-verification/release-branch-final.log` |
| Claude Code 最终独立真实运行 | 19 条，18 通过、1 跳过并记 blocked；退出 2 | `inbox/e2e/upgrade-20261020-claude-confirm/` |
| 全量 E2E 测试工具 | 725 条，715 通过、10 失败 | `inbox/upgrade-feature-verification/harness-final.log` |
| 构建、术语、IA 边界 | 通过 | 本会话执行输出 |

最终独立 run 的功能汇总为 14 passed / 0 failed / 1 blocked；`secretScan.status=passed`、`hits=[]`、`sourceChangedDuringRun=false`、`releaseEligible=false`。Playwright 原始报告 SHA-256：`34468f398a8b38510b6ac1839b9f59418af4171f461bda428c86d443c28ed015`。

## Claude Code 检查与 Codex 复核

Claude Code 使用本机已配置的 CLI 和 provider，实际执行测试；没有冒充浏览器测试的结构绿灯。三轮原始报告保留在 `inbox/upgrade-feature-verification/claude-review.json`、`claude-final.json`、`claude-confirm.json`。

- 采纳首轮发现：补上 Skill 真实 search/read，以及草稿、停用、无 ACL、跨角色的反例；增加实际 fixture 输出契约与产物凭据扫描。
- 采纳第二轮回归：无条件本地 Wiki 返回使两条既有 smoke 失败。最终实现保留上游参数改写和 ACL 过滤，只对成功且显式为空的结果补查 canonical 内容；上游/过滤错误不被补查遮蔽。既有 smoke 断言未删改，复跑通过。
- 未采纳将本地测试强制改为 release/external 的建议：该专项明确只用隔离 fixture、固定无发布资格。也未把 `retired.yaml` 同步回 canonical，因为它是旧目录残留的必要负对照。
- Claude Code 最终确认：4 文件、49 条通过；真实运行仍为 18 通过、1 阻塞，确认 smoke 回归已解决。Codex 核对原始 Playwright 19 条结果、功能映射、源码差异与摘要，独立扩展支线回归；没有将 Claude 的结论直接当成验收结论。

## 尚未完成的发布验收

- 全量 harness 的 10 个失败均在未修改的 `collect-gate-carrier.test.mjs` / collector 路径：测试 ask 的 `answerPath` 与日志、导出等实际扫描路径没有绑定，扫描判为 unresolved identity；部分旧断言原期待 passed/blocked，实际为 failed。本次没有放宽泄漏扫描或删除断言。复现：`node --test scripts/e2e/__tests__/collect-gate-carrier.test.mjs`。
- Athena 表单已验证；真实 AWS 连通性没有测试连接和受控 AWS 凭据，明确 blocked。
- 本专项评测用例执行跑批核心和真实 MCP 查询、上传、趋势；没有执行完整离线 CLI 入口，因此不证明该入口可用。
- 真实 Agent 问答、客户 amd64 Kubernetes 的升级、配置保留与恢复未执行，需按目标包和原发布门禁保留证据。

测试源与验收断言见 [Checklist](../qa/upgrade-feature-checklist.md) 和 [功能映射](../../scripts/e2e/contracts/upgrade-features.yaml)。

## Terminology Compliance

遵守 `webui/docs/00-product-terminology-standard.md`；无新增产品术语。
