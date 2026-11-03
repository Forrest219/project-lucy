# Spec 功能合同收口批次 — 进展与待办交接

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 交接对象 | Claude Code（接任本仓「Spec 收口」推进）。**已于 2026-11-01 13:52 接手并产出 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md)**（60 份 Spec 的 A–E 五档实测盘点）——本文件的待办分档以那份为准 |
| 分支 | `lucy-v0.25`，HEAD = `3a0857ee`，工作树干净（除接任方的在途文件） |
| 授权 | PM 于 2026-11-01 批准「听取你的建议，制定计划干」，本批为 A／B／C 三阶段 |
| 结论 | **三份 Spec 的功能合同已收口并提交（5 个 commit），全量门禁绿。** 唯一挡着「全量测试绿」的是**既有服务端 flake**，归属待 PM 定夺 |

---

## 一、本批已交付（可直接接着干，不用重做）

本批在 `a5810e4e`（批次起点）之上共 5 个 commit：

| commit | 内容 | 形态基线 |
|---|---|---|
| `f8a2edd1` | **阶段 A｜#2** `lucy-20261029-url-driven-input-ime-composition-spec.md` 收为 **v1.0 功能合同**。SC-01–SC-23 全部关闭。补齐 11 处此前没有逐处自动化断言的镜像条件②③（新增 `webui/src/__tests__/url-driven-input-mirror-contract.test.tsx` 8 条，扩写 `admin-audit-url-mirror.test.tsx` 8 条，含「清除筛选」一次归零全部 7 处）；把 SC-17 的原始探针输出从被 `.gitignore` 排除的 `inbox/` **入库**到 `webui/scripts/evidence/2026-10-30-url-driven-input-ime-probe/`（与工作区原件 `cmp` 逐字节一致），Spec §6.5 措辞同步改为「工作区保留 + 入库副本」；新增 `docs/reviews/2026-11-01-url-driven-input-ime-composition-closure.md`；Spec 加 §6.6 逐条落点表 + §6.7 闭口层级 | 902 → **901** |
| `4e194e16` | **阶段 B｜#5** `lucy-20261030-publish-workbench-three-column-spec.md` 收为 **v0.4 功能合同**。PWB-01–26 中 **25 条通过**，PWB-24 保留「部分通过」（浏览器走查按闭口层级不在出口，不阻塞但不写成已通过）。补 7 条缺专项用例（新增 `publish-sync-confirm-drawer.test.tsx` 8 条、`publish-workbench-closure.test.ts` 4 条；扩写 `api.publish-workbench.test.ts`、`api.semantic-batch.test.ts`、`publish-recent-releases.test.tsx`、`semantic-asset-publish.test.tsx`）；把 `/api/publish-workbench/evidence` **登记进 `webui/docs/03-api-spec.md`**（`lint:spec` 由 exit 1 转 exit 0）；顺带修掉 `api.semantic-batch.test.ts` 一条既存 typecheck 错误；**未改任何运行代码** | 不变 901 |
| `6b32388f` | **阶段 C｜#1** `lucy-20261029-question-budget-window-optimization-spec.md` 收为 **v1.0 功能合同**。SC-01–SC-48 逐条通过。修 `question-budget-closure.test.ts` 两处 TS2322（从函数签名反推 `UpstreamHandle`，**未改运行代码**，全仓 typecheck 88 → 86）；新增 Spec §7.8 自动化证据落点 + 顶层「闭口层级」；更正 §9 过期登记「SC-01–SC-48 全部未执行」→「全部通过」；新增 `docs/reviews/2026-11-01-question-budget-window-closure.md` | 901 → **900** |
| `bae4b071` | 补 #5 收口记录里「selector-contract 是否已逐条核对」那条残余的核对结论（见下「已核销的残余」） | — |
| `34e6da30` | 更正 #2 收口记录里的 typecheck 计数口径（89 → 现 86） | — |

**形态基线净变化：902 → 900（只减不增，全程无新增豁免条目）。**

本批**未改任何运行代码**——三条 Spec 的收口全部靠「补用例 + 补证据 + 补登记」完成，没有一条是改实现去凑门禁。

---

## 二、当前仓库状态（HEAD = `34e6da30` 实测）

