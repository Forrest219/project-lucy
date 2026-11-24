# Run — 2026-11-20 — codex-closure-recheck

| 元数据 | 内容 |
|---|---|
| Suite／合同 | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION`；P1-65／REQ-030-086；Spec v0.2 SC-01–14 |
| 授权 | 委托人本轮授权四项验证缺口整改、真实前台浏览器／遗漏子例补跑、收紧 MCP 断言、夹具清理、Spec／Plan／台账同步及收口复核；不 commit／push |
| 执行者／时间 | Codex；2026-11-20 12:24:33–12:29:02（Asia/Shanghai；主轮＋补轮，初次脚本排错证据另留） |
| 环境 | 本机 demo `http://127.0.0.1:55176`／Proxy `http://127.0.0.1:57881`；`compose-lucy-1` |
| 真实候选 | 镜像 ID `sha256:c1cd67a0df3dffd33b7c9d0c3914ca4a759bb5a6e4e8af3f9fe6b8c66323a218`；容器启动 `2026-11-20T03:19:12.335405216Z`；主轮／补轮首尾均相同，无重建或切换 |
| 版本定位 | health：`lucyVersion=0.30.0`、`gitSha=7e8ee88442c006d839e4fe13334f7fc45056d85e`、`gitDirty=true`；实际身份以镜像 ID＋[相关源文件摘要](2026-11-20-codex-closure-recheck-artifacts/candidate-source-hashes.json)为准，四个功能相关文件与工作树一致，不把 dirty SHA 冒充干净提交 |
| 入口 | `node scripts/uat/wiki-upload-acl-recheck.mjs`；严格断言 helper：`scripts/uat/wiki-mcp-assertions.mjs` |
| 最终判定 | **PASS**：51 个独立验收 ID 全部通过，153 份角色检查分别断言搜索与读取，共 306 条真实工具断言；最终清理零残留 |
| 证据范围 | 本机真实 Docker＋真实前台可视 Chrome＋真实 Proxy Bearer；无 mock 成功体、无 WebUI 身份代替 MCP Agent、无宿主 attestation；非客户现场／发布取证 |

## 真实前台浏览器与即时计时

Chrome `headless=false`，1920×1080；每次导航／截图均 `bringToFront`，等待 `document.visibilityState==='visible'` 且 `document.hasFocus()===true`。28 次导航计时：导航开始→上传入口可见／前台状态确认，primaryReady **190.35–5966.84 ms，中位 863.25 ms**。751 份 API 时间独立记录（1.63–1056.4 ms，中位 14.57 ms），不以 API 时间替代页面体感。本条未设导航性能 SLO，不将该区间扩写为性能承诺。

真实网络延迟／失败只在本轮独立测试客户端的 Playwright route 上实施：延迟真实服务器 response，或真实请求 `abort('failed')`；不伪造 API 成功结果，不更改 Lucy 运行代码、不重启共享服务。浏览器与所有 route 在结束时关闭／移除。

## 验收结果与 SC 映射

| Case／子例 | 结果与可核对事实 | SC |
|---|---|---|
| R0 | 同一镜像候选；每个 Role 单独新建测试 Agent，三角色分别为 `demo_readonly`／`lucy_admin`／`lucy_ops_reader`；Token 只在内存 | 前置 |
| 01／02／08 | 独立保留、加宽、收窄、重设 C 写入；每次立即用三角色分别搜索／读取本次 key＋正文标记，非法角色拒绝 | 02／03／08／11 |
| 03／04 | digest 错配与缺 access 返回指定错误；完整正文 hash、声明及版本零变化 | 04／05 |
| 05 | 前台 WebUI B→W 管理访问确有变更；新角色变更前拒绝、保存后可搜可读，正文不丢 | 07／08 |
| 06 | 所有写入检查点逐角色做两次独立工具调用；搜索必须结构化成功且精确 key 的出现与预期一致，读取必须精确 key＋本次 marker；拒绝只接受稳定 `context_not_available`，网络错误、泛化错误、空响应不算通过 | 08 |
| 07·M1–M9 | 前台可视浏览器逐例初始待选择＋确认禁用且未发 commit，显式采用与风险确认后落盘；另独立 M1 保留／重设成功，每次 MCP 复核 | 01／02／03／06／11 |
| 07·E2 | 对真实 preview response 暂缓交付，加载态可见且提交禁用；释放后选择并成功写入，旧 digest 无放行机会 | 14 |
| 09 | create 非空／missing／empty／all／set=C；未确认拒绝、页面列表及容器文件均不存在，确认后创建并验 MCP。Lucy 缺失页 GET 返回占位 200，未以 HTTP 404 作为不存在判据 | 09／13 |
| 10·K1–K5 | 上传 corrupt 采用拒绝零写入；保留／重设、当前 corrupt 故意保留／合法采用、双 corrupt 保留／重设、create 重设均独立夹具，立即 MCP 对读；另前台 corrupt 保留／重设可达。K5 管理修复由下述 T4·corrupt 完整覆盖 | 01／07／08／10 |
| 11 | roles 重排＋重复、all／all、empty／empty、missing／missing 前台均无新增必选步骤，既有风险确认仍生效 | 12／13 |
| 12·T1 | missing／empty／all 各自服务端缺确认拒绝并比对零写入，补确认成功；前台勾选后切换保留再切回，旧确认已清空、提交禁用，重确认后成功 | 13 |
| 12·T2 | 前台快速触发真实保留／采用控件请求，暂缓首个真实 response，末选 set=C 的 fresh preview 完成后才交付旧 response；旧结果被丢弃，最终 C 与 marker 正确 | 14 |
| 12·T3 | 另一真实管理访问使版本变化，前台旧 commit 409且文件相对提交前零变化；保留原上传体与选择重新预检后成功。另真实 preview 网络失败在 Dialog 内显示原因并禁用旧提交，取消重开、重选后成交 | 14 |
| 12·T4 | empty／missing／corrupt 三类独立页，均由前台「管理访问权限」改为 C；保存前 MCP 拒绝、保存后逐角色搜索／读取与拒绝对照正确 | 07／08／14 |

