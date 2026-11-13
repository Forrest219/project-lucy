# 错题：访问关系图在部署侧几乎变成空桑基

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 标签 | `contract-stack` `data-trust` `viz-geometry` `empty-default` `ux-regression` `sev-high` |
| 环境 | 本机 demo `http://127.0.0.1:55176`（容器 `0.30.0`）；云端 `124.222.172.229:5174`（`0.30.0` / `36a82a3c`） |
| 相关 | [`lucy-20261105-access-map-confirmed-only-spec.md`](../specs/lucy-20261105-access-map-confirmed-only-spec.md)；[`lucy-20261105-access-map-usage-first-spec.md`](../specs/lucy-20261105-access-map-usage-first-spec.md)；提交 `556fdc30`、`80ff5bca`；页面 `/admin/access-map` |
| 状态 | `closed`（2026-11-13 功能合同收口；实现 `f3f88837`；[closure](../reviews/2026-11-13-access-map-sankey-empty-fix-closure.md)；demo 重建冒烟非本条出口） |

## 1. 症状与影响

- 打开「访问关系图」：列头「有问询 0」、提示无进入访问路径的允许调用；SVG 几乎只有闲置端点空心 stub，**没有** Agent→角色→连接→表的使用流带；闲置表不进画布。
- 观感＝桑基主视觉失效。本机与云端同构。
- 授权骨架 API 仍返回 `grantPaths`／dormant 边；问题在访问面计量被滤空 + 呈现不再画授权宽流带。

## 2. 复现要点

1. 管理员登录 → `/admin/access-map`（默认窗 168h）。
2. 即使把问询种类／访问等级改为「全部」，仍可出现 `meta.access.rawCalls = 0`、`counts.accessPaths = 0`。
3. 画布：`access-map-svg` 内几乎无使用流带 `path`，仅 idle stub + 细柱节点。

## 3. 根因

两层后期合同叠加（非单点 SVG 笔误）：

1. **`556fdc30` confirmed-only**  
   访问面 SQL 硬锁 `association_status = 'confirmed'`。  
   本机 audit 抽查：全库仅极少 `confirmed` 行（且为 `lucy_begin_question`、无 `access_log_sources`）；大量带表源的 `lucy_query`／`lucy_read_source` 为 `null`／`candidate`／`unassigned` → 被全部滤掉 → `rawCalls=0`。

2. **`80ff5bca` usage-first 几何**  
   流带厚度只跟 `accessPaths`；闲置授权不再画 grant 宽流带，只留端点 stub。  
   访问为 0 时，图面从「仍可读的授权桑基」变成「几乎空图」。

次要：默认筛「管理相关 + 排除连接」会进一步压空；但在「全部／全部」下仍为 0，说明主因是 confirmed 数据面 + usage-first 空态，而不只是默认筛。

## 4. 为何漏检

- 两条 Spec 各自自动化可绿；**组合后的部署空态**未进任一条的出口（usage-first／confirmed-only 均写明浏览器／部署不在本条出口）。
- 夹具多用已 `confirmed` 的行；未用「真实库里几乎没有 confirmed 查数」做门禁。
- 「本条收口不表示可上线」成立，但缺少跨合同的**空访问面视觉／API 冒烟**（本机＋云端打开即见流带或诚实降级骨架）。

## 5. 举一反三

1. **收紧数据口径（如只计 confirmed）前**，先量生产／demo 实库：目标状态下有多少行、带不带 sources；若趋近于 0，不得只靠夹具收口。
2. **改「空访问时还画不画骨架」** 属于用户可感知主视觉变更；usage-first 类改动必须单列空态验收（有授权无访问时图上仍可读，或明确降级文案 + 可操作下一步）。
3. **合同叠加**：后一条呈现合同依赖前一条访问面非空时，发布取证或错题门禁要跑「两合同同时生效」的部署打开路径。
4. **默认筛**若常把主路径滤成 0，空态文案必须一眼可读，且不得让人以为图坏了却无解释（本页有解释条，但仍不足以抵消空流带冲击）。
5. Agent／评审：改 `access-map` 关联或几何时，先读本错题；禁止只验夹具绿就宣称部署可读。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 修复计划／Spec | **已拍板并落地** | Plan v0.2；Spec [`lucy-20261113-access-map-sankey-empty-fix-spec.md`](../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md) |
| 归因：begin 后同会话 tools/call → confirmed | **已修** | `resolveToolCall` + mcp-proxy；SC-01–03 |
| 空态：闲置骨干连通带 | **已修** | `AccessMapCanvas` `layer=backbone`；SC-05–06 |
| 门禁：vitest | **通过** | turn-correlation + access-map 前端相关 116+；contract 术语失败为无关脏文件 |
| demo 重建冒烟 | **阻塞** | `demo:upgrade` apt 经 127.0.0.1:7890 拒绝；需网络恢复后再冒烟 |
| 历史行回填 confirmed | **不做** | 信任 Spec 禁止静默升级；新调用生效 |

## 7. 证据指针

- 本机 API（浏览器会话）：`GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all` → `access.rawCalls=0`，`counts.accessPaths=0`，`grantPaths>0`。
- 本机 DB：`/data/lucy/.ktx-ui/audit.sqlite` — `access_log` 有大量行；窗口内 `association_status` 无 `confirmed`；带 sources 的查数多为非 confirmed。
- 云端同参：`rawCalls=0`／`accessPaths=0`。
- 关键点：`webui/server/admin/access-map.ts`（`association_status = 'confirmed'`）；`webui/src/components/admin/AccessMapCanvas.tsx`（usage-first：仅 `accessPaths>0` 画流带）。
