# Run — 2026-11-20 — cursor-docker-gap-fill

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION` |
| 选择器 | **GAP 补跑**（在 verify 之上穷尽 06／07／09／10／12 子例） |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`／MCP `http://127.0.0.1:57881`；`compose-lucy-1` healthy |
| 候选 | `lucyVersion=0.30.0`；`gitSha=7e8ee88442c006d839e4fe13334f7fc45056d85e`；`gitDirty=true` |
| 总判定 | **PASS** |

## 结果表

| Case | 结果 | 摘要 |
|---|---|---|
| UAT-WUA-R0 | PASS | health／登录；与 verify 同候选 |
| UAT-WUA-01–05／08／11 | PASS | 沿用 [verify](2026-11-20-cursor-docker-verify.md) API 证据 |
| UAT-WUA-06 | PASS | 隔离 Agent：`demo_agent`（仅 `demo_readonly`）／`demo_ops`（仅 `lucy_ops_reader`）；收窄后增量角色搜索不可见；加宽／set／T4 恢复后可读 |
| UAT-WUA-07 | PASS | 真实 Chrome 1920×1080：M1–M9 均初始待选择＋禁用提交后显式采用成交；另独立 M1 保留／M1 重设（`set`→C）成交。primaryReady 约 214–368 ms |
| UAT-WUA-09 | PASS | create：合法非空／missing／empty／all（缺确认拒绝＋确认成功）／`set=C` |
| UAT-WUA-10 | PASS | K1–K5 全部分支（含 corrupt 当前种子写 `/data/lucy/config/wiki`） |
| UAT-WUA-12 | PASS | T1 missing／all；T2 客户端 route 延迟制造预检乱序后末选 `set=C` 成交；T3 管理访问改版后旧 commit 冲突再恢复；T4 empty→管理访问→C |

## 证据

- API／MCP：`inbox/uat-wua-gap-results.json`（22/22）
- 浏览器矩阵：`inbox/uat-wua-browser-matrix-results.json`（M1–M9／保留；M1-set 见 `inbox/uat-wua-browser-m1-set.json`）
- T2：`inbox/uat-wua-browser-t2.json`
- 浏览器说明：[browser 证据](../../../../reviews/2026-11-20-wiki-upload-acl-adoption-browser.md)

## 备注

- 历史 [v0.1 基线](2026-11-20-cursor-docker-baseline.md) FAIL 原样保留。
- 临时 Agent Token 仅内存使用，未写入本跑次；UAT 专用 Wiki 页留在 demo volume，可按 fixtures 清理。
- ≠ 可上线；未 commit／push。
