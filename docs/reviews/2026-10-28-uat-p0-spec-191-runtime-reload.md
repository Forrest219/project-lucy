# Spec 191 执行层重载 — 发布前 UAT 核对（2026-10-28）

结论词汇只用 `passed_automation` / `failed` / `blocked` / `not_run`。本文件**不是** UAT-passed，也不是产品验收签字。

## 结论

Spec 191（执行层重载）在 `lucy-v0.25` @ `17fdaf0850e27dbb724cf932f9d51e9af5d72815` 上，监督进程的本地生命周期和 Node/UI 单测路径可以复现。容器形态的 AC-3、AC-12 **没有执行**。

| 项 | 结果 |
|---|---|
| 自动化通过 | AC-1、AC-2、AC-4、AC-5、AC-6、AC-7、AC-8、AC-9、AC-10、AC-11、AC-13（11） |
| failed | 0 |
| blocked | 0 |
| not_run | AC-3、AC-12（2） |
| implementation_bug | 1（验收脚本 `--container` 空实现，会假通过） |
| 开放 spec_drift | 0（工单 §8.3 的两处偏离仍是已记录偏离，本轮不新开） |
| out_of_scope | 0 |

未改产品代码，未 git commit，未执行 `npm run demo:upgrade`，未删除 volume，未发起第二次镜像构建。

## 范围

- 规格：`webui/docs/191-execution-runtime-reload-spec.md` AC-1–AC-13；工单 `webui/docs/plans/wo-20261027-ktx-execution-runtime-reload.md` §8。
- 实现对照：`scripts/runtime/docker-entrypoint.sh` 的 `supervise_ktx`；`webui/server/admin/mcp-runtime-reload.ts`；`webui/server/admin/mcp-runtime.ts` 的 `POST /api/admin/mcp-runtime/reload`；`webui/src/components/McpRuntimeStatusPanel.tsx`。
- 不在本轮：浏览器 E2E、全量 `npm test`、真实 KTX `connection_list`、K8s 探针、写路径 `executionRuntimePending` 的接口实测。

## 命令与结果

### 1. 本地生命周期（已执行）

```bash
bash scripts/verify/verify-ktx-reload-lifecycle.sh --local
```

退出码 0。耗时约 13s。stdout：

```text
== Spec 191 reload lifecycle — local supervisor mode ==
  ok   — supervisor reports the daemon ready
  ok   — capability file publishes the protocol version
  ok   — capability file publishes the supervisor state
  ok   — capability file carries a live supervisor pid
  ok   — daemon pid is published for diagnostics
  ok   — reload receipt is written
  ok   — receipt answers the same requestId
  ok   — receipt reports a succeeded reload
  ok   — receipt carries the digest actually read from disk
  ok   — the reload restarted the daemon (pid 92172 → 92261)
  ok   — supervisor exits on SIGTERM
  ok   — no KTX daemon is left behind after SIGTERM
  ok   — the capability file is revoked when the supervisor stops
  ok   — a failed first start exits non-zero instead of running degraded (status 1)
  ok   — the retry path reaches a ready daemon
  ok   — a daemon that exits on its own is restarted (pid 92430 → 92488)

PASSED: 16 checks
```

安全性：脚本用 `mktemp` 建工作目录，把 stub `ktx` 插到该次进程的 `PATH` 前面，`KTX_PROJECT_ROOT` 指向临时目录。信号只打向它自己拉起的 supervisor 与 stub 记录的 PID。因此执行了，不记 blocked。

边界：daemon 是 stub，不是真实 `ktx mcp start`。该模式设置 `LUCY_ENTRYPOINT_SUPERVISOR_ONLY=1`，不起 WebUI / Proxy。

### 2. 聚焦 vitest（已执行）

```bash
cd webui
KTX_PROJECT_ROOT=$(mktemp -d)   # 实际 /tmp/lucy-uat-191-ktx-root-HzOeA1
npx vitest run \
  server/__tests__/mcp-runtime-reload.test.ts \
  src/__tests__/mcp-runtime-status-panel.test.tsx \
  server/__tests__/mcp-proxy-upstream-session.test.ts \
  --maxWorkers=1
```

退出码 0。Vitest v4.1.9。`Test Files  3 passed (3)`，`Tests  34 passed (34)`，耗时 3.07s。

