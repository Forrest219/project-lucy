# Admin API Agent 可发现性：Codex 交叉审阅

- 审阅方式：本机 Codex CLI，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，只读。各轮修订由实施代理落地。
- 对象：`lucy-20261103-admin-api-agent-discoverability` Spec／Plan。
- 原始摘录：`inbox/codex-prompt-admin-api-agent-discoverability-roundN.md`、`inbox/codex-review-admin-api-agent-discoverability-roundN.txt`（可删工作副本）。
- 上限：三轮。

定稿只覆盖设计合同。当时「功能合同未收口，SC 未执行，运行代码未改」已作废，不得当作现值；现行状态以 Spec 头部为准。定稿不表示开发已授权。本条收口不表示可上线。

## 第 1 轮

对象是 Spec／Plan **v0.1**。结论：**退回修订，不定稿。** 阻塞 2，高 3，中 2，低 1。摘录：`inbox/codex-review-admin-api-agent-discoverability-round1.txt`。

1. **R1｜阻塞** — OpenAPI 统一「省略 dryRun＝预览」与 Token 签发／续期真实默认（省略即写入）相反。
2. **R2｜阻塞** — `after.version` 误允许等于 `policyVersion`；与 GET／PATCH 并发版本不是同一东西。
3. **R3｜高** — D3 框架前提写错（鉴权早于 notFound，非早于 Routing）；匹配语义／CSRF 序／未登录 405 未定案。
4. **R4｜高** — SC-01／02 过宽，不足以证明登录＋开通契约完整。
5. **R5｜高** — `includeClientConfigs` 未定义 MCP endpoint 无效时是否已落盘。
6. **R6｜中** — `after` 适用面与伪代码／Plan／SC 不一致。
7. **R7｜中** — `expires_in` 换算与双字段等值无执行定义。
8. **R8｜低** — 状态镜像未逐字一致。

已核对无问题：D1／D7 与 L25-16 方案 C 无直接冲突；`TOKEN_LABEL_TAKEN` 无 detail、未登录未知路径先 401 等现状前提属实；闭口层级未把发布取证塞进出口；目标 Spec／Plan 文档门禁无新增机器违规。

## 第 1 轮后修订（→ v0.2）

| 项 | 处理 |
|---|---|
| R1 | D2／SC-02：按 operation 声明 dryRun；不统一改默认 |
| R2 | D5／SC-10：`after.version`＝访问配置并发版本；连续 PATCH；禁 policyVersion 替代 |
| R3 | D3／SC-04：CSRF 后会话前；Fastify 路由器语义；未登录 405；动态 path／HEAD |
| R4 | D2 枚举 method＋path；登录字段／Cookie；SC-01／02／17 |
| R5 | D6／SC-14：先校验 endpoint；503 且不落盘 |
| R6 | after 仅 Agent POST／PATCH；SC-09／10／16 |
| R7 | t0＋日历快捷档＋等值双传；SC-11–13 |
| R8 | Spec／Plan／索引状态段对齐；SC-18 |

## 第 2 轮

对象是 Spec／Plan **v0.2**。结论：**退回修订。** 阻塞 1，高 3，中 1，低 0。摘录：`inbox/codex-review-admin-api-agent-discoverability-round2.txt`。

第 1 轮闭合表：R6／R7／R8 闭合；R1–R5 部分闭合。

残留／新问题：

1. **R1-残留｜阻塞** — Token 伪代码缺 `dryRun:true` 预览退出。
2. **R2-残留｜高** — `after` 快照未绑定协调窗口，可能串入他笔 version。
3. **R4-残留｜高** — 虚构 `GET /api/auth/login`；SC 仍可放过不完整契约。
4. **R5-残留｜高** — `resolveMcpEndpoint` 接受谓词未可执行定义。
5. **R3-残留｜中** — CSRF／auth 模式夹具与 `isPublicApi` 映射未进 SC。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| R1-残留 | Token 伪代码＋SC-19／SC-20 |
| R2-残留 | D5 协调窗口内绑定；SC-10 夹具 B |
| R3-残留 | SC-03–06 required／CSRF／`isPublicApi` |
| R4-残留 | 仅 POST login；逐项 auth；SC-01／02 |
| R5-残留 | 仅 `configured`；fallback／invalid→503；SC-14 |

## 第 3 轮

对象是 Spec／Plan **v0.3**。结论：**可定稿（附条件）。** 阻塞 0，高 0，中 1，低 0。摘录：`inbox/codex-review-admin-api-agent-discoverability-round3.txt`。

第 2 轮五项残留全部闭合。

条件项：

1. **N1｜中** — Token 预览须在 dryRun 分支前共用 `resolve_expiry`；SC-19 覆盖仅 `expires_in`／非法／冲突；endpoint 门仅非预览。

## 第 3 轮后修订（→ v0.4 可定稿）

| 项 | 处理 |
|---|---|
| N1 | 伪代码／D6／SC-19／Plan S3 已写入共用 `resolve_expiry` |

**定稿条件已满足。** 定稿不表示开发已授权。当时「SC 未执行」已作废，不得当作现值。本条收口不表示可上线。

用户同会话指示「能定稿则推进落地」→ 已实施。现值见 Spec 状态行：**v0.4 已实施（2026-11-03）**。SC-01–SC-20 自动化已落，尚无逐条收口记录。未 git commit、未 Docker 重建。本条收口不表示可上线。
