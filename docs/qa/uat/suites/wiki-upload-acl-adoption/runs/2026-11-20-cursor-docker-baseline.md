# Run — 2026-11-20 — cursor-docker-baseline

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION` |
| 选择器 | **改前基线**（缺陷复现） |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`；容器 `compose-lucy-1`／`compose-demo-db-1` healthy |
| 候选 | `lucyVersion=0.30.0`（以当时 `/api/health` 为准）；工作树含文档落盘前探查 |
| 总判定 | **FAIL**（UAT-WUA-01：覆盖上传默认路径静默剥掉 YAML 加宽角色） |

## 结果表

| Case | 结果 | 摘要 |
|---|---|---|
| UAT-WUA-R0 | PASS | 登录成功；目标 `global/demo-superstore.md`；ACL=`demo_readonly`+`lucy_admin` |
| UAT-WUA-01 | **FAIL** | YAML 声明三角色；`preserve_current` 提交 200；磁盘仍两角色；`lucy_ops_reader` 被剥 |
| UAT-WUA-02 | PASS | `use_uploaded`＋匹配 digest → 三角色写入 |
| UAT-WUA-03 | PASS | 保留 digest＋采用上传 → `wiki_upload_preview_stale` |
| UAT-WUA-04 | PASS | 无 access → `wiki_upload_access_required` |
| UAT-WUA-05 | PASS | manage-access preview＋PUT 可补回三角色 |
| UAT-WUA-06 | NOT RUN | 本基线未跑 MCP（API 缺陷已成立） |
| UAT-WUA-07 | NOT RUN | 未做浏览器 E1–E7；API 已证默认静默保留；access PUT 验证管理访问语义 |

## 清理

目标页 ACL 已恢复为 `demo_readonly`＋`lucy_admin`；正文恢复为 demo 说明骨架。

## 备注

- ≠ 功能收口；≠ 可上线
- 改后复测须另授；本跑次只证明改前缺陷