| 检查 | 结果 |
|---|---|
| `node scripts/lint-spec-docs.mjs` | **exit 0**（343 files scanned，900 baseline exemptions，无 STALE） |
| `node --test scripts/lint-spec-docs.test.mjs` | **23/23** |
| `npm run lint:terminology` | **exit 0**（1094 files scanned） |
| `npm run lint:ia-boundary` | **exit 0** |
| `npm run lint:spec` | **exit 0**（本批之前是红的） |
| `cd webui && npx tsc --noEmit` | **86 个既存错误**（本批起点 88 → 86；本批涉及文件 **0** 错） |
| 相对链接（本批 12 个 md 文件） | 299 条，**断链 0** |
| `npm test`（= `vitest run --maxWorkers=1`） | **427 文件 / 5191 条，1 条失败** —— 见第三节 |

`npm test` 是仓库标准命令（`webui/package.json:12`），CI 也跑它（`.github/workflows/lucy-ci.yml:82`）。

---

## 三、待完成事项

### P0｜既有服务端 flake 的归属（需 PM 定夺，接任者第一件事）

这是**唯一**挡着「全量测试绿」的东西，且**与本批三条 Spec 无交集**。它有**两种不同症状**，不要当成一个问题：

**症状 A（早已知，约 1/3 概率）**：`webui/server/__tests__/api.create-connection.test.ts` 的 2 条偶发失败。单独复跑 3 次：2 次全绿、1 次失败。根因已定位：该文件 `beforeEach` 只调 `vi.clearAllMocks()`——**不清 once 实现队列**，上一条用例排队的 `mockResolvedValueOnce` 会漏到下一条；叠加 `vi.resetModules()` 后「测试里 `await import("../ktx")` 与服务器内部 `import("./ktx")` 是否共享同一 mocked 模块实例」是竞态的。归属**连接创建线（Spec 124）**。试过在 `beforeEach` 补 `vi.mocked(ktx.testConnection).mockReset()`——**只是把失败挪到另一条用例**（6 次跑仍失败 2 次），已撤回；稳健修法要重构那条线的 mock 方式（改成读一个可变状态变量，而不是靠 `mockResolvedValueOnce` 的排队顺序）。

**症状 B（本轮新见）**：`webui/server/__tests__/admin-agents.test.ts` → `Access Governance Gate — Agent endpoints > PATCH dryRun surfaces gate decision`，期望 200 实得 **404 `AGENT_NOT_FOUND`**。

- **单独跑该文件 37/37 全绿** ⇒ 是顺序／共享状态依赖，不是确定性缺陷。
- 机制在仓里已有明文：`webui/test/setup.ts` 顶部注释写着「the suites share a process. A suite that sets process.env without cleaning up leaks it into the next suite, and the next suite then sees a different project root / access config - **which shows up as routes answering 404 on perfectly ordinary endpoints**」。
- 关键代码：`resolveProjectRoot()`（`webui/server/project.ts:379`）的解析优先级是 `--project=` CLI 参数 → `KTX_PROJECT_ROOT` env → cwd 向上找 `ktx.yaml`；而 `setup.ts` **只还原 `process.env`，不还原 `process.argv`**。若前序文件往 argv 塞过 `--project=`，后续文件就会读到别的项目根。
- `npm test` 用 `--maxWorkers=1`，**全仓 427 个文件共用一个 fork** ⇒ 泄漏面最大化，这正是 CI 也在暴露的形态。

**未完成的验证（本批被中断，接任者必须补跑）**：pre-batch 基线 A/B 对比——即在 `a5810e4e`（本批起点）上跑同样的全量，确认这条失败**在加了我那 2 个新测试文件之前就存在**（预期：存在，但受害者文件可能不同——上一轮全量的受害者是症状 A 的 2 条，本轮换成症状 B 的 1 条，两轮都是「不同文件偶发失败」，这本身就是顺序依赖的指纹）。命令：

```bash
cd /Users/forrest/GitHub/project-lucy
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
git worktree add --detach /tmp/ktx-prebatch a5810e4e
ln -s "$PWD/webui/node_modules" /tmp/ktx-prebatch/webui/node_modules
(cd /tmp/ktx-prebatch/webui && env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1)
# 跑完清理：先删软链，再用 git worktree remove --force
```

**建议归属**：归**跨文件测试隔离**这条线，不归本批三条 Spec 中的任何一条。两条修法候选：(a) 扩展 `setup.ts`，同时快照/还原 `process.argv`；(b) 要求各测试文件在自己的 `afterEach` 还原 env。**PM 定夺**：交回连接创建线修，还是另开一项一次性清理。

