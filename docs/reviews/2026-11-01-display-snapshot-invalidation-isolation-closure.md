# 展示快照变更去重与影响范围隔离 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261030-display-snapshot-invalidation-isolation-spec.md`](../specs/lucy-20261030-display-snapshot-invalidation-isolation-spec.md)（Spec 195，收口后 **v0.2**） |
| Plan | [`webui/docs/plans/wo-20261030-display-snapshot-invalidation-isolation.md`](../../webui/docs/plans/wo-20261030-display-snapshot-invalidation-isolation.md)（WO-20261030） |
| 台账号 | 无（未挂在 v0.25 登记册 L25-01–L25-16 上） |
| 层级 | **功能合同** |
| 结论 | **SI-01–SI-14 全部关闭。** 本条收口**不表示可上线**——镜像构建、部署、客户交付、现场实例复核均不在本条出口 |
| 授权 | PM 2026-11-01 批准「B 档 + 形态搭车」批次 |

---

## 一、出口矩阵结果（逐条 SI → 用例 → 文件）

**证据等级分两档**：SI-01–SI-13 为**本地自动化（vitest）**；SI-14 为**本地匿名夹具 ＋ 生产构建 ＋ 桌面 Chromium**。均无 CI job 证据，无客户环境证据。

| SC | 结果 | 证据落点（文件 → 用例／断言要点） |
|---|---|---|
| SI-01 | 通过 | `display-snapshot.test.ts`「metadata → full」「full → metadata」「concurrent observation」三种顺序，同版本只失效一次 |
| SI-02 | 通过 | 同上「a second version, a deletion and a recreation are each confirmed once」「an atomic replace is confirmed once」「a same-content rewrite with a new mtime still moves the semantic generation once」 |
| SI-03 | 通过 | `display-revisions.test.ts`「unified file revision ledger」（晚到观察不覆盖新账本、已确认版本不再通知、context 切换起新账本） |
| SI-04 | 通过 | `display-invalidation.test.ts`「an overlay-only save advances D but not P/C and does not rebuild the Agent permissions」 |
| SI-05 | 通过 | `display-revisions.test.ts`「a real write keeps both invalidation edges and is not invalidated again」「a nested write is only confirmed when the outermost transaction ends」「a rename registers both ends and is not invalidated again」 |
| SI-06 | 通过 | 同上「a delete is registered and is not invalidated twice」＋ 既有回滚／权限批处理回归 `display-rollback-races.test.ts`、`admin-permission-batch.test.ts` 保持绿 |
| SI-07 | 通过 | `display-permission-runtime.test.ts`「verification health is isolated per dependency scope」（overlay 不可读 → 语义资产如实失败、Agent 仍正常；语义层不可枚举 → D 与 P 同时失败） |
| SI-08 | 通过 | `display-invalidation.test.ts`「a Manifest write still invalidates and rebuilds the Agent permissions」「a connection-scope change still invalidates the Agent permissions」 |
| SI-09 | 通过 | `display-snapshot.test.ts`「an overdue verification serves no payload and recovers afterwards」「a request that gives up does not stop the shared verification task」 |
| SI-10 | 通过 | 同上「one request spends at most three attempts and one recovery budget」「concurrent readers of one scope share the verification task」「the display build cap stays at four and file I/O at two」 |
| SI-11 | 通过 | `display-permission-runtime.test.ts`「a permission change during the statistics wait rejects the old permission result」 |
| SI-12 | 通过 | `display-snapshot.test.ts`「a busy request reports a distinguishable reason without sensitive content」 |
| SI-13 | 通过 | `display-refresh-notice.test.tsx`（7 条）＋ `agent-list.test.tsx`（1）＋ `catalog-loading.test.tsx`（1） |
| SI-14 | **通过（本地夹具）／现场复核未执行** | 见 §二 |

**实测（2026-11-01 复跑）**：SI 侧 **8 个测试文件 / 142 条全绿**（`display-snapshot` / `display-revisions` / `display-invalidation` / `display-permission-runtime` / `display-rollback-races` / `display-refresh-notice` / `agent-list` / `catalog-loading`）。

## 二、SI-14 浏览器往返：本批做的第一件事是**把证据入库**

**原状**：SI-14 的原始输出只落在 `inbox/`（被 `.gitignore` 排除），收口后第三方无法复查。这与上一批 URL 驱动输入框收口时遇到的是**同一类问题**（那次的处置是入库一份逐字节一致的副本）。

