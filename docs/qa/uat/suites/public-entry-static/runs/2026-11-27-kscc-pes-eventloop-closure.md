# 跑次：2026-11-27 kscc P1-84 事件循环臂收口（UAT-PES-R0 缺口关闭）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-PUBLIC-ENTRY-STATIC` |
| 日期／Agent | 2026-11-27／Claude（kscc） |
| 环境 | 共享 demo `compose` 栈升级为 `project-lucy:uat-closure`（HEAD `8b8fb83c`，卷内 scale 水位保留＋MySQL 规模夹具重播）；`npm run uat:scale-baseline` 退出 0（Hive 2 项 SKIPPED 同基线口径）；WebUI `:55176`／MCP `:57881` |
| 判定 | **事件循环臂完整 ≥3 min 无干扰窗达标**（`UAT-PES-R0` 唯一未决项关闭；其余用例沿用 2026-11-26 最终臂证据） |

## 收口跑次（红灯窗：宿主独占，ququ dev server 暂停）

执行器：`scripts/uat/public-entry-static.mjs` 四进程并发（probe 210 s／display-arm 180 s／mcp-arm 180 s concurrency 3／login-probe 12 次）；账本与判定 `inbox/p184-uat/evidence-closure-20261127/`。

| 项 | 结果 | 预算 |
|---|---|---|
| 事件循环（完整 ≥3 min 窗） | **worstP99 47.8 ms／worstMax 265.2 ms／越限 0** | p99 ≤400／max ≤800 ✓ |
| `PUT /api/branding`（写屏障→展示失效） | 77 次，p50 260／p99 537 ms，0 失败 | ≤1000 ✓ |
| 其余路径 | 全 ok（`GET /`、branding、auth/status、livez、资产、登录、MCP 臂） | ✓ |
| judge | **PASS** | — |

臂构造与 2026-11-26 最终臂同构（生产重工作臂＋MCP 臂＋探测）；本轮未重跑浏览器臂（`UAT-PES-02/03` 浏览器证据沿用最终臂 45/45 `primaryReady` 等既有 PASS）。

## 无效跑次留证（如实登记）

同日两次预备跑次失败，均非产品原因，证据保留于同一 evidence 目录：

1. 第一次：管理会话 cookie 在开跑前过期，display-arm 全程 401（81,247 请求全拒），事件循环出现 2,178.9 ms 停顿——该轮**不作判定依据**；401 风暴与停顿的关联未深入归因（观察项，非本套件范围）。
2. 第二次：cookie 写入带双重 `lucy_admin_session=` 前缀，display-arm 全 401——**不作判定依据**。
3. 第三轮（本收口轮）凭据预检 200 后开跑，全绿。

## 环境注记

- 共享 demo 卷的 MySQL 规模夹具（`uat_scale_mysql` 1201 表＋`w_1000`）在早前 mysql 卷重建中丢失，本轮经 `seed-large-schema-fixtures.sh mysql` 重播；`seed-scale-access` 重跑发现其基座计数正则多算（写入 200/500、落盘 194/476），另以 `topup-access.mjs` 补齐至 200 角色／500 Agent／足凭据 500／token 1500，并经容器重启后策略全量重编译（此前 12 个 Agent 因 seed 生成器角色映射越界降级，补齐后清零）。
- 上述 access 夹具修复的完整脚本与备份（`access.yaml.bak-topup-20261127`／`.bak-fixrole-20261127`）在卷内与 `inbox/uat-closure-20261127/`。

## 边界与结论

- **UAT-PES-R0 缺口：关闭**（完整 ≥3 min 无干扰窗，预算全达）；套件总判定由 **FAIL（单一未决项）** 转为 **PASS**（必做用例证据＝2026-11-26 最终臂＋本收口轮事件循环臂）。
- 差集 D-1（审计列表读全表扫描）维持既有登记，归审计读事件循环族／P1-82 B1，不在本套件收口范围。
- **≠ 功能合同收口；≠ 可上线。**
