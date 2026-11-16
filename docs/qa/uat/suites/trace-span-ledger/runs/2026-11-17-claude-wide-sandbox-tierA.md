# Run — 2026-11-17 — claude-wide-sandbox-tierA

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-TRACE-LEDGER` |
| Agent | Claude（Cursor） |
| 环境 | 宽目录沙箱 `lucy-uat-wide`（本机 Docker，独立容器／volume／MySQL 库，与 demo 隔离；320 Source、20 Agent）；WebUI `http://127.0.0.1:55276`，MCP `http://127.0.0.1:57981/mcp`。demo `compose-lucy-1`（WebUI `http://127.0.0.1:55176`）只做只读取数 |
| 被测构建 | `gitSha=28cad205f597940e5f8b2d91c5d7beb1aa6f2bd3`、`gitDirty=true`；`derivation_version=v2p5-2`；容器内关键源码 sha1 与宿主工作树一致 |
| 运行器 | `node scripts/uat/trace-span-ledger-uat.mjs all --out inbox/uat-trc.json`（请求头 `User-Agent: lucy-uat/<run>`，每个请求带唯一 JSON-RPC `id` 形成**独立发送清单**）；TRC-11：`cd webui && npx tsx scripts/span-ledger-scale.mts --traces 100000` |
| 开始／结束 | 2026-11-17 ≈02:35–02:55 CST |
| 总判定 | **PASS WITH GAP**（TRC-01/02/03/04/05/06/10/11 有可执行证据；TRC-07／08／09 **NOT RUN**；各缺口见下表） |

> 口径：**功能合同收口 ≠ UAT PASS ≠ 可上线**。本跑次的沙箱数据量小（表 3 行），不代表客户现场。

