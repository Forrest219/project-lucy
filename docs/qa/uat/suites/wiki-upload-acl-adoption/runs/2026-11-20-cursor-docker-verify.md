# Run — 2026-11-20 — cursor-docker-verify

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION` |
| 选择器 | **改后 verify** |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`／MCP `http://127.0.0.1:57881`；`compose-lucy-1` healthy（`demo:upgrade` 平滑升级） |
| 候选 | `lucyVersion=0.30.0`；`gitSha=7e8ee88442c006d839e4fe13334f7fc45056d85e`；`gitDirty=true` |
| 总判定 | **PASS WITH GAP** |

## 结果表

| Case | 结果 | 摘要 |
|---|---|---|
| UAT-WUA-R0 | PASS | health／登录；记录版本与 dirty |
| UAT-WUA-01 | PASS | API 显式 `preserve_current`：正文更新、ACL 仍为 B |
| UAT-WUA-02 | PASS | API `use_uploaded`：B→W 与 W→B 均写入上传声明 |
| UAT-WUA-03 | PASS | 保留 digest＋采用上传 → `wiki_upload_preview_stale`；版本／正文／ACL 零变 |
| UAT-WUA-04 | PASS | 缺 `access` → `wiki_upload_access_required`；零写入 |
| UAT-WUA-05 | PASS | 独立 B→W 管理访问 PUT；版本变化、ACL＝W |
| UAT-WUA-06 | PASS | 纯 MCP：`wiki_search`／`wiki_read` 命中 `global/uat-wua-browser-07.md` 新正文（Proxy Bearer） |
| UAT-WUA-07 | PASS WITH GAP | 真实 Chrome 1920×1080：差异待选择＋禁用提交＋采用上传成交；E1–E7 见 [浏览器证据](../../../../reviews/2026-11-20-wiki-upload-acl-adoption-browser.md)。**GAP**：未在浏览器逐跑 M1–M9 全矩阵与保留／重设点击分支（组件 vitest 已覆盖矩阵） |
| UAT-WUA-08 | PASS | API `set`→C 成功 |
| UAT-WUA-09 | PASS | create 合法非空起算成功（抽样）；missing／empty／all 全分支未在本跑次逐条全真 |
| UAT-WUA-10 | PASS WITH GAP | K1 损坏上传＋显式保留 PASS；**GAP**：K2–K5 未本跑次全真（vitest／合同矩阵覆盖） |
| UAT-WUA-11 | PASS | 同键重排／重复角色可 `preserve_current` |
| UAT-WUA-12 | PASS WITH GAP | T1 空授权缺确认拒绝、确认后成功；**GAP**：T2–T4 乱序／网络失败／管理访问恢复未本跑次全真 |

原始 API 结果：`inbox/uat-wua-verify-results.json`；浏览器：`inbox/uat-wua-browser-evidence.json`。

## GAP

1. 07 浏览器未穷尽 M1–M9 与三条显式选择的全部点击组合。
2. 06 未用「仅增量角色／被移除角色」隔离 Agent 做负控对读（合法读已成交）。
3. 09／10／12 部分子例未全真，依赖聚焦 vitest 与抽样 API。

## 备注

- 历史 [v0.1 基线](2026-11-20-cursor-docker-baseline.md) FAIL 原样保留，不升级为 PASS。
- ≠ 功能合同收口；≠ 可上线；未 commit／push。