### P1｜发布取证层零份 Spec

`docs/specs/` 共 60 份，其中 **18 份已声明「闭口层级 = 功能合同」，0 份声明「发布取证」**。

> ⚠️ **口径提示（2026-11-01 13:52 后补）**：上面这个 18 是「**已写入闭口层级小节并声明为功能合同层**」的份数（`grep -rlE '^- 层级：功能合同' docs/specs/`），**不等于「已完成收口」的份数**——这 18 份里只有 **9 份**的状态行明写「功能合同已收口」。按「状态行已写明收口／验收／关闭」口径统计是 **12 份**。两个数字都对，口径不同，别混用。
>
> **完整盘点见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md)**（Claude Code 于 2026-11-01 13:52 产出的逐份实测盘点，把 60 份分成 A 已收口 12 / B 可立即收口 3 / C 要补出口才能收 10 / D 不具备收口条件 9 / E 发布取证层 0，并指出 D 档另有 42 份存量 Spec 完全没有「闭口层级」小节——那是形态债）。接任者以那份为准。

按 `docs/governance/DEVELOPMENT.md` §71–114 的分层，客户镜像／部署／远端 CI 绿灯这类证据目前**没有任何 Spec 承载**——本批三份 Spec 的「不在本条出口」段落都把这类项推给了发布取证层，但那一层是空的。

**建议下一批**挑一条已收功能合同的（如 #5 发布工作台三栏）立「发布取证」层 Spec 与出口矩阵，把「本条收口不表示可上线」这句落到实处。

### P1｜L25 台账 16 条中多数出口矩阵未执行

登记册：`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`（L25-01 … L25-16）。已知状态：L25-11 **已关闭**（FC-01–FC-32，2026-10-31）；L25-12 **待评审、暂不开发**（新 Spec `lucy-20261031-help-center-experience-*`，SC-01–SC-20 全未执行；旧草案 `lucy-20261021-v2p5-help-center-spec.md` 已被取代**不得实施**）；L25-15 定稿 v0.11 待实施（SRR-01–SRR-24 全未执行）；L25-10 分区画像 Wave A 已落地；L25-09 / L25-14 / L25-16 进行中。**具体「哪几条矩阵未执行」需接任者复核**（前一批盘点为 12/16 未执行，但那是上一次会话的快照）。

另：**G30 仍开、G31 挂起**（#5 收口**未**恢复／关闭 G31，也未改 `publish-coordinator.ts` 与 `semantic-recovery-journal.ts` 的锁生命周期）；Wave 0b 与客户交付保持 `blocked_delivery`。

### P2｜`npm run e2e:selector-contract` 整体红（201 条）

实测 201 条 `[UNREGISTERED]` **全部来自既有组件**（`DisplayRefreshNotice`、`WikiAccessDrawer`、`WikiBatchAccessDrawer` 等）。**本批新增 0 条**——本批 44 个 testid 里 42 个产品 testid 全部已登记在 `docs/qa/selector-contract.md`，另 2 个（`open-drawer`、`cancel-count`）是测试夹具自造的，不进产品合同。补登记一批既有 id 能降一部分，整体仍红。

### P2｜两处小登记缺口

- `webui/docs/README.md` 编号列表只到 **192**，**193 未登记**。193 = 业务 Wiki 访问权限管理（Spec 193 / Plan M66），文件在 `webui/docs/193-business-wiki-access-management-spec.md`。**不属本批三条 Spec**，接任者可顺手补。
- `docs/qa/selector-contract.md` 缺 `semantic-asset-export-button`——它是**既有**产品 testid（`webui/src/components/semantic-assets/SemanticAssetExportButton.tsx:29`，prop 默认值），登记册只登记了同族的 `-summary` / `-download` / `-excluded`。门禁不报它（门禁只扫字面量 `data-testid="..."`），但既有测试 `semantic-asset-export.test.tsx` 在用。

### 已核销的残余（本批补掉，不必再查）

- #5 的「本条新增 testid 是否已登记未逐条核对」→ 已核对，结论写入 `docs/reviews/2026-11-01-publish-workbench-three-column-closure.md` 的「残余」一节。
- #2 的探针证据只在 `inbox/`（被 `.gitignore` 排除，第三方无法复查）→ 已入库副本。

---

