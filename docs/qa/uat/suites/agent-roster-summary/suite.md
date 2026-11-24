# UAT-SUITE-AGENT-ROSTER-SUMMARY — Agent 名册摘要与按需详情

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | UAT-SUITE-AGENT-ROSTER-SUMMARY / v0.3（分批） |
| 日期 | 2026-11-20 |
| 总账 / 合同 | P1-66／REQ-030-087 · [Spec](../../../../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [Plan](../../../../plans/lucy-20261120-agent-roster-summary-projection-plan.md) |
| 当前结果 | **PASS WITH GAP（仅 F66-A）**；[本批收口](runs/2026-11-20-codex-p166-batch-a.md)。原 v0.2 F66 [完整矩阵 FAIL](runs/2026-11-20-codex-p166-docker.md) 保留；完整判定以 INDEX 为准 |
| 授权 | 委托人2026-11-20确认 v0.2 定稿、授权开发及全部 Docker 浏览器验证；本批分批收口并授权commit，不推送／发布，不访问109验收 |
| 环境 | 隔离 Docker compose 单实例＋专用库与卷；宿主桌面前台 Chrome 1920×1080；正常盘资源见 fixtures |
| cases / fixtures / runs | [cases](cases.md) · [fixtures](fixtures.md) · [runs 说明](runs/README.md) |
| 判定 SOT | [INDEX](../../INDEX.md)；suite 不另立第二份测试台状态 |

过程评审：[8 项发现与修订](../../../../reviews/2026-11-20-p1-66-spec-plan-strict-review.md)。

## 出口与分层

委托人2026-11-20批准分批。当前选择器 **F66-A**＝Spec v0.3 BA-01–07；本批只收口列表摘要、单对象按需详情和兼容读路径。下方 F66 为原完整合同，不宣称已经完成；冷编译／预热／首访与扩展规模矩阵暂停在批次 B。不得把 F66-A 的局部通过覆盖完整 F66 的失败。

- 功能选择器 **F66**：ARS-R0／01–12 全部必做；覆盖 Spec SC-01–SC-12 与 E1–E18。BAL／SKEW 各自的 B109／W2／W5 共 6 组独立命名，不冒充 RACS 完整 2×／5× 联合已过。
- P1-58 已有 batch／分区／缓存收益不重复记本条成果；本套件关注权限投影、按需单对象、兼容与同宽度浏览器体感。
- 局部纯 MCP 正反例是本条“摘要不得参与授权”的验证；持续跨模块／跨身份并发与系统故障仍归 P1-13／RACS-R 发布取证，不倒挂功能出口。
- 不包含移动端、现场升级、客户拓扑、完整 KTX 性能治理、虚拟滚动或非 Agent 消费者全量迁移。

## 必须遵守

遵守 [CONVENTIONS](../../CONVENTIONS.md) 和 DEVELOPMENT 的真实前台浏览器＋即时计时要求，页面与 API 分列；只跑 HTTP／headless／保留旧缓存行不记 WebUI PASS。夹具必须由真实 Lucy 编译生成权限，不允许 mock 权限响应或直接堆 JSON。

## 状态与 GAP

`GAP-UAT-P1-66`：批次A已收口，原冷读／首访失败及剩余完整矩阵保留在暂停的批次B。下一批由委托人重新启动。该 GAP 不改变 P1-58／59 的现行结论，不构成已接受批次A的阻断，也不把109探查包装成本套件已跑。
