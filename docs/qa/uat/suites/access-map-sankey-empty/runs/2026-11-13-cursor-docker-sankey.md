# Run — 2026-11-13 — cursor-docker-sankey

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP` |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`；容器 `compose-lucy-1` healthy；`lucyVersion=0.30.0`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`（含空桑基修复 `f3f88837`） |
| 开始／结束 | 2026-11-13 ≈14:15–14:25 CST |
| 总判定 | **PASS WITH GAP** |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | `docker ps` lucy／demo-db healthy；`/api/health` ok；凭据文件 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（Desktop 同名缺失）登录 WebUI → `/overview` |
| UAT-ACCESS-MAP-01 | **PASS** | 打开 `/admin/access-map?window=168h&inquiryKind=all&accessGrade=all`。API：`meta.counts.grantPaths=27`，`accessPaths=0`，`meta.access.rawCalls=0`，边 23 条均为 `dormant`。DOM：`[data-testid=access-map-svg]` 内 **11** 条 `data-testid=access-map-backbone-*`（Agent→角色→连接闲置骨干）；无 conn→table 骨干（闲置表不进列）。KPI「进入允许调用 0」；空态说明诚实可读，图面非「仅 stub」 |
| UAT-ACCESS-MAP-02 | **PASS** | `access-map-legend` 文案含「闲置授权 = 端点示意／无访问时的连通骨干（不撑使用刻度）」 |
| UAT-ACCESS-MAP-03 | **PASS** | `meta.access.trust=confirmed`；图例「关联口径：已确认关联」。`trust=include_candidate` → HTTP **400** `INVALID_ACCESS_MAP_PARAMETER`「关联口径只接受已确认关联」 |
| UAT-ACCESS-MAP-04 | **SKIPPED** | 可选。本机 Cursor MCP `user-lucy-local-docker`／`project-0-project-lucy-lucy` 发现失败；未另起 Proxy Bearer 触表。不影响必做判定 |

## 备注

- 是否使用 `docker restart`：**否**
- 清理是否完成：未创建临时连接／库；`inbox/.uat-*` 凭据临时文件测后删除
- 浏览器 `browser_take_screenshot` 多次超时；本跑次以 **CDP DOM 查询 + 已登录 API** 为证据（非 CR）
- 与错题本症状对照：修复前「几乎只有 stub」；本跑次空访问下仍有 11 条连通骨干 path

## API 摘录（无密钥）

```text
GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all
meta.counts.grantPaths=27 accessPaths=0
meta.access.state=ok trust=confirmed rawCalls=0
edges=23 all dormant

GET ...&trust=include_candidate → 400 INVALID_ACCESS_MAP_PARAMETER
```