## 用例结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | 沙箱与 demo 均 healthy；新版本行 `derivation_version=v2p5-2`；demo 库：466 行 `v2p5-2` 全部有 `trace_id`、孤儿 span 0；721 行 `v2p5-1` 为升级前旧行（`trace_id` 为空，按 Spec 不回写）；demo 与沙箱在同一构建 |
| UAT-TRC-01 | **PASS** | 独立发送清单 17 类混合请求（`initialize`×2、`notifications/initialized`×2、`tools/list`、`ping`、`wiki_search`、`wiki_read`、合法／带过滤的 `lucy_query`、ACL 拒绝、门闩拒绝、未知工具名、缺参、`lucy_read_source`、`lucy_catalog`、上游错误）：**missing＝空、extra＝空**，逐类落库数＝发送数（含无 `id` 的通知），本次范围 17 行全部有 `trace_id` 且唯一 |
| UAT-TRC-02 | **PASS WITH GAP** | 65 个 span／17 个 trace：每 trace 恰一个根、父 span 都存在且递归可达、`seq` 从 1 连续、`parent.seq < child.seq`、≤32、`attrs.dropped` 恒为 0、与所指流水行 `trace_id` 一致；全库孤儿 span＝0；服务**单例连接** `foreign_keys=ON`（`GET /api/admin/audit/status`）；在**容器内测试副本库**插入未登记 `reason_code`、1024 个中文字符的 `attrs_json` 均被 `CHECK` 拒绝；固定场景 `reason_code`：ACL→`acl_denied`、门闩→`gate_denied`、缺参→`arg_invalid`、上游错误→`upstream_error`、**预算耗尽→`budget_stopped`**（同一会话连续有效数据工具调用至第 62 次）；`tools/call` 最小集合（`lucy_query`／`lucy_read_source`／`lucy_catalog`）全部满足。**缺口**：`timeout` 场景沙箱造不出真实上游超时；`truncated`／`dropped` 计算按用例设计只由 vitest 覆盖 |
| UAT-TRC-03 | **PASS** | 在沙箱审计库建触发器使对 `access_trace_span` 的 INSERT `RAISE(ABORT,'uat-injected')`：注入期间的合法 `lucy_query` **客户端结果与注入前一致**（均成交，无 503）、`access_log` 与 `access_trace_span` **都没有**该请求的行（无孤儿）、`writeHealth.failedWrites` 增加（运行日志 `failed to write audit log SqliteError: uat-injected`）；`DROP TRIGGER` 后触发器不残留、同一请求恢复，行与 span 同时落库。见「发现」F-1 |
| UAT-TRC-04 | **PASS WITH GAP** | 17 个 trace：C9a 子 span 落根区间内、C9b 根时长＝流水 `duration_ms`、C9c 墙钟锚定、C9d 串行阶段同父不重叠，**固定 1 ms 容差零违规**；**反例**：把全部 span 的 `started_at_ms` 平移一年后 C9c 对 17 个 trace 全部判违规（C9 不恒真）。**缺口**：慢序列化／发送背压请求未造（沙箱表小）；反例平移在内存读数上做，未改副本库（逐行等价） |
| UAT-TRC-05 | **PASS WITH GAP** | 导出前后 `pendingWrites＝0`；`spans.csv` 登记在 manifest：行数 19,526＝`rowCount`＝库内 JOIN 所属行 `ledger_seq ≤ S1(18269)` 的 span 数；`sha256` 与 manifest 一致；`spans.unsequenced`＝0 与库一致；**同一 S 两次导出**规范化内容逐行一致；新增流量后第三次导出（S3＝18329）里 `ledger_seq ≤ S1` 的行与第一次逐行一致（前缀比较）。**缺口**：见「发现」F-2——**正式完整导出（`mode=complete`）在沙箱 409 `integrity_or_relation_failed`**（demo 的同一张登记表也为空，推断同样失败关闭；未直接调用 demo 导出）（既有 F-02 缺陷），本用例改用诊断导出（`mode=diagnostic`）读取 `spans.csv`；「既有文件逐字不变」缺 P1-36 前构建的基线导出，**NOT RUN**（等价守卫由 vitest `audit-scale-equivalence` 覆盖）；导出包密钥扫描与 MCPX-06 7b 合并，库内扫描通过 |
| UAT-TRC-06 | **PASS WITH GAP** | 各请求类必有 span 集合齐全（被拒与预算终止行以 `denied` span 为必有集合）；协议／wiki 行 `primary_status` 无 `unknown`（`initialize` 全部 `succeeded`）；被拒＝`denied`＋`policy_denied`（`tool_forbidden`、`source_ambiguity_gate`、`tool_unclassified:*` 三类）；`wiki_not_found` 属 VALIDATION_REASONS，为 `denied`＋`validation_failed`（与 Spec §4 表第 8 类一致）；入参校验失败行 `error_category=client_schema_failure`、主状态按 `v2p5-1` 保持 `unknown`；新写入行 99 行全部 `v2p5-2`。**缺口**：场景②（`wiki_search` 上游失败＋本地回退成功）需要在调用瞬间让 KTX 不可用且回退命中，沙箱里重启窗口不可控，**NOT RUN**；旧行不回写的对照需要升级前快照，**NOT RUN**。见「发现」F-3 |
| UAT-TRC-07 | **NOT RUN** | 脱敏需要真实内网 IP／`sl_query` 的上游错误夹具（`fixtures.md` §脱敏夹具），本批未建 |
| UAT-TRC-08 | **NOT RUN** | `ip_source`／`trusted_source` 四种场景需要受信代理拓扑与配置还原，本批未建 |
| UAT-TRC-09 | **NOT RUN** | 热路径开销需要 P1-36 前后两个构建做 A/B，本批没有「改前」构建 |
| UAT-TRC-10 | **PASS** | 对合法查询、协议请求、本地处理、门闩拒绝、上游失败五类，用 `trace_id` 还原出「请求→阶段→结果」序列，并在导出 `spans.csv` 里找到同一 trace 的**同一组** `span_id`（库＝CSV，3–4 个／trace）；按会话列出全部 trace：14 行流水＝14 个 trace |
| UAT-TRC-11 | **PASS WITH GAP** | `span-ledger-scale.mts`：**10 万 trace／533,346 个 span**；span 表＋索引 **1,500 字节／trace**（预算 8,192）；`computeSpanCoverage` 828 ms（事件环 P99 21／max 41 ms）、`spans.csv` 渲染 2.26 s（P99 48／max 48 ms，97 MB）、完整 `buildExportPackV2` 4.8 s（P99 74／max 98 ms，RSS 峰值 1.16 GB），门槛 P99 ≤ 400／max ≤ 1000 ms，**无超标**；三项对账均 `pass`。**缺口**：事件环为进程内度量，未经 HTTP `/api/livez` 采样，也未与 `UAT-SUITE-PAGE-SWEEP` 同跑 |

## 发现（须在 Spec／总账里登记，不得吞掉）