## 四、操作纪律（接任必读，都是本批踩过的）

1. **全量测试必须用干净 PATH**。本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash --rm-compatible -rf` 的包装，且该目录在 `PATH` 里靠前。任何**子进程**里执行 `rm -rf` 都会被垫片拦走，在非交互子进程里**会挂死不返回**（实测一个 bash 脚本带垫片 20s 超时挂死、摘掉垫片 0.035s 成功）。典型误判：vitest 报 `Test timed out in 5000ms` 但该文件耗时 **120 秒**——失败时长与超时上限差两个数量级，像机器慢，实际是垫片死锁（`spawnSync` 阻塞事件循环，vitest 的 5s 超时无法中断它）。**直接调 `mavis-trash` 也会挂起**。删文件用 node 的 `fs` API。
   ```bash
   CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
   env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1
   ```
   macOS 的 `paste -s -d` 与 GNU 不同，勿用。

2. **形态基线只减不增**。`docs/governance/spec-plan-doc-baseline.json` 不得新增条目；违规消失后删条目。删条目用 `JSON.stringify(b,null,2)+"\n"` 写回，保持逐字节无格式漂移。**存量 Spec 补「闭口层级」是合法还债路径**：补上 → 基线条目变 STALE → 删掉它（本批 902 → 900 就是这么来的）。

3. **新增 Spec/Plan 与索引登记必须同一个 commit**。`scripts/lint-spec-docs.mjs` 的 `index` 规则对**已跟踪**的 Spec/Plan 判「未登记」即阻塞（exit 1），未跟踪时只报 WARN——所以 `git add` 的那一刻起，索引行就必须存在。Spec → `docs/README.md`，Plan → `docs/plans/README.md`。

4. **共享索引文件是并发热点，提交前逐文件复核 diff**。`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md`、`webui/docs/README.md` 常同时含多个主题的改动，且**另一个会话的 `git add` + commit 会把它自己版本的共享文件整体提交上去，静默抹掉我方改动**——不是冲突、不是报错，commit 成功、工作区干净、diff 里看不出异常。**只有逐文件比对 diff 才能发现**。代码文件被覆盖会立刻编译失败，**登记类文件被覆盖则静默**（且「登记行丢失」不触发任何门禁，指望门禁兜底是不行的）。共享索引要按 hunk 拆到各主题 commit 时，别用 `git add -p`（非交互不可用），改用「中间版本内容」法：备份最终版本 → 脚本逐级派生中间版本 → 每主题写一次并 commit → 最后一个 commit 恢复最终版本。

5. **版本计数器是跨会话共享的**。写 `docs/governance/project-overview.md` 前**必须实读顶部版本行取 current+1**；历史变更行按惯例不回改。本批用到 v1.78 / v1.79 / v1.80。

6. **登记册纪律**：只有 L25 台账号条目才改 `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`；本批三份都不在登记册内。**§9 是策展式索引**：只更新已存在的行，不新增小 Spec 行。

7. **出口按层收窄判据**（`DEVELOPMENT.md:80`）。出口里某项检查**若不是本条承诺的可打假检查**，按功能合同／发布取证分层**收窄出口措辞**，而不是去修全仓基线。反例：真实实现缺口必须补用例，**不能靠收窄出口掩盖**。本批三处都是先补用例再收口——#2 补 11 处逐处断言、#5 补 7 条专项用例、#1 写明 SC-04 证据等级。**「收口」不等于「改代码让它变绿」**：#5 的 PWB-17「轮询终止」是按实际形态收敛的（本条自身发布动作是同步的，§4.4 条件不成立；唯一相关异步轮询在终态停止，用组件用例断言），**未改运行代码**。

8. **收口配方**（`DEVELOPMENT.md` §98–108 模板）：① 写 `docs/reviews/YYYY-MM-DD-<slug>-closure.md`（出口矩阵结果 + 证据落点 + 证据等级 + 残余 + 不在收口里）；② 改 Spec 状态行 → `vX.Y 功能合同已收口（日期）…本条收口不表示可上线`；③ 改 Plan 状态行；④ 同步 `docs/README.md`；⑤ 同步 `docs/plans/README.md`；⑥ 同步 `docs/governance/project-overview.md`（升版 + 版本行）；⑦ 跑 `lint:spec-docs` 须 exit 0。

9. **SC 编号跨 Spec 串号**：`SC-17`/`SC-20`/`SC-24`/`SC-25` 等至少 6 个 Spec 各有一套含义，grep 会命中完全无关的文件。「SC 全覆盖」**无法机器校验**，只能靠逐条 SC→用例名映射表人工对账——本批三份都在 Spec 里补了逐条落点表。

10. **新增 root test 文件必须同时登记进 `scripts/gates/root-test-registry.json`**（2026-11-01 收尾时补记）。该注册表是 daily contract 层的**单一事实源**：`scripts/gates/root-test-registry.test.mjs` 断言「**每个被 git 跟踪的 root test 恰好登记一次**」，登记与实际跟踪集合漂移即 fail。两条坑都踩过：
    - 新增 `scripts/smoke/lucy-runtime-build-context.test.mjs` 后没登记 → `test:root-contracts` 与 `test:ci-workflow-contracts` 双红；
    - 登记了但文件还没 `git add` → 报「is registered but is not a tracked root test」——**新增文件与登记必须同批提交**。
    另：**别在 workflow 里重复列 root test**。注册表按 `entry.gate` 筛选（`run-root-contract-tests.mjs`），`gate: "workflow-contracts"` 的条目由 `npm run test:root-contracts` 自动执行；在 `.github/workflows/` 里再手写一条 `npm run ...:test` 是重复执行。CI 的 run 列表里也**看不到**这些测试——它们是被 registry 间接带进来的，只 grep `node --test` 字面量会误判「CI 里没跑」。

11. **`environment` 字段决定测试进不进 daily gate**。注册表里 `environment: "deterministic"` 的 91 项都**不需要外部服务**；真依赖 Docker daemon 的（先例 `scripts/runtime/docker-build-mirrors.test.sh`）标 `environment: "docker"` + `gate: null` + `reason`，**排除出 daily contract layer**，实际执行挂在 `docker-smoke` 那个 CI job。契约测试会断言 workflow-contracts 层的条目必须 `environment === "deterministic"`，且路径不得含 `real-e2e|customer-release|postgres|mysql|doris|browser|playwright`。

---

## 五、建议的接任顺序

1. **跑完 pre-batch A/B**（第三节命令），给服务端 flake 定性 → 出归属建议交 PM。这条不解决，「全量绿」就永远差一条。
2. **立第一条「发布取证」层 Spec**，把功能合同层共同指向的空白层补上。
3. **继续收口功能合同层剩余 Spec**（60 份里已声明功能合同层 18 份、其中状态行明写已收口 9 份；完整分档见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md)，接任者以那份为准）。
4. 顺手补 P2 的两处登记缺口（`webui/docs/README.md` 的 193、`selector-contract.md` 的 `semantic-asset-export-button`）。

---

## 六、可复用命令

```bash
cd /Users/forrest/GitHub/project-lucy

