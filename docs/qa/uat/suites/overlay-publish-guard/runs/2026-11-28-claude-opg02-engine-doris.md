# 跑次：2026-11-28 claude OPG-02 引擎面补验收口（GAP-OPG-02-ENGINE 关闭）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-OVERLAY-PUBLISH-GUARD` |
| 日期／Agent | 2026-11-28（UTC 2026-11-27T16:16Z 完成判定）／Claude（kscc） |
| 环境 | 隔离栈 `lucy-uat-p19x`（复用，**候选镜像与 2026-11-26/27 主跑次一致**：`project-lucy:uat-closure`，`gitSha=8b8fb83c`／dirty（docs-only）；WebUI `:55186`、MCP `:57891`）＋ Doris lab FE/BE（`selectdb/doris.fe-ubuntu:2.0.14`／`be-ubuntu:2.0.14` **arm64 本机镜像**，网络 `lucy-doris-uat`，MySQL 协议宿主 `:19030`） |
| 判定 | **GAP-OPG-02-ENGINE 关闭**（本跑次只覆盖 SC-02 引擎面：`lucy_query` 对三段物理表名 `internal.p191eng.t_orders` 全链路执行并返回真实数据行；其余 OPG 用例沿用 2026-11-26/27 跑次证据） |

## 补验执行（真实引擎数据行）

执行器：`inbox/uat-closure-20261127/opg02-engine-doris.mjs`；灌数：`opg02-doris-seed.mjs`；判定 `inbox/uat-closure-20261127/opg02-engine-verdict.json`（ALL CHECKS OK，16 checks 全 ok）。

| 步骤 | 结果 | 证据 |
|---|---|---|
| Doris 数据面 | ok | `internal.p191eng.t_orders` 2 行（100.5 / 42），直查 sum=142.5（`opg02-doris-seed.mjs` 自校验通过） |
| 正式连接接入 | ok | `POST /api/connections` 建 `uat-doris-eng`（driver mysql，host.docker.internal:19030）→ manifest 上传（`_schema/p191eng.yaml`，物理名三段）→ `PUT enabled-tables`（键 `internal.p191eng.t_orders`） |
| 三段名 standalone 发布 | ok | validate 200、`physicalTable="internal.p191eng.t_orders"` 逐字；同名遮蔽场景（standalone `t_orders` 叠加 manifest `t_orders`）：未确认 → `409 OVERLAY_MANIFEST_CONFLICT`＋`pendingConfirmations`，`allowManifestShadow` 重试成交，磁盘逐字保留三段名 |
| 探针角色放开 | ok | `PATCH /api/admin/roles/uat_closure_probe_role` 增加 `uat-doris-eng`/`t_orders` 授权（dryRun→write 200） |
| **引擎面实查（SC-02 核心）** | ok | MCP `lucy_read_source` 返回 yaml 含 `table: internal.p191eng.t_orders`（逐字）；**`lucy_query` 全链路执行成功，`rows=[[142.5, 142.5]]`（=100.5+42），`answer_verifiability.sources[0].table="internal.p191eng.t_orders"`**（全量响应存 `inbox/uat-closure-20261127/opg02-engine-query-full.json`） |

## 与 Task 0 实证的关系

Task 0（`inbox/p191-task0/RECORD.md`）在隔离 Doris 环境以 KTX 上游工具（`sl_query`/`sl_read_source`）实证三段名解析执行；本跑次把同一三段名形态经 **Lucy 产品自身通道**（正式连接接入 → overlay 发布 → ACL 角色授权 → MCP 代理 `lucy_query`）在隔离 demo 栈上全链路复验，关闭 GAP-OPG-02-ENGINE 的「未在 demo 实例补验」缺口。

## 环境注记（复现实操要点）

- **Doris 引擎选择**：2.1.7 amd64 镜像在 Apple Silicon QEMU 下 BE 段错误（`doris_be` Segmentation fault）；复用 Task 0 已验证的 **2.0.14 arm64 本机镜像**。BE 以 entrypoint 覆盖启动（容器内 `sed` 跳过 `start_be.sh` 的 `vm.max_map_count`/swap 检查）＋宿主侧在 Docker Desktop VM 内 `sysctl vm.max_map_count=2000000`；BE 注册用 `ALTER SYSTEM ADD BACKEND '172.30.80.3:9050'`（覆盖 entrypoint 后需手工注册）。
- **内存水位**：Docker Desktop VM 8GB，多栈并存时 BE 报 `[MEM_LIMIT_EXCEEDED] Allocator sys memory check failed`；暂停 `lucy-req0117-uat`／`lucy-mip-uat`／`lucy-uat-p18182` 三栈（仅 `docker stop`，卷未动）后复跑通过。跑后已重启三栈。
- **p19x 栈遗留恢复日志人工结账**：启动时 `rj_d85751e0`（`rel_20261126_180828`，目标 `semantic-layer/demo-mysql/superstore_orders.yaml`）报「内容既非原始亦非本批写入」——盘上内容实为另一套 UAT 夹具变体（grain/measure 被改）。人工将双树文件恢复为 journal `originalBase64` 字节（1429B，容器内校验 `sha256 == originalDigest`），重启后启动恢复判定转 `open/activation_pending`（`recoveryRequired=false`），发布通道解锁。此为 UAT 夹具残留，非产品缺陷。
- **ACL 同名遮蔽形态**：standalone 未入 manifest 时被 ACL `table_forbidden` 拒绝（F1 后行为，与主跑次 OPG-02 注记一致）；故沿用同名遮蔽场景（standalone `t_orders` 遮蔽 manifest `t_orders`）验证引擎读路径。
- **夹具留存**：`uat-doris-eng` 连接、standalone `t_orders` 遮蔽、Doris lab 容器与卷均留在 p19x/lab 环境（一次性 lab 资源，可随时清理）；探针 Agent `uat_probe_closure` 跑后保持禁用前状态移交委托人处置。

## 边界与结论

- **GAP-OPG-02-ENGINE 关闭**：`lucy_query` 引擎面三段名查询已在 demo 实例（隔离栈＋Doris 引擎）实跑通过，不再依赖 Task 0 单独承载。
- 本跑次仅覆盖引擎面补验；OPG-01/03–08 结论沿用主跑次证据不变。
- **≠ 功能合同收口**（收口由 Spec 状态行与收口记录承载）；**≠ 可上线**。
