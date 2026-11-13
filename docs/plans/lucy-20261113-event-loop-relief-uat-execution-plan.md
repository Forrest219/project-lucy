# UAT-SUITE-EVENT-LOOP-RELIEF 执行计划

> **For agentic workers:** 本文件是**验收执行计划**，不是新功能实现 Plan。执行时用 `executing-plans` 按 Task 勾选；不要改产品代码，除非验收失败后另开缺陷修复授权。REQUIRED SUB-SKILL：`superpowers:executing-plans`（或 subagent-driven-development）。

| 元数据 | 内容 |
|---|---|
| 文档名称 | UAT-SUITE-EVENT-LOOP-RELIEF 执行计划 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | [`docs/qa/uat/suites/event-loop-relief/`](../qa/uat/suites/event-loop-relief/suite.md)；Spec／Plan／性能证据；本机 demo 实测 |
| 适用范围 | 首次把测试台 INDEX 从 NOT RUN 推进到有 `runs/` 的判定 |
| 输出位置 | `docs/plans/lucy-20261113-event-loop-relief-uat-execution-plan.md` |

**Goal:** 按套件必做项跑通 UAT-R0／LOOP-01…04，把证据写入 `runs/`，再更新 INDEX 与 e2e-ledger；可选 LOOP-05 仅维护窗、且仅含 `/api/livez` 的镜像。

**Architecture:** 两轨串行。Track A＝仓内规模脚本（合成 115k 夹具，不连客户库、不依赖 demo）。Track B＝本机 demo Docker（概览／探针／重启计数）。客户 LOOP-05 默认本波 **SKIP／BLOCKED**（现场仍是 0.25、无 livez）。INDEX 只认本套件 `runs/`，开发机旧 JSON／功能合同收口都不是 PASS。

**Tech Stack:** `npm --prefix webui run perf:event-loop-relief`；demo compose `http://127.0.0.1:55176`；curl／浏览器；跑次模板同 [`roles-agent-page-perf` run](../qa/uat/suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md)。

## Global Constraints

- **≠ 功能合同收口 ≠ 可上线。** 不改 Spec「功能合同已收口」句；只写测试台跑次与 INDEX。
- INDEX 只认 `docs/qa/uat/suites/event-loop-relief/runs/*.md`。`inbox/event-loop-relief-perf.json` 与 `docs/reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md` 只能作对照，不能单独改 INDEX 为 PASS。
- 凭据只写路径：本机 demo 既有会话／fixtures；客户凭据 `/Users/zhangxingchen/Projects/config_for_agents/ksc-lucy-webui.txt`。禁止把密码／token 写入 runs、聊天或仓库。
- **禁止**业务高峰对客户打 `GET /api/admin/audit/turns?hours=168`。
- **禁止**对无 `/api/livez` 的 0.25 镜像套 Chart `0.2.9` 存活探针。
- demo 升级只用平滑 `BUILDPLATFORM=linux/arm64 npm run demo:upgrade`（**不** `--fresh`），保留账号／ACL／audit volume。
- 本波默认**不执行** LOOP-05；记 SKIPPED 或 BLOCKED，并写明原因。

---

## 0. 检查结论（制定本计划时的快照）

| 项 | 现状 | 对执行的含义 |
|---|---|---|
| 测试台 INDEX | **NOT RUN**；`runs/` 仅有 README | 首次执行必须落盘跑次后再改 INDEX |
| 套件文档 | `suite.md`／`cases.md`／`fixtures.md` 已齐 | 步骤与门槛以 cases 为准 |
| 功能合同 | Spec 已收口；SC-14 p99 门槛 **400ms** | 不代替 UAT PASS |
| 工作树实现 | `/api/livez`、`/api/readyz`、审计减负、规模脚本等多处为 **未提交／未跟踪** | Track A 可对工作树跑；Track B 必须先把工作树打进 demo 镜像 |
| 本机 demo | `compose-lucy-1` healthy；WebUI `:55176`；`gitSha=5519ddd4…`；**`/api/livez`＝404**、`/api/readyz`＝404；`RestartCount=0` | 未升级前 UAT-R0（demo）对 livez 记失败／阻塞；不得假装探针已拆分 |
| 旧规模 JSON | `inbox/event-loop-relief-perf.json`：`sc13.pass=true`（p95 105）、`sc14.pass=false`（p99 359，当时门槛 300） | 脚本现门槛已是 400；**必须重跑** LOOP-01，不得抄旧 `sc14.pass` |
| 客户实例 | fixtures 指向 `http://10.69.95.109:8276`（0.25）；无 livez 时应 BLOCKED | 本波不跑 LOOP-05 |

