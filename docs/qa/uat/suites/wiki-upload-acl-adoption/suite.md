# UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION — Wiki 覆盖上传 YAML 授权采用

| 元数据 | 内容 |
|---|---|
| Suite ID／用例版本 | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION`／v0.2 |
| 总账／需求 | P1-65／REQ-030-086 |
| 授权 | 2026-11-20 独立终审 PASS 后已同步终稿确权；本轮仍仅文档；不改运行代码，不执行改后复测，不将 UAT 标为 PASS，不 commit／push；**终稿确权 ≠ 开发授权 ≠ UAT PASS** |
| 修复合同 | [Spec](../../../../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) SC-01–14／[Plan](../../../../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md) |
| 目标 | 全真验证全部声明差异、三种显式选择、corrupt 分支、同键对照、digest／确认／恢复、管理访问与纯 MCP 合法读取 |
| 环境 | 本机 demo Docker WebUI `http://127.0.0.1:55176`＋MCP Proxy；真实登录与角色隔离 Agent；不要求问数方 WebUI 账号或宿主 |
| cases | [cases.md](cases.md)：必做 R0／01–12 及全部子例，逐例／子例独立 |
| fixtures | [fixtures.md](fixtures.md)：B／W／C、原始声明、正文 hash 与文件版本、setup／测量隔离 |
| runs | [runs/](runs/)；历史 [v0.1 基线](runs/2026-11-20-cursor-docker-baseline.md)＝FAIL，保留旧编号语义 |
| 当前执行状态 | **FAIL（改前基线）**；v0.2 R0／01–12 改后 verify **全部 NOT RUN**；终稿确权不构成 UAT |

## 边界与证据分工

- 遵守 [CONVENTIONS](../../CONVENTIONS.md)：全真；CR≠UAT。当前仅文档，不探查运行环境、不创建夹具或执行浏览器／MCP。
- 07 的真实浏览器证据证明用户显式选择、禁用与摘要；API 只能证明授权决议及写入，不能区分隐式默认参数与用户点击。
- 改后须同候选完整 R0／01–12 及全部子例；07 恰好记录 E1–E7，并在各元素下记录矩阵覆盖。06 在每个写入检查点执行，不能用最后一次读覆盖先前写入分支。
- 每例独立 key 或恢复完整字节并重取版本；03 明确 B≠W，05 明确 B→W 真变更。负控不得受上例污染，setup 不计作测量成功。
- 组件测试是功能合同自动化证据，不冒充全真浏览器／网络／MCP 证据。若委托人另授降级，逐项留 GAP 与限定范围；缺证子例不得计 PASS。
- 不验语义层 YAML、批量授权「已生效」整包或客户交付；不对客户生产施压。
- 清理仅在执行授权后进行：删除本次专用页／角色／Agent 或完整恢复基线，不 `down -v`；历史基线文件保持原样。

## 本轮修订

v0.2 用例定稿并经独立终审；终稿已确权。未新建 verify 跑次。见 [终审记录](../../../../reviews/2026-11-20-wiki-upload-acl-adoption-review.md)；测试结果仍以 INDEX 与真实 runs 为准。≠ 功能合同收口；≠ 可上线。
