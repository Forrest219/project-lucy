# 2026-11-19 — 短名冲突 Docker 全真复现

| 元数据 | 内容 |
|---|---|
| Suite／总账 | UAT-SUITE-SOURCE-SHORTNAME-CONFLICT／P1-64／REQ-030-085 |
| 执行窗口 | 2026-11-19 23:14:29–23:14:50（Asia/Shanghai） |
| 判定 | **FAIL（缺陷已复现）**；基线与临时处理后路径均可用；运行代码未修复 |
| 目标镜像 | `project-lucy:demo`；`sha256:2868339971daf25c6dc87a85a03539bd722c138b30d11d73abe3c270f154b385`；linux/arm64 |
| 构建／本机 HEAD | `6208ea5727bdb72b19333c574e8fbe047871f846`；宿主工作树脏，镜像标签不代替候选身份 |
| 源码核对 | 镜像 schema-structure.ts 与 acl.ts 的 SHA-256 均与宿主当前文件相同；见原始 summary |
| 数据库 | 独立 `mysql:8.4`；`weather.city`、`ods.city` 各一行合成数据 |
| 隔离／身份 | 独立容器、网络、临时目录；真实 bootstrap 管理员会话；普通合成 Agent `repro_reader`，仅 `hive-1` 连接、`catalog_bound` 范围；随机凭据不入证据 |
| 原始证据 | [2026-11-19-codex-docker-repro-artifacts](2026-11-19-codex-docker-repro-artifacts/summary.json)；HTTP／JSON-RPC 原始响应保留 |
| 清理 | 本跑次全部容器、网络和私有目录已删除；未修改现有 demo 与远程实例 |

## 实测结果

| 用例 | 实际操作与观察 | 判定 |
|---|---|---|
| UAT-SNC-R0 | 镜像与关键代码核对通过，真实数据库、管理员引导和 Agent 鉴权成功 | PASS |
| UAT-SNC-01 | 从 weather 扫描、上传并保存启用表；tools/list、catalog、begin、read、query 五条路径可用；`SELECT COUNT(city.id) AS row_count FROM weather.city AS city LIMIT 1` 返回 1 | PASS |
| UAT-SNC-02 | 再扫描 ods.city，仍生成裸短名 city；validate `valid=true`、upload `uploaded=true`，均 HTTP 200。保存启用表也 HTTP 200／`runtimeAck=true`。随后 tools/list 返回 HTTP 403，其余四个 tools/call 返回 HTTP 200＋`isError=true`，原因全部为同一 Source Map 编译失败 | **FAIL：缺陷已复现** |
| UAT-SNC-03 | 仅将 ods Manifest 的键 city 改为 ods_city，物理表仍为 ods.city；上传后原样保存两张启用表；不重启容器，五条原路径恢复；weather.city 与 ods.city 的 COUNT(id) 都返回 1 | PASS（临时处理验证，不是产品修复） |

目标报错的原始复现：

```text
Access denied: source_map_compile_failed:duplicate_source_name:hive-1:city
```

[tools/list 403](2026-11-19-codex-docker-repro-artifacts/collision-tools-list.json)；[query 工具拒绝](2026-11-19-codex-docker-repro-artifacts/collision-query.json)；[上传成功](2026-11-19-codex-docker-repro-artifacts/collision-ods-upload.json)；[启用表保存与 runtimeAck](2026-11-19-codex-docker-repro-artifacts/collision-enabled.json)。

## 代码定位与根因

1. `webui/server/schema-structure.ts:187` 的 `buildMinimalSchemaManifest(schema, columns, ensureTables)` 不接收 connectionId、现有 Manifest 或保留短名集合；`:201`／`:213` 直接以 `column.table` 为 `tables` 的键。`:1138` 的调用只传当前 Schema 的字段及表名。扫描两个 Schema 会分别生成同名 city。
2. `webui/server/catalog-assets.ts:590` 的 `validateCatalogAsset` 校验连接／Schema 配置、单份文件形态和路径，`:643` 仅解析当前请求内容；未检查同连接其他 Manifest 的短名。故真实生成结果可通过校验并落盘。
3. `webui/server/proxy/acl.ts:379` 扫描所有连接的 `_schema/*.yaml`，`:411` 按 connectionId＋sourceName 判断重复，`:413` 设置 `duplicate_source_name`，`:1694` 在角色编译前返回 `source_map_compile_failed`。物理 `table:` 路径不同不能避免短名冲突。
4. 同一循环遇到后续冲突会覆盖单个 `compileError`，因此源码只能给出最后遇到的冲突。本轮只构造 city 一对，未实测现场六对的遍历顺序。
5. 额外实测：`webui/server/index.ts:2025` 调用 `commitEffectivePolicy` 后，`:2027` 仅按有版本且非 degradedGlobal 判断 policyRuntimeAck；本轮角色已经不能处理请求，保存仍报告 runtimeAck=true。此处只记录事实，未改实现。

## 修复边界与下一步

缺口属于 Lucy 的生成、保存校验与编译契约不一致。应在同连接范围分配短名，并在落盘前按最终文件集合检查冲突；不能只把重复检测放宽，否则会出现同名来源指向不确定的物理表。

同事提出的「冲突双方改为 Schema_表」会改变已存在短名。正式修复 Spec 必须一起处理 overlay／Role／已保存查询等既有引用兼容、旧新文件的一致提交及二次前缀冲突；本轮未验证这些设计，也未授权修复。

## 证据边界

- 连接名 `hive-1` 为复现夹具；实际驱动是 MySQL。这次全真验证了共享的生成、上传、编译与 Proxy 链路，**不代表客户 SelectDB／Hive 元数据路径或现场六对冲突已逐一复现**。
- 查询来源为 `hive-1.weather.city`／`hive-1.ods.ods_city`，物理表为 weather.city／ods.city；口径为 COUNT(非空主键 id)，无日期条件、无额外过滤。`answer_verifiability.cutoff.status=not_checked`，仅为合成夹具的可用性核对。
- 初始只有 weather Manifest，ods 尚未上传时 `catalogRuntimeAck=false`（缺另一 Schema Manifest），但 policy／execution ack 为 true，基线五条 MCP 路径实测全部可用。两份 Manifest 齐备后 catalog ack 为 true，仍发生目标冲突。
- 不主张修复完成、功能合同收口或可上线；测试台保留 FAIL。
