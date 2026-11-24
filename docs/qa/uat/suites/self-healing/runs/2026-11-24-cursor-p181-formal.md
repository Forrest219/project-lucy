# UAT-SUITE-SELF-HEAL 正式跑次 — 2026-11-24

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-81 假活自愈正式 UAT 跑次 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec v0.2／suite v0.2；证据 `inbox/p181-p182-uat-20261124/p181-artifacts/` |
| 适用范围 | 测试台判定；≠ 功能合同收口；≠ 可上线 |
| 输出位置 | `docs/qa/uat/suites/self-healing/runs/2026-11-24-cursor-p181-formal.md` |

## 候选

| 项 | 值 |
|---|---|
| 隔离容器 | `lucy-uat-p18182`（独立卷 `lucy-uat-p18182-data`，不碰 `compose-lucy-1`） |
| 镜像 | `project-lucy:demo` `sha256:a02367035c1a7fd6a2df89ad2f9df3e02442f607c3eeffd21ac64fd4ba40ce1a` |
| 运行时 gitSha | `479aca088587f2551be5a63ae218e60caf93bd78`（镜像内；`gitDirty=true`） |
| WebUI / MCP | `http://127.0.0.1:55286`／`http://127.0.0.1:57991/mcp` |
| 资源 | 2 CPU／2 GiB；`restart: on-failure` |
| 阈值 | W=60s，T_A=120s，T_B=180s（Spec 默认） |
| 规模 | 跑前对隔离实例执行 `uat:scale-baseline` → PASS（Hive SKIPPED） |
| 触发 | **C／MCP**：`sh -c 'kill -STOP <ktx-pid>'`（真实上游冻结；非桩） |

## 判定总表

| ID | 结果 | 证据要点 |
|---|---|---|
| UAT-HEAL-R0 | **PASS** | 假活窗口可构造：`stuck_detected` domain=mcp，持续 ≥W；探针在容器外 |
| UAT-HEAL-01 | **PASS** | 假活时 `readyz=503`，`/api/health.selfHeal.phase=stuck`，运维可见；非全绿 |
| UAT-HEAL-02 | **PASS** | 同实例原位恢复：`recovered detail=in_place`，`StartedAt` 不变，`restartDelta=0`；展示读与 `lucy_query`→1000 恢复（`case-inplace-result.json`） |
| UAT-HEAL-03 | **PASS** | 同候选另一次构造：原位多次失败后 `unhealthy`→`restart_requested`→Docker `RestartCount` 0→1；重启后业务恢复（`artifact-exit75-replace.json` + 事件 JSONL） |
| UAT-HEAL-04 | **PASS**（formal 当时 WITH GAP；[缺口补跑](2026-11-24-cursor-p181-gap-close.md) 四臂齐） | formal：短暂忙碌臂。补跑：CAV STD 30m／TERM／冷启动／brief 均 PASS |
| UAT-HEAL-05／06 | SKIPPED | 可选 |

## 浏览器

- 真实前台登录 `uat_runner` → `/overview` 与 `/catalog`（语义资产表列表可见）。
- API 对照：`/api/sources` 200，约 13 ms（与页面分列）。

## 套件结论

正式开跑当时为 **PASS WITH GAP**。缺口补跑后必做 R0／01–04 齐 → 测试台现值 **PASS**（见 [gap-close](2026-11-24-cursor-p181-gap-close.md)）。

不入核心分母；≠ 功能合同收口；≠ 可上线。

## 原始证据

- `inbox/p181-p182-uat-20261124/p181-artifacts/`（`case-inplace-*.json`、`artifact-exit75-replace.json`、`case-fp-*.json`、`runner.log`）
- 缺口补跑：`inbox/p181-p182-uat-20261124/gap-close/heal04-*.json`
- 容器内 `/data/lucy/.ktx-ui/self-heal-events.jsonl`
