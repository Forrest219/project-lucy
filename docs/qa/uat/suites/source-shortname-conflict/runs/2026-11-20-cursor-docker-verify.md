# 2026-11-20 — 短名冲突改后 Docker verify

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-64 改后 Docker UAT verify 跑次 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-20 |
| 撰写人 | Cursor |
| Suite／总账 | UAT-SUITE-SOURCE-SHORTNAME-CONFLICT／P1-64／REQ-030-085 |
| 执行窗口 | 2026-11-20 02:36:33–02:37:08 UTC（约 35s 用例段；含容器启动） |
| 判定 | **PASS**：R0／01–09 全部必做通过 |
| 目标镜像 | `project-lucy:demo`；`sha256:7a43b1399cababdd72965f5835561bd0d9b5eacdbac561af1974092121542e69`；linux/arm64 |
| 构建／本机 HEAD | `1fb73f721d8df4bd149f99c27aca69feada51556`（宿主 dirty）；五份关键源码哈希与镜像一致 |
| 数据库 | 独立 `mysql:8.4`；合成 weather／ods／aux／race／c1–c6／d1–d6 |
| 隔离／身份 | 独立容器、网络、临时目录；真实 bootstrap（非 demo 管理员）；合成 Agent `repro_reader`；随机凭据不入证据 |
| 入口 | `SNC_IMAGE=project-lucy:demo python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify` |
| 原始证据 | [2026-11-20-cursor-docker-verify-artifacts](2026-11-20-cursor-docker-verify-artifacts/summary.json) |
| 清理 | 隔离容器／网络／私有目录已删除；未改 demo 数据卷；未写入演示管理员口令 |

## 实测结果

| 用例 | 实际操作与观察 | 判定 |
|---|---|---|
| UAT-SNC-R0 | 镜像与五文件哈希一致；独立 Lucy＋MySQL 就绪；bootstrap 管理员与 Agent Bearer 可用 | PASS |
| UAT-SNC-01 | 扫描 weather→`city`；upload／启用；`runtimeAck=true`；五条 MCP；`COUNT(city.id)=1` | PASS |
| UAT-SNC-02 | 扫描 ods→`ods_city`（非裸 city）；upload／启用 ack true 且无 `source_map_compile_failed`；五路径＋`COUNT(ods_city.id)=1` | PASS |
| UAT-SNC-03 | 预置 Role／overlay／evals 夹具；重扫覆盖上传；短名不漂移；夹具未改写；city／ods_city 仍可查 | PASS |
| UAT-SNC-04 | 手改 ods 裸 `city`；validate `DUPLICATE_SOURCE_NAME`（建议 `ods_city`）；upload 400；磁盘 sha 不变；合法 MCP 仍可用 | PASS |
| UAT-SNC-05 | 清 ods 后 aux 占用 `ods_city`；再扫 ods→`ods_city_2`；两表 COUNT 各 1 | PASS |
| UAT-SNC-06 | 并发 upload `shared`（避开 weather.city）；恰好一个成功；既有 city MCP 不受影响 | PASS |
| UAT-SNC-07 | 磁盘注入双 `city`；启用返回 `runtimeAck=false`／`policyRuntimeAck=false` 且含 `source_map_compile_failed:duplicate_source_name:hive-1:city`；API 修复后 ack 与五路径恢复 | PASS |
| UAT-SNC-08 | 六组 `t1`–`t6` 旧冲突；逐份唯一化 dN；`sourceNameConflicts` 递减至 0；最终 ack／query 恢复 | PASS |
| UAT-SNC-09 | 脱敏证据留档；隔离资源清理完成 | PASS |

## 证据边界

- 连接名 `hive-1` 为合成夹具；驱动为 MySQL。不主张 SelectDB／Hive 元数据适配或客户现场六对冲突已验。
- WebUI 认读 ack 由 Spec SC-10 组件测试覆盖；本跑次未跑浏览器。
- 演示环境管理员凭据未用于本套件、未写入证据。
- **≠ 可上线**；提交推送须另行明示。