**处置**：把该次运行的证据入库到
[`webui/scripts/evidence/2026-10-31-spec195-si14-roundtrip/`](../../webui/scripts/evidence/2026-10-31-spec195-si14-roundtrip/)，**8 个文件与工作区原件逐字节一致**（`cmp` 校验通过），并与 `inbox/spec195/si14/` 的另一份拷贝交叉校验一致。

| 文件 | 内容 |
|---|---|
| `summary.md` | 按 scenario × route × metric 的 n／P50／P95／max／failures 表 ＋ 预算表 |
| `results.json` / `samples.json` | 机读全量结果与计量样本聚合 |
| `raw/spec195-roundtrip.jsonl` | 逐样本原始记录（36 行） |
| `raw/playwright-spec195-roundtrip.json` | Playwright 原始报告 |
| `logs/playwright-spec195-roundtrip.log` | Playwright 运行日志（1 passed） |
| `logs/server-warm.log` | 夹具服务端预热日志 |
| `red-baseline-task1.txt` | **RED 基线**：未改实现上 **3 个文件 8 个用例失败**，用于证明用例不是空转 |

**独立复算（收口时重算，不引用旧结论）**：逐样本解析 `raw/spec195-roundtrip.jsonl` 共 **36 行**，减去 **5 行 `warmup:true`** = **31 个计量样本**；`ok:false` 计数 **0**，`busyResponses > 0` 计数 **0**。三条往返路径（`roundtrip-roles` / `roundtrip-catalog` / `roundtrip-audit`）各 n=10，另 1 次中途 overlay 编辑（`visibleMs 1.70` / `networkCompleteMs 5.40` / `networkRequests 1` / `busyResponses 0`）。**主体可见（`hubVisibleMs` / `partnerVisibleMs` / `backVisibleMs`）与网络完成（`networkCompleteMs` / `networkRequests`）分别记录**，未用控制命令墙钟冒充正式成绩。

### 三条必须连同结论一起读的边界

1. **harness 自评不是 Spec 通过**：`summary.md` 首行写的是 `acceptance: partial (smoke — not a Spec pass) · partial`，`behavior: null`。该工具的通用验收分类器**不认识** Spec 195 的 SI-14 判据，回落到 smoke 档。**「SI-14 通过」是按 Spec 自身判据判的，不是按工具 verdict 判的**——两者不冲突，但也不等价。
2. **运行时工作树是 dirty 的**：commit 记作 `af3dc785…（dirty）`。证据可复查，**运行不可逐字节复现**。
3. **现场实例复核未执行**：Spec §8.1 原文即记「通过（本地夹具）／现场复核未执行」，现场实例 `http://10.69.95.109:8276` 未部署新版本。按「闭口层级」，现场复核**不在本条出口**，不构成收口阻塞；**但不得据此宣称客户现场已修复**。

## 三、计数口径（写清楚，避免「去重」被读成「少做」）

一次外部 overlay 版本变更 = **1 次失效通知**（`bumpDisplayGeneration`）＋ **1 次派生重建**；同版本被 metadata 与 full digest 两类扫描先后或并发观察到时，仍为 **1 次失效、1 次重建**。

去重**只合并失效通知**，**不取消任何必要的重复读取**（metadata 扫描对签名变化的文件读取摘要），**也不取消写前／写后屏障的代次推进**。

## 四、残余

1. **现场实例复核未执行**——本条出口外的事，不在收口里，也不构成阻塞。
2. **harness 的通用 acceptance 分类器不认识 SI-14 判据**——工具侧改进项，不在本条范围。

## 五、不在本次收口里

- **镜像构建、部署、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级**——归发布取证层（该层目前 **0 份 Spec** 承载，见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md) §五）。
- **既有 `inbox/` 其余内容**——仅归档本条证据相关的 8 个文件，不整体入库。

## 六、复现命令

```bash
cd /Users/forrest/GitHub/project-lucy/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  server/__tests__/display-snapshot.test.ts \
  server/__tests__/display-revisions.test.ts \
  server/__tests__/display-invalidation.test.ts \
  server/__tests__/display-permission-runtime.test.ts \
  server/__tests__/display-rollback-races.test.ts \
  src/__tests__/display-refresh-notice.test.tsx \
  src/__tests__/agent-list.test.tsx \
  src/__tests__/catalog-loading.test.tsx
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。
