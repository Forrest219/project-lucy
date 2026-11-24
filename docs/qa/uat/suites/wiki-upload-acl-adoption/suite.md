# UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION — Wiki 覆盖上传 YAML 授权采用

| 元数据 | 内容 |
|---|---|
| Suite ID／用例版本 | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION`／v0.2 |
| 总账／需求 | P1-65／REQ-030-086 |
| 授权 | 本轮四项验证缺口整改、真实前台浏览器／遗漏子例、严格 MCP、清理与收口复核已授权并完成；禁止 commit／push；≠ 可上线 |
| 修复合同 | [Spec](../../../../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) SC-01–14／[Plan](../../../../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md) |
| 目标 | 全真验证全部声明差异、三种显式选择、corrupt 分支、同键对照、digest／确认／恢复、管理访问与纯 MCP 合法读取 |
| 环境 | 本机 demo Docker WebUI `http://127.0.0.1:55176`＋MCP Proxy；真实登录与角色隔离 Agent；不要求问数方 WebUI 账号或宿主 |
| cases | [cases.md](cases.md)：必做 R0／01–12 及全部子例，逐例／子例独立 |
| fixtures | [fixtures.md](fixtures.md)：B／W／C、原始声明、正文 hash 与文件版本、setup／测量隔离 |
| runs | [runs/](runs/)；历史 [v0.1 基线](runs/2026-11-20-cursor-docker-baseline.md)＝FAIL，保留旧编号语义 |
| 当前执行状态 | **PASS（本轮收口复核）**；[新跑次](runs/2026-11-20-codex-closure-recheck.md)：51 个独立验收 ID 全通过，最终零残留；历史基线 FAIL 保留 |

## 边界与证据分工

- 遵守 [CONVENTIONS](../../CONVENTIONS.md)：全真；CR≠UAT。
- 07 的真实浏览器证据证明用户显式选择、禁用与摘要；API 只能证明授权决议及写入，不能区分隐式默认参数与用户点击。
- 本轮同一镜像复核 R0／01–12；07 前台浏览器含 E1–E7／M1–M9／三种选择，06 每次写入按三单角色分别验搜索／读取；遗漏子例与清理见 [新跑次](runs/2026-11-20-codex-closure-recheck.md)。
- 组件测试是功能合同自动化证据，不冒充全真浏览器／网络／MCP 证据。
- 不验语义层 YAML、批量授权「已生效」整包或客户交付；不对客户生产施压。
- 清理：删除本次专用页／角色／Agent 或完整恢复基线，不 `down -v`；历史基线文件保持原样。

## 本轮修订

v0.2 用例定稿；旧 gap-fill 的完整通过主张经本轮复核发现四项证据缺口，已由新前台浏览器／严格 MCP／遗漏子例／清理真实补跑关闭。见 [终审记录](../../../../reviews/2026-11-20-wiki-upload-acl-adoption-review.md)。≠ 可上线。

本轮前台可视证据与严格断言已替代旧 headless／弱断言收口依据；中间失败及实际补跑均留痕。判定见 [收口复核](../../../../reviews/2026-11-20-wiki-upload-acl-adoption-closure-recheck.md)。
