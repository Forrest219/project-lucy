# URL 驱动受控输入框的输入法组合中断优化 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 授权 | PM 于 2026-11-01 批准「听取建议，制定计划干」，本条为阶段 A |
| 对象 | [URL 驱动受控输入框的输入法组合中断优化 Spec](../specs/lucy-20261029-url-driven-input-ime-composition-spec.md) v1.0；[配套 Plan](../plans/2026-10-29-lucy-url-driven-input-ime-composition-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-23 全部关闭，阻塞 0。**本条收口不表示可上线。** 本条不占 L25 台账号 |

## 出口

本条闭口层级（Spec §6.7）声明的出口：

- SC-01–SC-13 的**逐处**自动化用例——`webui/src/__tests__/admin-audit-url-mirror.test.tsx`、`webui/src/__tests__/url-driven-input-mirror-contract.test.tsx`
- SC-14–SC-16 的静态门禁与其单测——`webui/scripts/lint-url-driven-input.mjs`、`webui/scripts/__tests__/lint-url-driven-input.test.ts`
- SC-17 的真实浏览器探针记录——`webui/scripts/evidence/2026-10-30-url-driven-input-ime-probe/`
- SC-18–SC-19 的伴生缺陷用例——`webui/src/__tests__/url-driven-input-transform-writeback.test.tsx`
- SC-20 的全量 WebUI 测试与两个既有 URL 断言哨兵
- SC-22–SC-23 的回声与消费点用例
- `npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:url-driven-input`

**不在本条出口**：远端 CI job 的绿灯（证据等级）；整库旅程、Agent 路径与跨模块故障演练；镜像构建、部署与客户环境验证；移动窄屏与响应式验证；Safari / WebKit 与真实 OS 级输入法实测；Firefox 实测；全仓 typecheck 基线；**全仓形态门禁 `npm run lint:spec`**（本条不新增任何后端接口——见「残余」）。

验收断言原文见主 Spec §6，自动化证据逐条落点见主 Spec §6.6。本文件不重复抄写落点，只给结论、本次实测与本轮补的动作。

## 本轮补的三件事

收口前对 SC-01–SC-23 逐条核对，发现三处不成立或过期，都在本轮补掉，而不是靠收窄出口掩盖。

### 一、SC-01–SC-13 的条件 ②③ 在 11 处没有逐处自动化断言

SC-01–SC-13 是**逐处**承诺（Spec §6.1，每处五个条件）。收口前的实际覆盖是：

- 条件 ①（`value` 不取自 URL 派生变量）：13 处由静态门禁逐文件打假 ✓
- 条件 ②（键入后 URL param 立即等于原文、尾空格保留）：只有 Audit 的 2 处（`user`、统一搜索）有用例
- 条件 ③（深链初值）：只有 Audit 的 `user` 有用例
- 条件 ④（`POP`）：只有 Audit 的 `user` 有用例
- 条件 ⑤（清除筛选归零）：只有 Audit 的 `user` 有用例

也就是说，**其余 11 处的条件 ②③ 没有任何自动化断言**。这是真实缺口，不是措辞问题。收窄出口掩盖不了——条件 ②③ 是本条承诺的核心，且「参数名映射写错」这类缺陷只有逐处断言才打得到。

本轮补法（不新增实现，只补断言）：

- 新增 `webui/src/__tests__/url-driven-input-mirror-contract.test.tsx`——配置审计 3 处（`targetId` / `filePath` / `source`）、Token 1 处、Catalog 1 处、发布历史 1 处，逐处断言深链初值 + URL 立即等于原文（保留尾空格）
- 扩写 `webui/src/__tests__/admin-audit-url-mirror.test.tsx`——补 Audit 其余 6 处（统一搜索 / 工具名 / Session ID / 访问 IP / 最近设备名 / 表名）的条件 ②③，以及「清除筛选」在 turns 与 calls 两个视图下**一次归零全部 7 处**（条件 ⑤）
- 补 SC-23 的两条尾巴：目录 `q` 的**消费点按 trim 后的值过滤**（用「表名含 `abc` 但原文是 `abc `」构造可判别断言）、Token 的**文本 `all` 与下拉框 `all` 哨兵并存**（文本 `all` 进 `search=all`；下拉框选「全部状态」删掉 `status` 参数）

条件 ④⑤ 的实现全部在共用件 `webui/src/lib/useUrlMirroredField.ts` 与 Audit 的 `clearFilters` 里；Audit 页逐处验证了这套共用件的真实行为，其余四页**没有「清除筛选」动作**，条件 ⑤ 对它们不适用。

### 二、SC-17 的原始证据在 `inbox/`，第三方无法复查

Spec §6.5 原写「SC-17 必须有真实浏览器运行记录（含探针脚本与输出留痕，落 `inbox/`）」，而 `inbox/` 被 `.gitignore` 排除（第 52 行）。验收记录也写明「原始输出在 `inbox/ime-composition/probe/`，不入库」。这与「收口＝第三方可复查」直接冲突。

本轮改法：**工作区副本保留，入库一份可复查副本**。

- 探针脚本本来就在仓内——`webui/scripts/ime-composition-probe.mjs`（commit `f4630d57`，2026-10-30 01:34，此后未改），所以「脚本」这一半不缺
- 缺的是「输出」这一半。现入库于 `webui/scripts/evidence/2026-10-30-url-driven-input-ime-probe/`：
  - `probe/chrome-version.txt`、`probe/ime-composition-probe-output.txt`、`probe/ime-composition-probe-output.json`（与 `inbox/` 原件**逐字节一致**，已用 `cmp` 核对）
  - `lint-baseline-before.txt`、`lint-baseline-after.txt`（SC-14 的改造前 13 处 / 改造后 0 处基线）
  - `README.md`：来源、复现步骤、证据等级与边界
- Spec §6.5 的措辞随之改为「工作区保留 + 入库一份可复查副本」

### 三、验收记录里的三处过期登记

`docs/reviews/2026-10-30-url-driven-input-ime-acceptance.md` 是 2026-10-30 的当时事实，本轮**不回改上文**，只在该文末尾追加「2026-11-01 更正」：

1. 「原始输出……不入库」→ 已入库副本（见上）
2. 「全量 `npm test` 4640/4641，失败文件每次不同」→ 该既有 flake **仍在**，但 2026-10-30 当时的判断（「与本次前端改动无交集」）**经复测成立**：全量跑到 425 个测试文件 / 5173 条用例，偶发失败的是 `server/__tests__/api.create-connection.test.ts` 的 2 条，单独复跑 3 次有 2 次全绿。本条不碰任何服务端代码。根因见下方「残余」一节
3. 「`lint:spec-docs` 仍被另一会话的 CI restoration 文档挡住」→ 已由 commit `09701392` 修复，该门禁现为 exit 0

## 这次跑过的检查

```bash
# 逐处镜像契约（本轮新增 / 扩写）
cd webui && npx vitest run --maxWorkers=1 \
  src/__tests__/admin-audit-url-mirror.test.tsx \
  src/__tests__/url-driven-input-mirror-contract.test.tsx \
  src/__tests__/url-driven-input-transform-writeback.test.tsx
# → 3 个文件 / 28 条通过

# 静态门禁
node webui/scripts/lint-url-driven-input.mjs    # → URL-driven input lint passed (161 files scanned). exit 0
npm run lint:terminology                          # → passed (1094 files scanned). exit 0
npm run lint:ia-boundary                          # → passed. exit 0
node scripts/lint-spec-docs.mjs                   # → exit 0（343 files scanned）

# 全量 WebUI（必须摘掉 mavis-trash 垫片，否则子进程里的 rm -rf 会挂死）
cd webui && CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1
# → 425 个测试文件 / 5173 条用例：423 个文件全绿；
#   server/__tests__/api.create-connection.test.ts 的 2 条偶发失败（既有服务端 flake，见「残余」）
```

**变异验证**：把 `useUrlMirroredField` 的写入改成 `writeRef.current(prev, raw.trim())`（回到改造前的写前 trim 写法）后重跑，逐处用例 **14 条转红**——证明这些断言确实能打假「原文写回」这条承诺，不是空断言。验证后已复原，`git diff` 对该文件为空。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | 镜像契约：`admin-audit-url-mirror.test.tsx`「输入后 URL 立即等于原文」「深链初值」「浏览器后退（POP）后输入框回到历史条目的值」「清除筛选清空输入框并移除 URL 参数」「清除筛选时参数本来就是空的，输入框也必须清空（reset 生效）」；真浏览器：探针 `audit-user`（`compositionstart`=1 / 最终值 `中文` / value setter=0 / 焦点保持） |
| SC-02 | 通过 | 「统一搜索：末尾空格保留在输入框与 URL，消费值再 trim」「unified：深链初值显示该值……」「turns 视图：user / 统一搜索 / 表名 三处一起归零」；真浏览器：`audit-unified-search` |
| SC-03 | 通过 | 「tool：深链初值显示该值……」＋「calls 视图……五处一起归零」；真浏览器：`audit-tool` |
| SC-04 | 通过 | 「sessionId：深链初值显示该值……」；真浏览器：`audit-session-id` |
| SC-05 | 通过 | 「clientIp：深链初值显示该值……」；真浏览器：`audit-client-ip` |
| SC-06 | 通过 | 「deviceName：深链初值显示该值……」；真浏览器：`audit-device-name` |
| SC-07 | 通过 | 「tableSearch：深链初值显示该值……」；真浏览器：`audit-table-search` |
| SC-08 | 通过 | `url-driven-input-mirror-contract.test.tsx`「targetId：深链初值显示该值……」；真浏览器：`config-audit-target-id` |
| SC-09 | 通过 | 同文件「filePath：深链初值显示该值……」；真浏览器：`config-audit-file-path` |
| SC-10 | 通过 | 同文件「source：深链初值显示该值……」；真浏览器：`config-audit-source` |
| SC-11 | 通过 | 同文件「Token：逐处镜像（SC-11）」的「深链初值显示该值……」；真浏览器：`tokens-search` |
| SC-12 | 通过 | 同文件「目录：逐处镜像（SC-12）」的「深链初值显示该值……」＋「SC-23：消费点按 trim 后的值过滤……」；真浏览器：`catalog-q` |
| SC-13 | 通过 | 同文件「发布历史：逐处镜像（SC-13）」的「深链初值显示该值……」；真浏览器：`publish-history-actor` |
| SC-14 | 通过 | 入库基线 `lint-baseline-before.txt`（改造前恰好 13 处，与 Spec §2.1 全表一致）与 `lint-baseline-after.txt`（改造后 0 处）；现测 `lint:url-driven-input` → passed，exit 0 |
| SC-15 | 通过 | `lint-url-driven-input.test.ts` describe「zero false positives on known-good pages (SC-15)」5 条：`HelpCenter.tsx` / `AgentList.tsx` / `RoleList.tsx` / `SkillList.tsx` / `AccessMap.tsx` 全部报 0 处 |
| SC-16 | 通过 | 同文件 describe「judgement categories (SC-16)」：缺陷写法报错 / 正确范式不报错 / `useState(searchParams.get(...))` 不报错 / 非文本 input 不参与判定 |
| SC-17 | 通过 | `webui/scripts/evidence/2026-10-30-url-driven-input-ime-probe/`：Chrome `156.0.8078.73`，15/15（13 处目标 + 2 个对照件）。对照件 `control-url-driven` 复现 3 次重启 / `zhongzhongwen中文` / 6 次写入，`control-local-state` 为 1 / `中文` / 0——**探针本身有效** |
| SC-18 | 通过 | `url-driven-input-transform-writeback.test.tsx`「SC-18：AuditReconciliation 问询 ID 输入框保留原文」：输入框保留 `  turn-42  `，请求按 trim 后的 `turn-42` 发起 |
| SC-19 | 通过 | 同文件 describe「SC-19：CaseEditor 期望指标输入框可键入「, 」」2 条：受控值是原文、`", "` 不被抹掉；提交时下发 `["weighted_discount","profit_margin"]` |
| SC-20 | 通过（本条相关用例全绿、无回归） | 全量 425 个测试文件 / 5173 条用例：423 个文件全绿。`server/__tests__/api.create-connection.test.ts` 的 2 条**既有服务端 flake**偶发失败（见「残余」，与本条无交集）。两个既有哨兵未回归：`audit.test.tsx`「`user=analyst_zhang` 服务端查询断言」、`admin-audit-turns.test.tsx`「shows clear-filters when a non-default filter is active」 |
| SC-21 | 通过（部分归发布取证） | `lint:terminology` / `lint:ia-boundary` / `lint:url-driven-input` 全绿；CI 已接线于 `.github/workflows/lucy-release.yml` job `spec-and-webui`。**远端 CI job 未跑——证据等级，不在本条出口** |
| SC-22 | 通过 | `admin-audit-url-mirror.test.tsx`「SC-22：较早的 URL 值晚到时不覆盖草稿」「SC-22：新值先确认、旧值后到时也不覆盖草稿」——可控延迟的 router 替身稳定复现两种顺序 |
| SC-23 | 通过 | Audit 统一搜索与消费点：「统一搜索：末尾空格保留在输入框与 URL，消费值再 trim」＋「统一搜索的末尾空格不会进入请求参数」；目录 `q`：「SC-23：消费点按 trim 后的值过滤（原始尾空格只留在输入框与 URL 里）」；Token：「SC-23：文本 `all` 是普通文本，不走下拉框的「清空」哨兵」＋「SC-23：下拉框的 `all` 清空哨兵不变——选「全部状态」把 status 参数删掉」 |

## 残余，不打回本条

- **全量测试有一条既有服务端 flake，约 1/3 概率变红——归属另一条线，本轮未修。**
  - 现象：`webui/server/__tests__/api.create-connection.test.ts` 的 2 条（「POST /api/connections/probe tests without writing yaml or secret」等）偶发失败。单独复跑该文件 3 次：2 次全绿、1 次失败。
  - 根因（已定位）：该文件的 `beforeEach` 只调 `vi.clearAllMocks()`——它**不清 once 实现队列**，所以上一条用例排队的 `mockResolvedValueOnce({ status: "error" })` 会漏到下一条用例；叠加 `vi.resetModules()` 之后「测试里 `await import("../ktx")` 与服务器内部 `import("./ktx")` 是否共享同一个 mocked 模块实例」是竞态的，于是漏到的 queue 落在哪条用例上随机。
  - 与本条**无交集**：本条只改前端渲染层与两个前端测试文件，服务端代码零改动。
  - 试过但**不采纳**的修法：在 `beforeEach` 补 `vi.mocked(ktx.testConnection).mockReset()`——实测**只是把失败挪到另一条用例**（6 次跑仍失败 2 次），没有真正消除。因为稳健修法要重构那条线的 mock 方式（例如把 mock 实现改成读一个可变状态变量，而不是靠 `mockResolvedValueOnce` 的排队顺序），属于**连接创建线**（Spec 124）的测试资产，不在本批收口范围内，不擅自改。
  - 影响：本条 SC-20 的两个既有 URL 断言哨兵均通过，本条相关用例全绿；受影响的只有那条线的连接探针用例。
  - 建议：由 PM 决定是交回连接创建线修，还是另开一项一次性清理。

- **`npm run lint:spec` 收口时为红，现已转绿。** 收口当时它是红的（exit 1）：`webui/docs/03-api-spec.md: missing /api/publish-workbench/evidence`。该缺口是**另一条线**（发布工作台三栏）新增的接口没登记，与本条无交集——本条不新增任何后端接口，`03-api-spec.md` 里也没有本条的接口。它不是本条能打假的检查，按 [`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「功能闭口与发布取证」的分层，全仓形态门禁归发布取证，故不写进本条出口。**同批工作的阶段 B 已补上该登记，复核 `lint:spec` exit 0。**
- **远端 CI job 未跑**。CI 里 `lint:url-driven-input` 这一步已接线（`.github/workflows/lucy-release.yml:98`），但没在远端执行过。证据等级，归发布取证。
- **Safari / WebKit 与真实 OS 级输入法（macOS 拼音、Windows 微软拼音）未实测，Firefox 未实测**。Chrome 的 IME 组合 API 是忠实模拟，不等价于系统级实机验证（Spec §1.2 C 级）。
- **行权限视图的 5 处清单筛选框**在本条之后由另一条功能线（行权限视图呈现修订，commit `8982ef0d`）改用了同一个 `useUrlMirroredField`。它们不在本条 13 处承诺内，Spec §1.4 的 C-3 判定已被后续实现取代——本轮已在 Spec §6.6 末尾记录，免得后来的读者对不上数。
- **全仓 typecheck 89 个既存错误**与本条无关（纯前端交互层，无 TS 类型改动），不在本条出口。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。本条收口不表示可上线，也不构成客户包验收。
