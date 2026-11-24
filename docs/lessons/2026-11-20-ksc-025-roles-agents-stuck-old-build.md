# 2026-11-20-ksc-025-roles-agents-stuck-old-build

## 现象

KSC 实例（`10.69.95.109:8276`）`/admin/roles`、`/admin/agents` 页面严重卡顿：roles 页白屏约 58 秒，agents 页约 14 秒才出内容。用户侧体感"页面卡顿、阻塞"，与 0.30 开发期间收到的客户反馈一致。

## 实测证据（只读诊断，2026-11-20）

环境版本：**0.25.0／gitSha 6d2664b3（clean），约 2026-11-05 时点**——比 2026-11-18 客户回传的 3a9f0711 更旧，不含 P1-13（755fc706）、P1-42（f1436556）、**P1-58/59（af13b9d5）** 任何一项。

| 测量 | KSC 0.25.0 | 对照 demo 0.30.0（1fb73f72） |
|---|---|---|
| `GET /api/admin/roles`（53 roles） | **48–73 s**（冷/热一致；templates 排除后仍 48 s） | 463 roles：**68 ms** |
| 页面 /admin/roles ready（前台 headed） | **58,224 ms**（DOM 仅 1,617） | 463 行：161–184 ms |
| `GET /api/admin/agents?range=7d`（71 agents） | 731 ms，**4.8 MB/次** | 172 agents：72 ms（分区后） |
| `?view=roster` | **被忽略，返回同样 4.8 MB 全量（统计内嵌）** | roster 无统计负载 |
| `?range=14d/30d` stats 段 | 675/593 ms——**窗口无关**（全历史 lastUsed 排序） | 窗口聚合+全部历史最近使用分离（P1-58 D1） |
| `/api/admin/agents/statistics` | **404（端点不存在）** | 74 ms（5s 展示缓存） |
| 页面 /admin/agents ready | **13,989 ms**（API 0.7s + 4.8MB 解析渲染） | 172 agents：82–104 ms |
| 审计总量 | 49,350 行（7d=30d，全部历史在窗内） | — |

DOM 均很小（1.6k/2.4k）、无 longtask——**卡的不是渲染，是服务端 API 与 payload**。

## 根因

1. **roles 55 s 级**：0.25.0 角色列表每次请求全量重编译权限上下文（53 roles × 263 来源量级），无快照复用/单飞/批量列表（P1-13+P1-58 D2 的增量全部缺失）。
2. **agents 14 s 级**：每次进页拉 4.8 MB 全量（统计+时间线内嵌，71 agents），统计段对全部历史做最近使用排序且与窗口无关（P1-58 D1 的问题原型）；无 roster/statistics 分区（D4/D5）、无统计缓存。
3. 结论：**该环境的卡 = 旧版本质，非新代码回归**。0.30.0 的 P1-58/59 正是针对此问题设计，demo 全量验证有效（55,000 ms → 68 ms，约 800×）。

## 处置

- 升级路径：KSC 实例升至含 `af13b9d5` 的 0.30.0+ 构建后复测本页（按 P1-58 SC-11 口径）。同症状已有两处版本根因：客户 `3a9f0711`（缺 P1-58，见 [roles-lag-p113-claimed-fixed-still-slow](2026-11-20-roles-lag-p113-claimed-fixed-still-slow.md)）与本处 `6d2664b3`（缺 P1-13+P1-58）。
- 2026-11-19 网关 502/503 事件（inbox 20261119 记录）与本服测无关——本服测期间 API 全部 200 可达、仅慢；但升级时仍应按 P1-13 发布取证基线复测。
- 诊断脚本与原始数据：`inbox/ksc-env-probe-2026-11-20.json`、`/tmp/ksc-page-probe.mjs`（本会话）。

## 教训

1. **版本指纹先行**：性能类投诉先取 `/api/health` 的 gitSha 对照优化落点，再谈根因；同一"页面卡"症状在 6d2664b3 与 1fb73f72 上是完全不同的故事。
2. **server-timing 分列**：旧版 roles 只有 total 一段，分区计时（access/permissions/stats）本身就是 P1-58 D3 的诊断价值——没有分段时只能靠外推。
3. **大 payload 也是性能负债**：4.8 MB/请求 × 每次进页，在 LAN 上也是秒级体验；分区 API（roster/statistics）减负与算法优化同等重要。
