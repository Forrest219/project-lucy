# 共享开发 QA 基准线（三机对齐）Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v1.1** / 2026-11-01 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P2**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261101-shared-dev-qa-baseline-spec.md`](../specs/lucy-20261101-shared-dev-qa-baseline-spec.md)（**v1.1**） |
| 状态 | **v1.1 基线落地闭口（Mac mini／2026-11-01）**。S0–S2 完成；S3 其余两机未完成。本条收口不表示可上线 |
| 授权边界 | **已授权落地 S1–S2（2026-11-01）**。仍未授权：改发布 gate、对 RDS DDL／DML、`git commit`／`push`（除非另授权）、宣称三机对齐 |
| 验收 | 文档定稿看 Spec §7.1 SC-D01–SC-D08；落地看 §7.3；各机看 §7.4。不得用「全部 SC」混验 |
| 实施主体 | 文档与私有开发资产约定；外部权威 `9-演示环境配置` |
| 审阅记录 | [`docs/reviews/2026-11-01-codex-review-shared-dev-qa-baseline.md`](../reviews/2026-11-01-codex-review-shared-dev-qa-baseline.md) |

---

## 1. 目标

1. 定稿 A／B／C 分层合同（S0）。
2. 定稿后抽出 B 层 Manifest 正本（坚果云）与 runbook（S1）。
3. 在 Mac mini 权威机套用并跑 B 必选冒烟（S2）。
4. 其余两机按机套用记账（S3）；未完成不得宣称三机对齐。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec／Plan 经 Codex 第 3 轮可定稿（SC-D08 + 审阅） | **满足**（2026-11-01） |
| P2 | 可读 `9-演示环境配置` 与仓库 `evals/superstore` | 已具备 |
| P3 | 落地前：只读密码可写入本机 `.ktx/secrets/mysql-aliyun-password`（0600） | **满足**（已写入，内容不入库） |
| P4 | 用户明确授权改本机连接／私有语义后才开 S1–S2 | **满足**（2026-11-01 授权落地） |

## 3. 文件落点

### 3.1 预计修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `docs/specs/lucy-20261101-shared-dev-qa-baseline-spec.md` | 合同；定稿升版 | S0 |
| `docs/plans/lucy-20261101-shared-dev-qa-baseline-plan.md` | 本文件 | S0 |
| `docs/README.md`、`docs/plans/README.md` | 索引状态行 | S0／定稿后 |
| `docs/reviews/2026-11-01-codex-review-shared-dev-qa-baseline.md` | Codex 审阅 | S0 |
| `docs/runbooks/shared-dev-qa-baseline.md` | **S1 必选**；指向 Manifest 正本 | S1 |
| 坚果云正本 `…/9-演示环境配置/lucy-mcp/07-共享开发B层/MANIFEST.md` | B 白名单 + sha256 + 冒烟指针 | S1 |
| `inbox/shared-dev-qa-baseline/` | 仅工作副本与过程证据（可删） | S1–S3 |

### 3.2 不改

- `webui/src/**`、默认发布 gate 脚本、Helm／镜像、RDS DDL／灌数。
- 整包提交 C 层私有资产进 git。

## 4. 分阶段实施

### S0 文档定稿（本回合 · 已完成）

1. 按 R1–R7／R6／N1／N2 修订 Spec／Plan 至可定稿。
2. `npm run lint:spec-docs`；**另**确认本对文件输出无 WARN／无 fail／无新增豁免（SC-D08）— 已通过。
3. Codex 第 3 轮只读审阅结论为可定稿；状态改为「v1.0 审阅定稿」。
4. 更新索引行与审阅记录第 3 轮结论。

**出口**：SC-D01–SC-D08。**不**执行 SC-L*／SC-M*。

### S1 抽出 B 层 Manifest 正本（定稿且用户授权后）

1. 自 `lucy-mcp/02-连接草稿` **裁剪** enabled_tables → 仅 B 必选三表；可选 chatbi 默认关。
2. **禁止** `cp -R` 整个 `04-语义层`／`05-Wiki与Eval`。
3. Superstore 语义来源：权威导出 → 否则 `demo-mysql` 适配；标注 `source`；不得用 asset_finance／poc_zhio 包。
4. 写白名单（每文件相对路径 + sha256）；列 C 排除；写拒收反例检查步骤。
5. 正本写入坚果云 `07-共享开发B层/MANIFEST.md`；inbox 只放副本。
6. 新建 `docs/runbooks/shared-dev-qa-baseline.md` 指向正本。

**出口**：SC-L01–SC-L04、SC-L07。

### S2 权威机（Mac mini）套用

1. 合并规则写入 `ktx.yaml`（默认 `mode=merge`；首装可用 `reset-to-b-only`）。
2. 同步白名单资产 → **复核目标树 sha256** → 清理／隔离管理 glob 下未登记遗留 B 文件 → `admin reindex` → §7.2 必选步骤 1–6（步骤 7 推荐）。
3. 证据副本进 `inbox/`；不写密码。

**出口**：SC-L05–SC-L06、SC-L08–SC-L10。**此即「基线落地闭口」**，仍不是三机完成。

### S3 其余两机（按机）

1. 拉取正本同版本 Manifest + 白名单包；本机自建 secrets。
2. Align（默认 merge；保留 `b_optional_retained`／`tier_c_additions` 按 Spec §4.4）；目标哈希与遗留检查；跑 §7.2 必选 1–6；记录 SC-M01–SC-M03。
3. 需要演示时追加 `tier_c_additions`；比较仍只看 B 必选投影。

**出口**：每机各自的 SC-M*；全部完成前索引／对外表述不得写「三机已对齐」。

### S4 边界加固（可选，不阻塞落地闭口）

- 演示目录 README 增加一行交叉引用仓库 Spec（须用户确认改坚果云）。
- 内部 checklist 提醒「发布 gate 另批」。

## 5. 验收

| 档 | 看什么 | 何时 |
|---|---|---|
| 文档定稿 | Spec §7.1 SC-D* | S0 结束 |
| 基线落地闭口 | Spec §7.3 SC-L* | S1–S2 结束 |
| 各机套用 | Spec §7.4 SC-M* | 每机 S3 |

B 必选冒烟命令与失败判据以 Spec §7.2 为准（本 Plan 不另起命令表，避免双真相）。

### 完成定义

- **文档定稿完成**：SC-D* 全绿 + Codex 可定稿结论落盘。
- **基线落地闭口完成**：SC-L* 全绿（权威机）。
- **三机对齐完成**：三台均 SC-M* 全绿（可分日完成）。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 未定稿先改连接 | 授权边界；P4 |
| 整包拷贝 | S1 禁止；SC-L02–L03 |
| 正本进 inbox | Spec §4.6 |
| 用错 eval 端口 | Spec §7.2 |
| 宣称三机完成但只做了 Mac mini | 完成定义三档 |

## 7. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-11-01 | 初稿 |
| v0.2 | 2026-11-01 | 对齐 Spec v0.2；拆 S0／落地／各机验收；正本改坚果云；runbook 改 S1 必选 |
| v0.3 | 2026-11-01 | 对齐 Spec v0.3：retained 可选表、目标哈希／遗留检查、步骤 7 推荐 |
| v1.0 | 2026-11-01 | Codex 第 3 轮可定稿；S0 完成；S1+ 另授权 |
| v1.1 | 2026-11-01 | S1–S2 落地：Manifest 正本、runbook、Mac mini 冒烟 §7.2 全绿；S3 待办 |
