# lucy-ops Manifest 升级自愈 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | lucy-ops Manifest 升级自愈 |
| 文档类型 | Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-11-04 |
| 状态 | **功能合同已收口（2026-11-04）**。H1–H5 本机自动化通过；H6 不在本条出口。本条收口不表示可上线 |
| 关联 | Spec 149；[可问治理面 Spec](lucy-20261101-ops-evidence-askable-governance-spec.md) D22 / SC-17a / SC-17e（v0.9.3 短修订） |
| 实施 Plan | [lucy-20261104-lucy-ops-manifest-upgrade-heal-plan.md](../plans/lucy-20261104-lucy-ops-manifest-upgrade-heal-plan.md) |
| 现象 | 升级后启用表范围页：`连接：lucy-ops · 已启用 · 本地无 Manifest` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿：stock digest 自动升级 + `enabled_tables` ⊆ Manifest；用户批准 |
| v0.2 | 实现落地：stock digest 白名单模块、`placeOpsEvidenceAsset` 增加 `upgraded`、ensure 重排为「视图 → 检查连接块 → 落资产 → 镜像 → 收敛 enabled_tables → 就绪判定」；可问治理面 Spec 短修订（SC-17e／D22）；旁路副本对齐当前模板。H6 未做 |

## 闭口层级

- 层级：功能合同
- 本条承诺：升级后官方历史版本的 `lucy-ops` Manifest／Skill／Wiki 自动升到当前模板；真定制资产仍保留并记冲突；ensure 之后 `lucy-ops.enabled_tables` ⊆ 本地 Manifest 物理表，冻结表不再出现「已启用 · 本地无 Manifest」；本条**不**改 `access.yaml` 资产／连接逻辑。正式 Role `lucy_ops_reader` 缺则写入的例外口径以 [`lucy-20261105-customer-default-system-roles-spec.md`](lucy-20261105-customer-default-system-roles-spec.md) 为准（旧「永不写 access.yaml」对该例外**已作废，不得当作现值**）
- 本条出口：H1–H5 的本机自动化断言（`webui/server/__tests__/ops-evidence-assets.test.ts`、`ops-evidence-connection.test.ts`、`ops-evidence-ensure-enabled-cap.test.ts`）
- 不在本条出口：H6（本机 demo 平滑升级冒烟，属基础设施操作，需人工／后续会话）；正式 Role 的 `tableSelectors` 扩权（SC-17c／D22，运营显式）；镜像与客户环境验收
- 上线关系：本条收口不表示可上线

## 1. 问题

`ensureOpsEvidence` 会把 `ktx.yaml` 的 `lucy-ops.enabled_tables` **union 扩到全部冻结表**（当前 13 张），但内容根资产复制规则是：目标已存在且与模板字节不同 → **不覆盖**（`OPS_EVIDENCE_ASSET_CONFLICT`）。

旧实例上的官方 W0 Manifest（仅 `ops_calls` / `ops_call_tables`）与新模板（W0∪W1∪W2）字节不同，被误判为「用户冲突」，Manifest 不升级；`enabled_tables` 却已扩满 → 启用表范围页出现无效启用。

本机复现：volume Manifest digest = `ed5f9f8b…`（2 表）；镜像模板 = `58a09d1b…`（13 表）；日志 `ASSET_CONFLICT` ×3（Manifest / Skill / Wiki）。

## 2. 目标

1. **官方旧版资产可自动升级**到当前模板，不要求运营手工改文件。
2. **真正被改过的资产**仍保留，记冲突，治理面可 `unready`（旧合同保留）。
3. **不变量**：`lucy-ops.enabled_tables` 中属于冻结集合的表名 ⊆ 当前有效 Manifest 物理表集合。升级后不得再出现冻结表的「已启用 · 本地无 Manifest」。
4. **本条仍不写 `access.yaml` 的资产／连接逻辑**（D22）。缺失正式 `lucy_ops_reader` 的缺则写入见 [`lucy-20261105-customer-default-system-roles-spec.md`](lucy-20261105-customer-default-system-roles-spec.md)。

## 3. 非目标

- 不自动扩正式 Role 的 `tableSelectors`（SC-17c / D22）。
- 不静默覆盖无法识别为官方历史版本的定制文件。
- 不改业务连接的 Manifest / enabled_tables 语义。

## 4. 方案（已批准）

### 4.1 官方历史 digest 白名单

为每个 ops-evidence 资产 id 维护 `OPS_EVIDENCE_STOCK_DIGESTS`：历史上曾随版本发布的**标准模板**内容 SHA-256。

`placeOpsEvidenceAsset` 决策：