| 文件 | 用例 |
|---|---|
| `server/__tests__/mcp-runtime-reload.test.ts` | 18 |
| `src/__tests__/mcp-runtime-status-panel.test.tsx` | 6 |
| `server/__tests__/mcp-proxy-upstream-session.test.ts` | 10（含 Spec 191 重载窗口 2 条，以及 keepalive 关闭 1 条） |

三个文件的 `beforeEach` 都会把 `KTX_PROJECT_ROOT` 换成自己的 `mkdtemp`，外层空临时目录没有被当成夹具。

### 3. AC-12 `--container`（未执行）

未运行 `verify-ktx-reload-lifecycle.sh --container`。

当时观察：

- `curl -fsS -m 3 http://127.0.0.1:55176/api/health` → 连接被拒绝（curl exit 7）。
- `docker ps` 中 lucy 相关容器均为 Exited（含 `compose-lucy-1`，约 36 小时前 Exit 137）。没有 healthy 容器，也无法核对镜像修订是否为 `17fdaf08`。
- 已有构建在进行：`docker compose -f deploy/compose/docker-compose.demo.yml up -d --build --force-recreate --no-deps lucy`（约 22:34 启动）及其 `docker-buildx bake`。本轮没有再发起构建。

另外，即使镜像稍后变为 healthy，当前 `--container` 函数也不做 Step 8 表里的检查。见下方缺陷。

## AC 矩阵

| ID | 结论 | 本轮证据 |
|---|---|---|
| AC-1 | passed_automation | `--local`：旧 stub PID 退出、新 PID 就绪、回执 `requestId` 与磁盘 digest 匹配、`ktx-ready` 出现。不是容器内真实 KTX。 |
| AC-2 | passed_automation | `mcp-runtime-reload.test.ts`：stub MCP 的 `connection_list` 含目标连接 → `configVerification=verified`；名单不含目标连接 → `reloadStatus=succeeded` 且 `configVerification=failed`，两事实不合并。 |
| AC-3 | not_run | `--local` 不起 WebUI / Proxy，没有「重载前后两者 PID 不变」的断言。工单 §8.4 把这项放在容器形态。容器未就绪，未测。 |
| AC-4 | passed_automation | 同一进程内两次并发调用：第二次 `already_running`，通道上只有一个请求文件；回执只完成第一次的 `requestId`。 |
| AC-5 | passed_automation | 回执 `failed` → `reloadStatus=failed`、`configVerification=unverified`，`ktx.yaml` digest 不变。不断言旧 daemon 仍可用。 |
| AC-6 | passed_automation | 路由用例写了审计：401 `actor=anonymous` / `operation=denied`；403 `operation=denied`；owner 成功 `operation=succeeded`，`changeType` 查询键为 `execution_runtime_reload`。失败与超时走同一 `recordReloadAudit`，但本轮没有单独断言这两行。open / bootstrap 的 400 也写审计，用例未读审计行。 |
| AC-7 | passed_automation | 无能力文件、心跳过期、协议版本不符均 `unsupported`，且不产生请求文件。 |
| AC-8 | passed_automation | 成功路径在验证前 `clearExecutionRuntimeObservations()`，验证通过后按实际 digest 写入新 `ok` 证据。用例看到的是最终一条 `ok`，没有单独卡住「清空后、写入前」的 `unknown`。 |
| AC-9 | passed_automation | 面板单测：「重新检测执行层」与「重载执行层」是两个按钮；点击重载不触发重检测；待重载文案指向重载；`reloadStatus` 与 `configVerification` 分开显示；无 `onReload` 时不渲染重载按钮。未跑浏览器 E2E。 |
| AC-10 | passed_automation | 同文件内：客户端持有的旧 `Mcp-Session-Id` 被丢弃，buffered `lucy_query` 重新握手并成功，审计 `upstream_session_recovered`；`ping` 流式直转不恢复。keepalive 关闭时不注入会话、不发起恢复握手（`upstream_session_required`）。 |
| AC-11 | passed_automation | open / bootstrap → 400 `AUTH_NOT_CONFIGURED`；未登录 → 401 `AUTH_REQUIRED`；非 owner → 403 `OWNER_REQUIRED` 且无请求文件；owner → 200，三个字段分开返回。 |
| AC-12 | not_run | 见上。本地脚本覆盖了「首次启动失败非 0 退出、自发退出后重启一次、SIGTERM 后无遗留 stub、能力文件撤销」，但 AC-12 的容器表（超退避上限后容器退出、父 shell 退出码、重载窗口 `/api/health` 仍 200）没有跑。 |
| AC-13 | passed_automation | 超时后 `reloadStatus=failed` 且 detail 含「超时」；先写入旧 `requestId` 的成功回执，再发起下一次时新 `requestId` 仍超时，迟到回执不把它完成。supervisor `state=reloading` 时下一次为 `already_running` 且不写请求文件。 |