# 形态与静态门禁
node scripts/lint-spec-docs.mjs                     # exit 0
node --test scripts/lint-spec-docs.test.mjs          # 23/23
npm run --silent lint:terminology                    # exit 0
npm run --silent lint:ia-boundary                    # exit 0
npm run --silent lint:spec                           # exit 0

# daily contract 层（root test 注册表是单一事实源；新增 root test 必须登记）
npm run --silent test:root-contracts                 # exit 0
npm run --silent test:ci-workflow-contracts          # exit 0

# 客户镜像构建上下文（真跑 docker build；在 docker-smoke CI job 里执行）
npm run --silent smoke:p0:delivery-isolation:build-context   # exit 0（~0.6s）
npm run --silent smoke:p0:delivery-isolation:test             # exit 0（静态解析器断言）

# 基线删条目（只减不增，JSON.stringify(b,null,2)+"\n" 逐字节无损）
node -e 'const fs=require("fs");const P="docs/governance/spec-plan-doc-baseline.json";
const b=JSON.parse(fs.readFileSync(P,"utf8"));
b.entries=b.entries.filter(e=>!(e.file==="<FILE>"&&e.rule==="close-layer"));
fs.writeFileSync(P,JSON.stringify(b,null,2)+"\n");'

# typecheck
cd webui && npx tsc --noEmit 2>&1 | grep -cE "error TS"   # 现 86

# 全量 WebUI（必须摘掉 mavis-trash 垫片）
cd webui && CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1
```

---

## 七、不在交接里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这份交接里。**本批三份 Spec 的收口都不表示可上线**，也不构成客户包验收。
