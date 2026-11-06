# lucy-ops Manifest 升级自愈 Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | v0.2 / 2026-11-04 |
| 主 Spec | [lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md](../specs/lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md) |
| 上游合同 | Spec 149；[可问治理面](../specs/lucy-20261101-ops-evidence-askable-governance-spec.md) D22 / SC-17e（v0.9.3 短修订） |
| 状态 | **功能合同已收口（2026-11-04）**。H1–H5 本机自动化通过；H6 不在本条出口。本条收口不表示可上线 |
| 授权边界 | 可改 `webui/server/ops-evidence/**`、相关测试、旁路语义副本、可问治理面 Spec 短修订；不写 `access.yaml`；未另授不 commit；**禁止基础设施变更**（docker compose / demo:upgrade / 重建容器 / 改 CI） |
| 验收 | 见「验收对照」与 Spec §5 的 H1–H5；H6 不在本次会话出口 |

## 目标

升级后自动把官方旧版 `lucy-ops` Manifest／Skill／Wiki 升到当前模板，并保证 `enabled_tables` 永不超出有效 Manifest，消除「已启用 · 本地无 Manifest」。

**Architecture:** `placeOpsEvidenceAsset` 增加 stock-digest → `upgraded`；ensure 改为先落资产并镜像，再按 Manifest 交集写入 `enabled_tables`；单测 + demo 平滑升级冒烟锁回归。

## 开工前置

- 主 Spec 已批准（方案 A + `enabled_tables` 上限）。
- 事实源模板目录：`webui/config/ops-evidence/`（不是仓库根旁路副本）。
- 历史官方模板字节已有可复现的来源（本机现场 W0 Manifest / 旧 Skill / 旧 Wiki），作为测试夹具固化在 `webui/server/__tests__/fixtures/ops-evidence/`。
- 只用 Node 内置 crypto 计算摘要；不新增 npm／第三方依赖。
- 不写 `access.yaml`；不碰 Role／Agent／控制面 `lucy_ops_*`／业务连接 Manifest。

## Global Constraints

