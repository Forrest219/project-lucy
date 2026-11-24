# Run — 2026-11-13 — cursor-docker-page-perf

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-PERF` |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`；容器 `compose-lucy-1`／`compose-demo-db-1` healthy；`lucyVersion=0.30.0`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`（含 P1-13 `755fc706` 后继） |
| 开始／结束 | 2026-11-13 ≈14:30–14:40 CST |
| 总判定 | **PASS** |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | lucy／demo-db healthy；`/api/health` ok；凭据文件 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（Desktop 同名缺失）会话已在 `/overview`（账户 xingchen） |
| UAT-PERF-ROLES-01 | **PASS** | 打开 `/admin/roles`；列表可见 5 个正式 Role（demo_readonly／lucy_admin／chatbi-analyst／invest_uat_readonly／lucy_ops_reader）。Resource Timing：`GET /api/admin/roles` **1** 次、**55ms**；**0** 次 `GET /api/admin/roles/:id` 拼列表 |
| UAT-PERF-AGENT-01 | **PASS** | 冷进 `/admin/agents`；Agent 列表可读。Resource Timing：`/api/admin/agents?range=30d` 37ms；**roles 请求 0**（apiLike 仅 auth／branding／agents／policy-runtime／ui-usage） |
| UAT-PERF-AGENT-02 | **PASS** | 点「新建 Agent」弹窗后出现 **1** 次 `GET /api/admin/roles?includeTemplates=false`（**64ms**）；detailStorm=0；随后取消，未保存 |
| UAT-PERF-ROLES-02 | **PASS** | 同源已登录 `fetch`×3：`ok`／`roles=5`；墙钟 **60／23／20 ms**（max≈60，远快于修复前「秒级卡顿」体感；落在 RPB-W3 ≤200ms 参考内） |
| UAT-PERF-BASELINE-01 | **SKIPPED** | 可选发布取证 runner 本跑次未执行；发布取证仍以 [acceptance](../../../../../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md) 为准，不代替本套件必做项 |

## 备注

- 是否使用 `docker restart`：**否**
- 清理是否完成：新建 Agent 弹窗已取消；未改 ACL／Agent；临时凭据临时文件已删
- 证据手段：浏览器 Resource Timing + 已登录 `fetch`（全真 demo Docker），**非** CR／vitest
- **≠ 可上线**；**≠** 发布取证整包重跑

## Network 摘录（无密钥）

```text
/admin/roles cold:
  GET /api/admin/roles → 1× 55ms；no /api/admin/roles/:id list storm

/admin/agents cold:
  GET /api/admin/agents?range=30d → 37ms
  GET /api/admin/roles → 0

新建 Agent modal:
  GET /api/admin/roles?includeTemplates=false → 1× 64ms

API×3 includeTemplates=false:
  60ms / 23ms / 20ms；roles.length=5
```