**必做／可选（套件原文）**

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-LOOP-01、UAT-LOOP-02、UAT-LOOP-03、UAT-LOOP-04 | UAT-LOOP-05（维护窗；0.25 → BLOCKED） |

---

## 1. 文件与产物

| 路径 | 职责 |
|---|---|
| `docs/qa/uat/suites/event-loop-relief/suite.md` | 节奏与边界（只读） |
| `docs/qa/uat/suites/event-loop-relief/cases.md` | 逐步期望（只读） |
| `docs/qa/uat/suites/event-loop-relief/fixtures.md` | 基址／门槛／凭据路径（只读） |
| `webui/scripts/event-loop-relief-perf.mts` | LOOP-01 规模脚本 |
| `inbox/event-loop-relief-perf.json` | LOOP-01 原始数字（跑次只抄路径＋四数） |
| **Create** `docs/qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md` | 本波跑次 SOT |
| **Modify** `docs/qa/uat/INDEX.md` | 最近跑次＋结果 |
| **Modify** `docs/governance/e2e-ledger.md` | P1-21 行／GAP-UAT-P1-21 |
| 可选 | 总账／Spec 头部「测试台」镜像句与 INDEX 同句（不改合同收口） |

---

## 2. 执行任务

### Task 0: 环境门禁与是否升级 demo

**Files:** 无代码改动。

- [ ] **Step 1: 记录分支与容器差**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git rev-parse HEAD
curl -sS http://127.0.0.1:55176/api/health | python3 -m json.tool | head -40
curl -sS -o /tmp/lucy-livez.json -w 'livez=%{http_code}\n' http://127.0.0.1:55176/api/livez
curl -sS -o /tmp/lucy-readyz.json -w 'readyz=%{http_code}\n' http://127.0.0.1:55176/api/readyz
docker inspect compose-lucy-1 --format 'RestartCount={{.RestartCount}} StartedAt={{.State.StartedAt}}'
```

Expected（制定计划时）: health `ok`；livez／readyz **404**；记下 `RestartCount` 作 LOOP-04 基线。

- [ ] **Step 2: 判定 Track B 前置**

若 livez ≠ 200：必须先平滑升级，把**当前工作树**打进 `project-lucy:demo`，否则 LOOP-02／03／04 无法按合同验收。

```bash
BUILDPLATFORM=linux/arm64 npm run demo:upgrade
```

Expected: 容器 recreate 后 healthy；volume 保留；WebUI 仍为 `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`。

- [ ] **Step 3: 升级后重验探针（UAT-R0 demo 半段）**

```bash
curl -sS http://127.0.0.1:55176/api/health | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("data",{}).get("lucyVersion"), d.get("data",{}).get("gitSha"), d.get("data",{}).get("gitDirty"))'
curl -sS http://127.0.0.1:55176/api/livez
curl -sS -o /dev/null -w 'readyz=%{http_code}\n' http://127.0.0.1:55176/api/readyz
docker inspect compose-lucy-1 --format 'RestartCount={{.RestartCount}}'
```

Expected: livez 200 且 `{ok:true}`；readyz 预热后 200；记下新 `RestartCount` 与版本。若升级后仍无 livez → **停**，开缺陷，不要写 INDEX PASS。

**通过标准:** 环境快照可写入跑次；Track B 具备 livez。

---

### Task 1: UAT-LOOP-01 — 客户规模夹具（Track A）

**Files:** 读 `webui/scripts/event-loop-relief-perf.mts`；写 `inbox/event-loop-relief-perf.json`。

**Interfaces:**

- Consumes: 工作树中的审计减负＋livez 实现（进程内 Fastify，不连 demo）
- Produces: JSON 中 `sc13.pass`、`sc14.pass`、`turnsP95Ms`、`livezMaxMs`、`livezP99Ms`、`displaySnapshotBusy`

- [ ] **Step 1: 跑规模脚本**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
npm --prefix webui run perf:event-loop-relief
```

Expected: 进程退出码 0；打印含 `sc13`／`sc14`；写出 `inbox/event-loop-relief-perf.json`。耗时约 1–2 分钟级（含 60s 负载）。

- [ ] **Step 2: 核对门槛**

```bash
python3 - <<'PY'
import json
d=json.load(open("inbox/event-loop-relief-perf.json"))
s13,s14=d["sc13"],d["sc14"]
print("turnsP95Ms", s13["turnsP95Ms"], "pass", s13["pass"])
print("livezMaxMs", s14["livezMaxMs"], "livezP99Ms", s14["livezP99Ms"], "BUSY", s14["displaySnapshotBusy"], "pass", s14["pass"])
assert s13["pass"] and s13["turnsP95Ms"] <= 3000
assert s14["pass"] and s14["livezMaxMs"] <= 1000 and s14["livezP99Ms"] <= 400 and s14["displaySnapshotBusy"] == 0
print("LOOP-01 OK")
PY
```