- 不写 `access.yaml`（D22）。
- 真定制资产仍不覆盖。
- 平滑升级必须保留 volume 自愈，不得依赖 `--fresh`。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`。

## File Map

| File | Responsibility |
|---|---|
| `docs/specs/lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md` | 本功能 Spec |
| `webui/server/ops-evidence/stock-digests.ts` | 历史官方模板 SHA-256 白名单 |
| `webui/server/ops-evidence/assets.ts` | `placeOpsEvidenceAsset` 增加 `upgraded` |
| `webui/server/ops-evidence/connection-block.ts` | `plan` / `sync` enabled_tables ⊆ Manifest |
| `webui/server/ops-evidence/ensure.ts` | 重排：资产 → mirror → sync enabled |
| `webui/server/__tests__/ops-evidence-assets.test.ts` | stock 升级 / 真冲突 |
| `webui/server/__tests__/ops-evidence-ensure-enabled-cap.test.ts` | ensure 后 enabled ⊆ Manifest |
| `docs/specs/lucy-20261101-ops-evidence-askable-governance-spec.md` | SC-17e / 新不变量短修订 |
| `semantic-layer/lucy-ops/**`、`config/semantic-layer/lucy-ops/**`（及 skills/wiki 旁路） | 与 `webui/config/ops-evidence/` 对齐 |

---

### Task 1: Stock digest 模块

**Files:**
- Create: `webui/server/ops-evidence/stock-digests.ts`
- Test: `webui/server/__tests__/ops-evidence-assets.test.ts`

**产出：**
- `OPS_EVIDENCE_STOCK_DIGESTS`
- `sha256Hex(buf: Buffer): string`
- `isOpsEvidenceStockDigest(assetId: string, digestHex: string): boolean`

- [x] 单测：识别 W0 Manifest digest `ed5f9f8b952950366fe563982e5c1ef98b127992195483a82552880cbac43ec4`；当前模板 digest ∉ stock（遍历 `opsEvidenceAssetSpecs()`）
- [x] 实现模块，初始 stock：

| 资产 id | digest |
|---|---|
| `semantic-layer/_schema` | `ed5f9f8b952950366fe563982e5c1ef98b127992195483a82552880cbac43ec4` |
| `skills/ops-questioning` | `03c43e7b258a9116cc48e73a60fa3d37d0bf41bff998fd9f5a9c4317d5fbd4a4` |
| `wiki/ops-questioning` | `a286bcda4a18f0f4af28691b7e4d75f4d9973d7bb22a86d9001235ecc3fff2fe` |

Run: `cd webui && npx vitest run server/__tests__/ops-evidence-assets.test.ts -t "stock digests"`

---

### Task 2: `placeOpsEvidenceAsset` 支持 `upgraded`

**Files:**
- Modify: `webui/server/ops-evidence/assets.ts`
- Test: `webui/server/__tests__/ops-evidence-assets.test.ts`

- [x] `OpsEvidenceAssetOutcome` 增加 `"upgraded"`
- [x] 字节不同且 digest ∈ stock → 覆盖模板，返回 `upgraded`
- [x] 非 stock 定制 → 仍 `conflict`，文件不变
- [x] 夹具：仓库现有 W0 字节固化到 `webui/server/__tests__/fixtures/ops-evidence/`（Task 5 会把旁路副本对齐到当前模板，夹具不能依赖旁路）

Run: `cd webui && npx vitest run server/__tests__/ops-evidence-assets.test.ts`

---

### Task 3: enabled_tables ∩ Manifest

**Files:**
- Modify: `webui/server/ops-evidence/connection-block.ts`
- Create: `webui/server/__tests__/ops-evidence-ensure-enabled-cap.test.ts`

- [x] `planOpsEvidenceEnabledTables(manifestPhysicalTables) → OPS_EVIDENCE_ENABLED_TABLES.filter(in set)`
- [x] `syncOpsEvidenceEnabledTables(projectRoot, physicalTables)`：driver/path/readonly 冲突则跳过；否则写入 plan 结果（含首次插入）
- [x] **停用**无 Manifest 约束的盲目 `unionEnabledTables` 扩表作为 ensure 主路径（`unionEnabledTables` 已删除；`ensureOpsEvidenceConnectionBlock` 的 `manifestPhysicalTables` 改为**必填**，类型层面杜绝无上限扩表）

---

### Task 4: 重排 `ensureOpsEvidence`

**Files:**
- Modify: `webui/server/ops-evidence/ensure.ts`
- Test: `webui/server/__tests__/ops-evidence-ensure-enabled-cap.test.ts`；必要时改 `ops-evidence-connection.test.ts`

**顺序：**

1. views  
2. inspect connection（driver/path/readonly；冲突则中止；**此步不写 enabled**）  
3. place assets（含 `upgraded`）  
4. mirror（失败 → not_ready）  
5. sync enabled_tables（读**项目根** Manifest physicalTables）  
6. readiness  

- [x] H1：stock W0 → Manifest=当前模板；enabled=全部冻结表；schema/skill/wiki 非 conflict  
- [x] H2：定制 Manifest → conflict；enabled ⊆ Manifest；ktx 无 Manifest 外冻结表  

```bash
cd webui && npx vitest run \
  server/__tests__/ops-evidence-assets.test.ts \
  server/__tests__/ops-evidence-connection.test.ts \
  server/__tests__/ops-evidence-ensure-enabled-cap.test.ts
```

---

### Task 5: 上游 Spec 短修订 + 旁路对齐

- [x] 修订可问治理面 Spec：SC-17e stock→`upgraded`；ensure 后冻结 enabled ⊆ Manifest；changelog 链到本 Spec  
- [x] 以 `webui/config/ops-evidence/` 为源，对齐 `semantic-layer/lucy-ops`、`config/semantic-layer/lucy-ops` 及对应 skills/wiki 旁路  

---

### Task 6: 本机 demo 平滑升级（H6）

```bash
BUILDPLATFORM=linux/arm64 npm run demo:upgrade
```

**本次会话未执行**（授权边界禁止基础设施变更：docker compose / `demo:upgrade` / 重建容器 / 改 CI）。留给人工／后续会话。

- [ ] 容器内 Manifest digest = 当前模板；`enabled_tables` = 全部冻结表；日志无 schema `ASSET_CONFLICT`（或为 `upgraded`）  
- [ ] WebUI `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}` → 启用表范围 → `lucy-ops` 无冻结表「已启用 · 本地无 Manifest」  

---

## 完成定义

- Task 1–5 全部落地，各任务有对应 Vitest 绿。
- `cd webui && npx vitest run server/__tests__/ops-evidence-assets.test.ts server/__tests__/ops-evidence-connection.test.ts server/__tests__/ops-evidence-ensure-enabled-cap.test.ts` 全绿。
- 可问治理面 Spec 短修订落文并通过 `lint:spec-docs`。
- 不 commit、不 push；Task 6（H6）明确跳过并写明原因。

## 风险

- **H6 未验证**：本机 demo 平滑升级的真实链路（保留 volume → ensure 自愈 → WebUI 启用表范围页）本会话未跑，须人工补一次；本机自动化断言只覆盖到 `ensureOpsEvidence` 的函数级行为。
- **stock 白名单是白名单**：只登记了本机现场遇到的三个历史官方版本。其它历史版本的旧实例仍会走 conflict 路径（保留原文件 + 记冲突 + 治理源 unready），不会误覆盖。
- **stock 列表的维护纪律**：此后每次改 `webui/config/ops-evidence/` 下的模板，必须把改前的当前模板 digest 追加进对应资产的 stock 列表，否则旧实例升级会退回 conflict。单测只保证「当前模板 digest ∉ stock」，不会自动补登记。
- **`enabled_tables` 收敛会移出 Manifest 之外的表名**：这是本条的目标（消除孤儿启用），但确实会收窄一个此前生效的启用范围；定制 Manifest 里的自定义表不受影响（保留）。
- **Manifest 读不到时会写空启用范围**：没有本地 Manifest 就没有可启用的表；这与 WebUI「本地无 Manifest」的判定一致，但会让连接在 Manifest 缺失期间不可查。

---

## 验收对照

| Spec | 任务 |
|---|---|
| H1 | Task 2 + 4 |
| H2 | Task 3 + 4 |
| H3 | 既有测 + Task 4 |
| H4 | Task 2 |
| H5 | Task 1 |
| H6 | Task 6 |