| 编号 | 发现 | 性质 | 影响 |
|---|---|---|---|
| **F-1** | TRC-03 注入使一次请求的 span 写入失败后，该请求在**安全账本**里有事件（账本对每个 MCP 请求都按设计写事件）、在 `access_log` 里**没有行**。审计库与账本之间留下一个缺口（未单独核对到具体事件序号，按设计推断） | P1-36 同事务设计的预期后果（Spec 选择「行与 span 同事务、失败都不落库」）；**不是本批新缺陷**，但属于「审计写入失败即丢整行」的既有风险被 span 表放大了触发面 | 只靠已落库行无法发现该缺口（Spec §6.1 已要求用发送清单对账）；失败计数 `failedWrites` 与运行日志是唯一信号 |
| **F-2** | 正式完整导出 `mode=complete` 在沙箱 409 `integrity_or_relation_failed`（demo 未直接调用，只读 SQL 确认其 `access_log_asof_meta` 同样为空）：`access_log_asof_meta` 为空（`attribution_journal_baseline_seq` 未登记），as-of S 证明的「归属修订」维度失败关闭。`ensureAsOfBaseline` 只在审计库打开时登记，账本序号解析不到就永不重试 | **既有缺陷**（2026-10-28 UAT 复核已登记 F-02「未收口」，见 [复核记录](../../../../../reviews/2026-10-28-uat-p0-l25-09-audit-and-reconciliation.md)）；与 P1-36 无关 | P1-36 的「封存包含 `spans.csv`」只能在**诊断包**里验证，**正式完整包尚无法产出**，不得据此宣称「存档第 1 层可正式封存」 |
| **F-3** | Spec SC-06 写「其他 `tools/call` 行主状态不为 `unknown`」，但 §6.2 写「`tools/call` 主状态证据路径保持 `v2p5-1` 不变」。实现按 §6.2：入参校验失败的 `lucy_query` 仍落 `unknown`（客户基线 104 行正是这类） | **Spec 内部口径冲突**，需委托人裁定 | 若按 SC-06 字面，这 104 类行应改；若按 §6.2，应把 SC-06 改成「协议／wiki 行」 |
| F-4 | 被拒阶段 span 的 `seq` 排在 `response_serialize` 之后（例：`budget`／`source_gate`／`arg_validate` 排最后），时间上仍在其前 | 展示顺序偏差；C9d 以时间判定通过 | 按 `seq` 读时序会反直觉；建议在 Spec 里写明读序以 `started_at_ms` 为准 |
| F-5 | 管理员每次**登录**都向安全账本追加事件；紧接登录后立即导出会撞 `projection_lag_exceeded` | 既有行为 | 脚本须在登录后等待投影追平再导出（运行器已处理）；手工导出不受影响 |

## 命令与 SQL（原样，节选）

```bash
node scripts/uat/trace-span-ledger-uat.mjs all --out inbox/uat-trc.json
cd webui && npx tsx scripts/span-ledger-scale.mts --traces 100000 --out ../inbox/span-ledger-scale.json
```

```sql
-- TRC-02 孤儿与可达
SELECT COUNT(*) FROM access_trace_span s LEFT JOIN access_log a ON a.id = s.access_log_id WHERE a.id IS NULL;
WITH RECURSIVE walk(trace_id, span_id) AS (
  SELECT trace_id, span_id FROM access_trace_span WHERE parent_span_id IS NULL AND trace_id IN (…)
  UNION ALL SELECT s.trace_id, s.span_id FROM access_trace_span s JOIN walk w ON s.parent_span_id = w.span_id AND s.trace_id = w.trace_id)
SELECT (SELECT COUNT(*) FROM access_trace_span WHERE trace_id IN (…)) - (SELECT COUNT(*) FROM walk);
-- TRC-03 故障注入（容器内沙箱审计库；用后 DROP）
CREATE TRIGGER IF NOT EXISTS uat_fail_span BEFORE INSERT ON access_trace_span BEGIN SELECT RAISE(ABORT, 'uat-injected'); END;
DROP TRIGGER IF EXISTS uat_fail_span;
-- TRC-05 对账
SELECT COUNT(*) FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id WHERE a.ledger_seq IS NOT NULL AND a.ledger_seq <= :S1;
```

## 未测与不可确定

- TRC-07／08／09：**NOT RUN**（夹具／对照构建缺失）。
- TRC-06 场景②、旧行不回写对照、TRC-05「既有文件逐字不变」：**NOT RUN**。
- 客户现场形态（≥17 身份真实并发、客户网络拓扑）未覆盖。
