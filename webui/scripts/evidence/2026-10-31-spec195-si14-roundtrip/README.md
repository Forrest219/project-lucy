# Spec 195 SI-14 浏览器往返 —— 原始证据归档

| 项 | 内容 |
|---|---|
| 证据对象 | [`docs/specs/lucy-20261030-display-snapshot-invalidation-isolation-spec.md`](../../../../docs/specs/lucy-20261030-display-snapshot-invalidation-isolation-spec.md) §8 **SI-14**（本地匿名夹具的浏览器往返） |
| 产生脚本 | `webui/scripts/entry-performance.mts` ＋ `webui/tests/performance/spec195-display-roundtrip.spec.ts`（两者均已在库内，可复现） |
| 产生命令 | `npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario spec195-roundtrip --iterations 30 --warmup 5 --output inbox/webui-entry-perf/spec195-roundtrip-final2 --skip-build` |
| 产生时间 | 2026-10-31 01:28:29（baseline-2026-10-31T01-28-29-379Z，UTC+8） |
| 运行代码 | commit `af3dc785890c2ca59d246e48976a1b9c7a936f85`，**工作树 dirty** |
| 证据等级 | **本地匿名夹具 ＋ 生产构建 ＋ 桌面 Chromium**。**不是**客户环境，**不是**现场实例 |
| 归档原因 | 该命令的默认输出目录是 `inbox/webui-entry-perf/`，而 `inbox/` 被 `.gitignore` 排除。原始输出若只留在工作区，收口后第三方无法复查。本目录是该次运行的**入库副本**，7 个文件与工作区原件**逐字节一致**（`cmp` 校验通过），并与 `inbox/spec195/si14/` 的另一份拷贝交叉校验一致 |

## 文件

| 文件 | 内容 |
|---|---|
| `summary.md` | 人读汇总：按 scenario × route × metric 的 n／P50／P95／max／failures 表 ＋ 预算表 |
| `results.json` | 机读全量结果 |
| `samples.json` | 计量样本聚合 |
| `raw/spec195-roundtrip.jsonl` | **逐样本**原始记录（每行一次采样：`route` / `iteration` / `warmup` / `ok` / 6 项 metrics） |
| `raw/playwright-spec195-roundtrip.json` | Playwright 原始报告 |
| `logs/playwright-spec195-roundtrip.log` | Playwright 运行日志（1 passed） |
| `logs/server-warm.log` | 夹具服务端预热日志 |
| `red-baseline-task1.txt` | **RED 基线**：在未改实现（HEAD `87d2738b`）上运行新增用例的失败输出——**3 个文件 8 个用例失败**。用于证明这些用例**不是空转**（同一组用例在实现后全绿） |
| `delivery-report.md` | **实施交付报告**（2026-10-31）：相对开工基线的文件清单（新增 5／修改 17）、逐条验收结论、未做事项 |
| `baseline-git-status.txt` | 开工基线的工作区状态（115 行），用于核验实施范围 |

## 这次证明了什么

- **RED→GREEN 可核对**：`red-baseline-task1.txt` 记录在未改实现上 **3 个文件 8 个用例失败**（重复失效 D 由 1 变 2 次、外层 P 屏障 overlay-only 保存推进 P、全局校验 overlay 不可读时 Agent 也 503）。同一组用例在实现后全绿——**用例不是空转**。
- **计量样本 31 个，全部成功**：逐样本复算 `raw/spec195-roundtrip.jsonl` 共 36 行，减去 5 行 `warmup:true` = **31 个计量样本**，`ok:false` 计数 **0**，`busyResponses > 0` 计数 **0**。
- **三条往返路径各自 10 个样本 ＋ 1 次中途 overlay 编辑**：`roundtrip-roles`／`roundtrip-catalog`／`roundtrip-audit` 各 n=10；`roundtrip-overlay-edit` n=1，指标为 `visibleMs 1.70`／`networkCompleteMs 5.40`／`networkRequests 1`／`busyResponses 0`。
- **主体可见与网络完成分别记录**：每条路径都独立产出 `hubVisibleMs`／`partnerVisibleMs`／`backVisibleMs`／`networkCompleteMs`／`networkRequests`／`busyResponses` 六项，**没有**用控制命令墙钟冒充正式成绩。

## 这次**没有**证明什么（务必连同结论一起读）

1. **harness 自评不是 Spec 通过**：`summary.md` 首行写的是 `acceptance: partial (smoke — not a Spec pass) · partial`，`behavior: null`。该工具的通用验收分类器**不认识** Spec 195 的 SI-14 判据（无未解释 busy ＋ 主体可见与网络完成分别记录），因此回落到 smoke 档。**「SI-14 通过」是按 Spec 自身的判据判的，不是按工具的 verdict 判的**，两者不冲突但也不等价。
2. **运行时工作树是 dirty 的**：commit 记作 `af3dc785…（dirty）`，即该次运行混有未提交改动。这**不能**当作可复现基线；证据可复查，运行不可逐字节复现。
3. **现场实例复核未执行**：Spec §8.1 的 SI-14 行原文即记「通过（本地夹具）／现场复核未执行」。按 Spec 的「闭口层级」，现场实例复核**不在本条出口**；但这意味着**不能**据此声称客户现场已修复。

## 复现

```bash
cd /Users/forrest/GitHub/project-lucy
npm --prefix webui run build
npm --prefix webui run perf:entry -- \
  --phase baseline --mode production \
  --scenario spec195-roundtrip --iterations 30 --warmup 5 \
  --output inbox/webui-entry-perf/spec195-roundtrip-rerun --skip-build
```

> 归档不覆盖 `inbox/webui-entry-perf/spec195-roundtrip-final2/fixture-clean/`（3.1 MB 夹具临时数据，非证据），也不覆盖 `inbox/spec195/full-vitest-worktree.txt`（735 KB 全量测试日志，非本条出口证据）。

**关联**：[收口记录](../../../../docs/reviews/2026-11-01-display-snapshot-invalidation-isolation-closure.md)
