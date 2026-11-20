# UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION — Wiki 覆盖上传 YAML 授权采用

| 元数据 | 内容 |
|---|---|
| Suite ID／用例版本 | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION`／v0.2 |
| 总账／需求 | P1-65／REQ-030-086 |
| 授权 | 2026-11-20 终稿确权；开发＋UAT＋GAP 补跑已授权并执行；INDEX＝PASS；≠ 可上线 |
| 修复合同 | [Spec](../../../../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) SC-01–14／[Plan](../../../../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md) |
| 目标 | 全真验证全部声明差异、三种显式选择、corrupt 分支、同键对照、digest／确认／恢复、管理访问与纯 MCP 合法读取 |
| 环境 | 本机 demo Docker WebUI `http://127.0.0.1:55176`＋MCP Proxy；真实登录与角色隔离 Agent；不要求问数方 WebUI 账号或宿主 |
| cases | [cases.md](cases.md)：必做 R0／01–12 及全部子例，逐例／子例独立 |
| fixtures | [fixtures.md](fixtures.md)：B／W／C、原始声明、正文 hash 与文件版本、setup／测量隔离 |
| runs | [runs/](runs/)；历史 [v0.1 基线](runs/2026-11-20-cursor-docker-baseline.md)＝FAIL，保留旧编号语义 |
| 当前执行状态 | **PASS（gap-fill）**；历史基线 FAIL 保留；见 [2026-11-20-cursor-docker-gap-fill](runs/2026-11-20-cursor-docker-gap-fill.md) |

## 边界与证据分工

- 遵守 [CONVENTIONS](../../CONVENTIONS.md)：全真；CR≠UAT。
- 07 的真实浏览器证据证明用户显式选择、禁用与摘要；API 只能证明授权决议及写入，不能区分隐式默认参数与用户点击。
- 改后同候选完整 R0／01–12 及全部子例已有证据；07 记录 E1–E7 与 M1–M9／保留／重设；06 在各写入检查点用隔离 Agent。
- 组件测试是功能合同自动化证据，不冒充全真浏览器／网络／MCP 证据。
- 不验语义层 YAML、批量授权「已生效」整包或客户交付；不对客户生产施压。
- 清理：删除本次专用页／角色／Agent 或完整恢复基线，不 `down -v`；历史基线文件保持原样。

## 本轮修订

v0.2 用例定稿；gap-fill 关闭先前 PASS WITH GAP 子例缺口。见 [终审记录](../../../../reviews/2026-11-20-wiki-upload-acl-adoption-review.md)。≠ 可上线。