| 磁盘状态 | 结果 |
|---|---|
| 不存在 | `copied`（写模板） |
| 字节 = 当前模板 | `unchanged` |
| digest ∈ 该资产历史 stock 列表 | `upgraded`（覆盖为当前模板） |
| 其他 | `conflict`（不写） |

首次登记至少包含当前现场旧版：

| 资产 id | 历史 stock digest（W0 / 旧 Skill / 旧 Wiki） |
|---|---|
| `semantic-layer/_schema` | `ed5f9f8b952950366fe563982e5c1ef98b127992195483a82552880cbac43ec4` |
| `skills/ops-questioning` | `03c43e7b258a9116cc48e73a60fa3d37d0bf41bff998fd9f5a9c4317d5fbd4a4` |
| `wiki/ops-questioning` | `a286bcda4a18f0f4af28691b7e4d75f4d9973d7bb22a86d9001235ecc3fff2fe` |

**维护规则**：此后每次改 `webui/config/ops-evidence/` 下对应模板，合入前必须把**改前**当前模板 digest 追加进该资产的 stock 列表；单测断言「当前模板 digest ∉ stock」。

### 4.2 enabled_tables 上限

ensure 顺序：

1. 重建视图  
2. 连接块存在性 / driver·path·readonly 冲突检查（冲突则整段中止）  
3. **先**放置 / 升级资产，并镜像到项目根  
4. **再**将 `enabled_tables` 写成 `OPS_EVIDENCE_ENABLED_TABLES ∩ Manifest.physicalTables`  
5. 就绪判定  

真冲突导致 Manifest 仍缺新表时：只启用 Manifest 已有冻结表；治理源按既有合同 `unready`；**ensure 自身不再制造孤儿启用**。

写入的 `enabled_tables` ＝（已有启用 ∩ Manifest 物理表）∪（冻结集合 ∩ Manifest 物理表）：既不新增 Manifest 之外的表，也不误删定制 Manifest 里已启用的自定义表。

### 4.3 仓库旁路副本

仓库根 / `config/` 下 `lucy-ops` 旁路副本不是 ensure 事实源（事实源是 `webui/config/ops-evidence/`），实施时应与当前模板对齐，避免人工复制再引入漂移。

### 4.4 核心流程（伪代码）

```text
ensureOpsEvidence(projectRoot):
  views ← rebuildViews()                       # 1

  block ← readConnectionBlock(projectRoot)
  if inspect(block).conflict:                 # 2 driver / path / readonly
    record(conflict); return                   #   此步不写 enabled_tables
  end if

  for asset in opsEvidenceAssetSpecs():        # 3 落资产
    place(asset):
      if not exists(dest):        copy template; outcome = copied
      else if bytes equal:                    outcome = unchanged
      else if sha256(dest) ∈ stock[asset.id]: copy template; outcome = upgraded
      else:                                  outcome = conflict   # 不写、不覆盖

  mirror ← syncContentToProjectRoot(...)      # 4 镜像
  if mirror.failed > 0: record(not_ready); return
  end if

  physical ← readManifestPhysicalTables(projectRoot)   # 5 项目根 Manifest
  enabled  ← (existing enabled ∩ physical) ∪ (FROZEN ∩ physical)
  writeConnectionBlock(enabled)                        #   不含 Manifest 的表被移出
  end if

  readiness ← readOpsEvidenceReadiness(...)     # 6 就绪判定
```

## 5. 验收

| ID | 断言 |
|---|---|
| H1 | 磁盘为 W0 stock Manifest → ensure 后 Manifest = 当前模板；`enabled_tables` = 全部冻结表 |
| H2 | 磁盘为定制 Manifest → 不覆盖；`enabled_tables` ⊆ Manifest 物理表；无冻结表孤儿 |
| H3 | 缺文件 → copied；`enabled_tables` 齐全 |
| H4 | 定制 Skill/Wiki → 仍 conflict；不影响 Manifest 已升级时的 enabled 上限 |
| H5 | 改模板时：当前 digest 不在 stock；改前 digest 已入 stock |
| H6 | 本机 demo **平滑升级**（保留 volume）后再进启用表范围：`lucy-ops` 无冻结表「已启用 · 本地无 Manifest」 |

## 6. 对可问治理面合同的修订要点

实施时在 [lucy-20261101-ops-evidence-askable-governance-spec.md](lucy-20261101-ops-evidence-askable-governance-spec.md) 落文：

- SC-17e：**官方历史 stock** 允许 `upgraded`；仅非 stock 字节差才 conflict。  
- 新增：ensure 后 `lucy-ops` 冻结 `enabled_tables` ⊆ Manifest 物理表。  
- D22「升级标准语义」明确包含 stock→current 覆盖；真冲突仍保留 + unready。
