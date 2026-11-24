# Fixtures — UAT-SUITE-ACCESS-MAP-SANKEY

确定性种子数据，纯合成，无客户内容。入口：

| 项 | 路径 |
|---|---|
| 种子模块（数据＋写入器＋期望值计算） | [`webui/tests/uat/access-map-sankey-fixture.ts`](../../../../../webui/tests/uat/access-map-sankey-fixture.ts) |
| 沙箱启动脚本 | [`webui/scripts/uat-access-map-sankey-sandbox.mts`](../../../../../webui/scripts/uat-access-map-sankey-sandbox.mts) |
| 证据图 | [`runs/evidence/`](runs/evidence/) |

## 拓扑

4 个连接、144 张表、4 个角色、6 个基础 Agent（`dense` 另加 36 个）。

| 连接 | schema | 表数 | 说明 |
|---|---|---|---|
| `sales_mysql` | `sales` | 12 | orders、order_items、customers … |
| `finance_mysql` | `fin` | 8 | ledger、invoices、payments … |
| `hr_pg` | `hr` | 4 | employees、payroll … |
| `warehouse_dw` | `dw` | 120 | `dw_fact_001`…`dw_fact_120`，用来制造宽授权 |

| 角色 | 授权 |
|---|---|
| `sales_analyst` | sales 全部 12 表 |
| `finance_reader` | fin 全部 8 表 |
| `hr_reader` | hr 全部 4 表 |
| `wide_catalog` | dw 120 表＋sales 12 表（共 132，**宽卡**） |

| Agent | 角色 | 用途 |
|---|---|---|
| `hehe`（何老师） | `wide_catalog` | 牌很大、用很少 |
| `zhangxc`（张星辰） | `sales_analyst` | 主力使用；含 2 次被拒（hr.payroll） |
| `fin_bot` | `finance_reader` | 财务使用 |
| `ops_mixed` | `sales_analyst`＋`finance_reader` | 多角色归因 |
| `idle_bot` | `hr_reader` | 全闲置 |
| `review_bot` | `sales_analyst` | 访问授权之外的 `fin.ledger`（需复核／越出授权） |
| `dense_01`…`dense_36` | 轮换 | 仅 `dense`：制造多 Agent |

## Profile 与期望值

窗口 168h，`inquiryKind=all&accessGrade=all`。期望值由 `expectedCounts()` 计算，下表与 2026-11-17 实测一致。

| profile | 目的 | agents | grantPaths | accessPaths | rawCalls | deniedCalls | 备注 |
|---|---|---|---|---|---|---|---|
| `grants-only` | 零访问 | 6 | 188 | 0 | 0 | 0 | 无审计行 |
| `sparse` | 宽授权＋少量使用 | 6 | 188 | 4 | 55 | 0 | hehe：dw_fact_007、orders；zhangxc：orders、customers |
| `rich` | 四态齐全 | 6 | 188 | 20 | 173 | 2 | needsReviewPaths＝1（review_bot→fin.ledger）；HEAD 实测边状态 normal 23／dormant 132／overflow 1／needs_review 1 |
| `candidate-only` | 全为未确认关联 | 6 | 188 | 0 | 0 | 0 | 播种 175 次，奇数行 `association_status=NULL`、偶数行 `candidate` |
| `dense` | 多 Agent 塌缩 | 42 | 524 | 146 | 1455 | 2 | 36 个 `dense_*`，PRNG 种子 20261117 |

调用的时间戳落在近 150 分钟内；每次调用带 `conversation_turns` 上报问询，使默认「管理相关」筛选也能通过。种子写入列只含新旧代码共有的列。

## 启动沙箱

前端先构建到临时目录（不动 `webui/dist`）：

```bash
cd webui
npx vite build --outDir /tmp/lucy-sankey/dist-head --emptyOutDir
```

启动（每个 profile 一个端口；常驻进程，Ctrl-C 结束）：

```bash
cd webui
SANKEY_PROFILE=rich SANKEY_PORT=58101 SANKEY_ROOT=/tmp/lucy-sankey/head-rich \
  SANKEY_DIST=/tmp/lucy-sankey/dist-head npx tsx scripts/uat-access-map-sankey-sandbox.mts
```

只看期望值：`SANKEY_PROFILE=dense SANKEY_EMIT=1 npx tsx scripts/uat-access-map-sankey-sandbox.mts`。

打开：`http://127.0.0.1:<port>/admin/access-map?window=168h&inquiryKind=all&accessGrade=all`

### 旧码对照（线上同源）

```bash
mkdir -p /tmp/lucy-sankey/old-src && cd <repo>
git archive 6d2664b3 webui scripts/release | tar -x -C /tmp/lucy-sankey/old-src
ln -s <repo>/webui/node_modules /tmp/lucy-sankey/old-src/webui/node_modules
mkdir -p /tmp/lucy-sankey/old-src/webui/tests/uat
cp webui/tests/uat/access-map-sankey-fixture.ts /tmp/lucy-sankey/old-src/webui/tests/uat/
cp webui/scripts/uat-access-map-sankey-sandbox.mts /tmp/lucy-sankey/old-src/webui/scripts/
cd /tmp/lucy-sankey/old-src/webui && npx vite build --outDir /tmp/lucy-sankey/dist-old --emptyOutDir
# 然后用 SANKEY_DIST=/tmp/lucy-sankey/dist-old 在该目录启动
```

## 清理

沙箱全部落在 `/tmp/lucy-sankey/`。结束后：杀监听端口的进程（先 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 确认 PID，不要按 `-ti` 杀，会误伤浏览器客户端），再 `rm -rf /tmp/lucy-sankey`。

## 禁止

- 把线上实例或 demo 的密码、token 写入本树
- 用沙箱结果替代 SANKEY-07 的线上判定
- 放开 `trust=include_candidate`

## Docker 全真执行（设计用例的默认路径）

每个 profile 一个一次性容器，同一镜像 `project-lucy:demo`，数据目录由夹具生成并挂到 `/data/lucy`；不碰 demo 容器与 `lucy-demo-data`。

```bash
bash scripts/uat/sankey-docker/up.sh        # 生成种子、起 5 个容器（58301–58305），约 60 秒 healthy
node scripts/uat/sankey-docker/run-uat.mjs  # 按 cases.md 执行 R0／01～05，输出 JSON，截图写入 runs/evidence/
bash scripts/uat/sankey-docker/down.sh      # 删容器与 /tmp/lucy-sankey-docker
```

端口：grants-only 58301、rich 58302、sparse 58303、candidate-only 58304、dense 58305。降级项：容器以 `development`＋`LUCY_WEBUI_AUTH=off` 启动，种子连接指向 `sandbox.invalid`。