## E1–E7 浏览器观察

| 编号 | 结果／证据 |
|---|---|
| E1 | PASS；上传覆盖入口与独立管理访问均可达，T4 不以 MCP 可读原页为前提 |
| E2 | PASS；[真实预检加载态](2026-11-20-codex-closure-recheck-artifacts/supplement/E2-preview-loading.png)，加载期间不可提交 |
| E3 | PASS；[真实网络失败](2026-11-20-codex-closure-recheck-artifacts/T3-network-error.png)、[冲突后重新预检](2026-11-20-codex-closure-recheck-artifacts/T3-conflict-repreview.png)，两条恢复均后续成交 |
| E4 | PASS；保留／采用／重设／管理访问均落盘成功；API 读回、文件版本及 MCP 本次正文一致 |
| E5 | PASS；[M1 待选择](2026-11-20-codex-closure-recheck-artifacts/M1-pending.png)，M1–M9 均逐例观察，corrupt 不能直接采用且保留／重设可达 |
| E6 | PASS；Dialog 页脚只有确认主动作；未选择、预检加载及缺风险确认时提交禁用；取消可恢复。沿用现有按钮层级，已对截图与组件结构复核 |
| E7 | PASS；现有／上传／最终摘要可见；未选明确待选择，missing 与 empty 可区分，最终值与选择／写入一致 |

## 清理结果

仅删除 `global/uat-wua-*` 套件命名空间：主轮删除 229 页（含历史残留与中断夹具），补轮删除 4 页，共 **233 页**；未写或删除共享正式 Wiki。共删除 **9 个**本轮／中断运行创建的专用 Agent；补轮逐个吊销 **13 个**套件 Token（含历史 Token）。主轮删除 Agent 时相应 Token 同步吊销，审计保留，不作为活跃残留。

最终双重核对：API Wiki 列表残留 0、容器 `/data/lucy/config/wiki/global` 同命名空间文件残留 0、Token 列表套件标签残留 0、专用 Agent 残留 0、清理错误 0。客户端网络拦截移除、浏览器关闭；未 `down -v`，未改无关 Role／Agent。

## 原始证据与中间失败

- 最终合并判定：[final-summary.json](2026-11-20-codex-closure-recheck-artifacts/final-summary.json)。按同一 ID 后续真实结果覆盖中间失败，未执行的分支不计通过。
- 主轮：[results.json](2026-11-20-codex-closure-recheck-artifacts/results.json)：46 项功能／环境通过；清理因 Token owner 应取 `agent.id` 而失败，原始 FAIL 保留。
- 补轮：[supplement/results.json](2026-11-20-codex-closure-recheck-artifacts/supplement/results.json)：加载态、三类服务端确认负控与最终清理，6／6 通过；实际零残留才关闭清理失败。
- 初次脚本排错：[attempt1/results.json](2026-11-20-codex-closure-recheck-artifacts/attempt1/results.json)：不存在页面判据、乱序拦截异常均为测试脚本问题；修正后对应真实测试已重新通过，不伪改旧记录。
- 原 [baseline FAIL](2026-11-20-cursor-docker-baseline.md)、[verify PASS WITH GAP](2026-11-20-cursor-docker-verify.md)、[旧 gap-fill](2026-11-20-cursor-docker-gap-fill.md) 保留；旧 headless 浏览器与弱断言不作为本轮收口依据。

本轮未修改 Lucy 产品运行代码；只新增验证脚本／断言测试及维护文档。聚焦 Vitest 3 文件／161 项通过，严格断言 helper 的 Node 3 项通过。功能合同可以收口；本机证据不表示可上线或客户现场已验。未 commit／push。