Expected: 断言通过。相对 2026-11-13 基线（p95 105／p99 359／max 487）：未越门槛但数字翻倍 → 跑次单列「变慢」，不单独 FAIL。

- [ ] **Step 3: 抄进跑次草稿（四数＋路径）**

跑次字段至少：`inbox/event-loop-relief-perf.json`；`turnsP95Ms`；`livezMaxMs`；`livezP99Ms`；`displaySnapshotBusy`。

**通过标准:** LOOP-01 PASS（或明确 FAIL 数字）。旧 JSON 的 `sc14.pass=false` 作废。

---

### Task 2: UAT-R0 收口 ＋ UAT-LOOP-03 — 探针拆分（Track B）

**Files:** 无。目标 `http://127.0.0.1:55176`（Task 0 升级后）。

- [ ] **Step 1: 连续 30 次 livez**

```bash
BASE=http://127.0.0.1:55176
python3 - <<PY
import json,urllib.request,time
base="$BASE"
ms=[]
for i in range(30):
  t0=time.perf_counter()
  with urllib.request.urlopen(base+"/api/livez", timeout=5) as r:
    body=json.load(r); code=r.status
  dt=(time.perf_counter()-t0)*1000
  assert code==200 and body.get("ok") is True, (code, body)
  assert dt<=1000, dt
  ms.append(dt)
print("livez_n", len(ms), "max_ms", round(max(ms),1), "p50_ms", round(sorted(ms)[14],1))
PY
```

Expected: 30／30 成功；单次 ≤ 1000ms。

- [ ] **Step 2: readyz ＋ health×20**

```bash
curl -sS -w '\nHTTP %{http_code} time=%{time_total}\n' http://127.0.0.1:55176/api/readyz
python3 - <<'PY'
import json,urllib.request,time
base="http://127.0.0.1:55176"
for i in range(20):
  t0=time.perf_counter()
  with urllib.request.urlopen(base+"/api/health", timeout=15) as r:
    body=json.load(r); code=r.status
  dt=(time.perf_counter()-t0)*1000
  assert code==200 and dt<=15000, (code, dt)
  data=body.get("data") or body
  assert "eventLoop" in data or "eventLoop" in body, list(data)[:20]
print("health x20 OK")
PY
```

Expected: readyz 200（若 `warming_up` 503，等就绪重试一次）；health 均 ≤15s 且含 `eventLoop`。

**通过标准:** UAT-R0（demo）＋ LOOP-03 PASS。

---

### Task 3: UAT-LOOP-02 — 概览 ＋ 7 天访问日志（浏览器＋API）

**Files:** 无。凭据／会话：本机 demo 管理员（路径按既有约定，不写密码）。

- [ ] **Step 1: 记下 RestartCount 基线（供 LOOP-04）**

```bash
docker inspect compose-lucy-1 --format 'RestartCount={{.RestartCount}}'
```

- [ ] **Step 2: 浏览器**

1. 登录 WebUI `http://127.0.0.1:55176`
2. 打开 `/overview`
3. 打开访问日志，时间窗 **7 天**（对应 `hours=168`）
4. 观察是否出现「页面数据暂时无法完成刷新」

Expected: 无该红字；访问日志在 **30s** 内有响应（超时 → FAIL）。

- [ ] **Step 3: 负载窗口内 API 抽样**

在概览／访问日志加载期间另开终端：

```bash
# livez ×30（同 Task 2 Step 1）
# 另：
for p in /api/sources /api/admin/agents /api/project; do
  curl -sS -b "$COOKIE" "http://127.0.0.1:55176$p" | python3 -c 'import sys,json; t=sys.stdin.read(); assert "DISPLAY_SNAPSHOT_BUSY" not in t, t[:200]; print("ok", len(t))'
done
```

`$COOKIE` 用本机已登录会话 cookie 文件路径（只写路径进跑次）。若用浏览器 DevTools 已登录 `fetch`，在跑次写明手段即可。

Expected: 三接口体无 `DISPLAY_SNAPSHOT_BUSY`；livez 30 次均 ≤1000ms。

**通过标准:** LOOP-02 PASS。demo 小库**不**代替 LOOP-01 规模门槛。

---

### Task 4: UAT-LOOP-04 — 负载窗口重启增量

- [ ] **Step 1: 对比 RestartCount**