## 缺陷

### implementation_bug — `--container` 会以 0 项检查假通过

`scripts/verify/verify-ktx-reload-lifecycle.sh` 的 `run_container` 只检查 `LUCY_RELOAD_VERIFY_IMAGE` 与 `docker` 是否存在，打印说明后 `return 0`。脚本末尾在 `FAILURES=0` 时打印 `PASSED: ${CHECKS}`。容器模式不调用 `pass`/`fail`，因此 `CHECKS` 保持 0，退出码仍为 0。

这与脚本头注释、工单 Step 8 表不一致。Step 8 要求：首次启动失败、KTX 自发退出且超过上限后容器退出、SIGTERM 无遗留进程、退出码、重载窗口内 Pod 仍就绪且 `/api/health` 仍 200。当前函数一条都不做。

影响：镜像就绪后若直接跑 `--container`，不能关闭 AC-12，还可能被读成通过。本轮因健康检查失败，没有执行它，所以 AC-12 记 `not_run`，不记 `failed`。

落地修复（假通过只修这一处）：`CHECKS=0` 时改为退出码 2，并打印 `NOT RUN`，不再打印 `PASSED`。Step 8 的容器检查本身仍未实现，AC-12 继续是 `not_run`。

## 规格漂移

工单 §8.3 已记录、本轮未当作新缺陷：

1. 能力文件比 Spec §9.1 示例多了 `state` 与 `currentRequestId`。本地脚本断言 `state=idle`。这是 P7/P9 判断「supervisor 是否仍在执行」的字段，协议版本仍是 `lucy-ktx-reload/1`。
2. `LUCY_ENTRYPOINT_SUPERVISOR_ONLY=1` 只跑 supervisor。生产路径不设置该变量。本轮 `--local` 依赖它。

不另开 spec_drift。§8.1「Step 8 脚本完成」与空的 `--container` 实现不一致，已归入上面的 implementation_bug，不重复计数。

文案对照：面板使用「重载执行层」「重新检测执行层」「配置已写入，执行层尚未加载」。成功与验证失败分成两句。未看到 Spec §14 禁止的「热更新连接」「自动同步连接」「无需重启」。

## blocked / not_run

| 项 | 结论 | 原因 |
|---|---|---|
| `--local` | 已跑，16/16 | 进程与文件都落在临时目录，未打死无关进程。 |
| AC-3 | not_run | 需要同时活着的 WebUI 与 Proxy PID。当前没有 healthy 的当前 HEAD 容器。 |
| AC-12 / `--container` | not_run | `http://127.0.0.1:55176/api/health` 不可达；没有运行中的 lucy 容器可核对 `17fdaf08`；已有 compose build，禁止第二轮构建。 |
| 浏览器 E2E `webui/tests/e2e/specs/mcp-runtime-reload.spec.ts` | 未纳入本轮命令 | 用户要求的是生命周期脚本和 vitest。AC-9 以组件测试记 passed_automation。 |
| 写路径 `executionRuntimePending` | 未测 | Spec §11.1 / 工单 Step 4 有实现（`webui/server/index.ts` 五处返回），仓库内无对应用例。不是 AC-1–AC-13 的失败项。 |

无 blocked。

## 一轮修复建议

只修验收缺口，不加新的重载能力。

1. 让 `--container` 真正执行工单 Step 8 表，失败时非 0 退出。空跑不得打印 PASSED。镜像须已是当前 HEAD，且不要在已有 build 之外再开一次构建。
2. 容器就绪后补 AC-3：记录重载前后 WebUI 进程与 Proxy 进程 PID，断言不变；同时记录 KTX PID 变化，作为 AC-1 的容器形态。
3. 同一轮容器检查补上：连续失败超过退避上限后 supervisor / 容器退出；SIGTERM 后 `ps` 无遗留 KTX；重载窗口内 `/api/health` 仍为 HTTP 200。
4. 给审计补断言：open、bootstrap、`reloadStatus=failed`、超时 detail。实现上这四条已经调用 `recordReloadAudit`，缺的是用例，不是新行为。
5. 给写路径补一条 `executionRuntimePending` 断言（digest 变化为 true，digest 不变为 false）。不要在本轮顺手改重载协议。