```bash
docker inspect compose-lucy-1 --format 'RestartCount={{.RestartCount}}'
docker inspect compose-lucy-1 --format '{{.State.Status}} {{.State.ExitCode}}'
```

Expected: 相对 Task 3 Step 1 增量 **＝0**；窗口内无因 liveness 杀进程（无 143 退出归因于探针）。

**通过标准:** LOOP-04 PASS。

---

### Task 5: UAT-LOOP-05 — 本波默认不跑

- [ ] **Step 1: 记录判定**

客户 `http://10.69.95.109:8276` 若仍为 **0.25** 且无 `/api/livez` → 跑次写 **BLOCKED**（不是 FAIL）。  
若已升级含 livez：仅维护窗、非高峰；未授权勿打 `hours=168`；可抽样 livez／概览／重启 → **PASS WITH GAP** 并写明未跑 7 天访问日志。

本波默认：**SKIPPED／BLOCKED**，原因写入跑次。

---

### Task 6: 落盘跑次 ＋ 更新测试台

**Files:**

- Create: `docs/qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md`
- Modify: `docs/qa/uat/INDEX.md`（该行最近跑次／结果）
- Modify: `docs/governance/e2e-ledger.md`（P1-21 结果；GAP-UAT-P1-21 收束或降级）
- 可选同句镜像：总账 P1-21「测试台」句、Spec 头部测试台句（**不**改功能合同收口）

- [ ] **Step 1: 写跑次**（结构对齐既有 run）

```markdown
# Run — 2026-11-13 — cursor-demo-event-loop

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-EVENT-LOOP-RELIEF` |
| Agent | Cursor |
| 环境 | demo `http://127.0.0.1:55176`；容器 …；lucyVersion／gitSha／gitDirty … |
| 开始／结束 | … |
| 总判定 | PASS / PASS WITH GAP / FAIL |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | … | … |
| UAT-LOOP-01 | … | 四数＋JSON 路径；相对基线是否「变慢」 |
| UAT-LOOP-02 | … | 无红字；turns 墙钟；livez |
| UAT-LOOP-03 | … | livez×30；readyz；health×20 |
| UAT-LOOP-04 | … | RestartCount 增量 |
| UAT-LOOP-05 | SKIPPED/BLOCKED | 原因 |
```

- [ ] **Step 2: 改 INDEX**

结果句示例（按实测改）：

- 全必做绿且 LOOP-05 BLOCKED／SKIPPED → **PASS WITH GAP**（或套件约定下必做全绿写 **PASS**，并注明可选未跑）
- 任一必做 FAIL → **FAIL**，INDEX 不得写 PASS

- [ ] **Step 3: 勾连检查**

```bash
npm run lint:e2e-ledger
```

Expected: 退出 0；或按脚本规则修齐指针后再跑。

**通过标准:** INDEX ≠ NOT RUN；有可点开的 `runs/`；GAP-UAT-P1-21 不再是「尚未执行」。

---

## 3. 判定矩阵（总判定）

| 条件 | INDEX 结果 |
|---|---|
| R0＋01＋02＋03＋04 全 PASS；05 SKIPPED／BLOCKED | **PASS**（备注可选未跑）或 **PASS WITH GAP**（若团队把 05 视为交付缺口——本套件原文 05 为可选，优先 **PASS**＋备注） |
| 01 越门槛或 02 出现红字／turns＞30s 或 04 重启增量＞0 | **FAIL** |
| demo 升级后仍无 livez，无法跑 02／03／04 | **BLOCKED**（实现未进镜像）；INDEX 可写 BLOCKED，不得写 PASS |

建议本波口径：**必做全绿 → PASS**；LOOP-05 在备注写 BLOCKED／SKIPPED。

---

## 4. Self-Review

| 检查 | 结论 |
|---|---|
| Spec／cases 覆盖 | R0、01–05 均有 Task；05 明确默认不跑 |
| 占位符 | 无 TBD；命令与门槛为具体值 |
| 与现状一致性 | 已写入「工作树未提交／demo livez 404／旧 JSON sc14.pass=false」三道前置 |
| 禁区 | 高峰 hours=168、0.25 改挂 livez、用合同收口冒充 INDEX PASS 均已禁止 |

---

## 5. 执行交接

计划已落盘：`docs/plans/lucy-20261113-event-loop-relief-uat-execution-plan.md`。

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每 Task 新开子代理，Task 间人工过一眼  
2. **Inline Execution** — 本会话按 `executing-plans` 连续跑，关键检查点停顿  

回复选定后从 **Task 0** 开始（先确认是否 `demo:upgrade`）。
