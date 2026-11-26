# UAT-SUITE-K8S-STOP-GRACE — Chart 停止宽限与 P1-63 预算对齐

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-K8S-STOP-GRACE` / v0.1-draft |
| 日期 | 2026-11-24 |
| 总账 / 合同 | **P1-85**／REQ-030-106 · [Spec](../../../../specs/lucy-20261124-k8s-stop-grace-spec.md) SC-01–SC-06 |
| 目标 | 验证 Chart 默认 60 秒、最低 45 秒与 `Recreate` 的静态合同，并在真实 K8s SIGTERM 下验证在途、审计守恒和纯 MCP 恢复 |
| 运行环境 | 静态：Helm＋stock bash／awk；正式：原生 amd64 单节点 K3s、隔离 namespace／PVC、真实 KTX／合成 MySQL、纯 MCP、P1-83 版本化注入器 |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md)。当前 **NOT RUN**；静态开发检查不是套件跑次 |
| 当前授权边界 | 仅套件设计；终稿未确权、开发未授权、测程未授权。OQ-1（旧 Chart 首升编排归属）待裁定；候选 Chart 落台前须先完成 P1-83 步骤 1⑥ 改前基线 |

## 来源与定位

Chart 未设置 `terminationGracePeriodSeconds`，K8s 默认 30 秒短于 P1-63 的 40 秒退出预算及 45 秒外部下限。Docker demo 的 `stop_grace_period: 45s` 与 P1-63 Docker 跑次只作相邻证据，不能替代本套件。

| 相邻合同 | 本套件如何分工 |
|---|---|
| P1-63 进程排空 | 不重写 20／40／45 秒预算，只验证 Chart 外部宽限与其配合 |
| P1-83 自愈／SC-09 | 复用其改前基线和注入器；回传 TERM、退出码、在途、审计水位、停机失败请求数，供 `preStop` 决策 |
| P1-52 升级可靠性 | OQ-1 若裁定首升归 P1-52，本套件只交接首升证据，不代签其完整矩阵 |
| P1-81 Docker 自愈 | 不用 Docker 跑次替代原生 amd64 K8s 证据 |

## 全真性与证据等级

1. **静态层**：`helm template`、H1 门禁和 `node:test` 验证字段、类型、层级和负控。输出只作开发证据，建议落 `inbox/p185-static-<日期>/`，不得单独把 INDEX 改为 PASS／PASS WITH GAP。
2. **正式层**：原生 amd64 单节点 K3s 上执行 R0／03–06；不得使用 Docker、本机 kind arm64 或 QEMU 代替。缺台、缺测程授权或缺 P1-83 基线时记 BLOCKED。
3. **真实信号**：`delete pod` 不传 `--grace-period`，不使用 `--force`；升级／回滚核对每个旧 Pod 的有效宽限，不以新 Deployment 的 60 秒代替旧 Pod 证据。
4. **真实在途**：使用真实数据库延迟查询和 P1-83 版本化外部注入，不在产品内新增 fault switch，不用 `sleep` 假装上游工作已受理。
5. **主路径**：每次替换后验证同卷管理读与无 WebUI Cookie 的纯 MCP 查询，结果对独立 SQL；只验 Pod Ready 不算恢复。
6. **审计**：对删除前已受理、尤其已返回成功请求的唯一 ID 集逐条核对恰好一次，`ledger_seq` 水位不回退；停机后被拒绝的新请求不得伪记成功，也不要求失败请求数为零。
7. **浏览器**：不适用；本条无 WebUI 可见面变化。

## 必做／条件必做

| 类型 | 用例 |
|---|---|
| 必做 | UAT-KSG-R0、01、02、03、04、05A、06 |
| 条件必做 | UAT-KSG-05B（旧 Chart 首升）：OQ-1 归 P1-85 时必做且必须通过；归 P1-52 时交接证据后可记 SKIPPED，但报告不得主张首升已由本条覆盖；未裁时 BLOCKED |

所有必做项通过才可登记 PASS。必做项失败、未执行或因环境无法全真执行时，分别记 FAIL／NOT RUN／BLOCKED；不得以静态通过写成 PASS WITH GAP。

## 改前／改后顺序

```text
现行 Chart＋镜像：P1-83 步骤 1⑥ 基线
  → 候选 Chart 静态检查（开发证据）
  → 候选 Chart 首次落台（必须晚于基线）
  → live spec → delete pod 两臂 → 合规升级／回滚 → 首升按 OQ-1
  → 证据交接与清理 → INDEX 登记
```

## 持续节奏

| 触发 | 必跑 |
|---|---|
| 改 values／Deployment Pod spec | 静态全套＋R0／03–06 |
| 改 H1 门禁或交付包脚本 | 静态全套＋包布局负控；影响渲染时再跑正式全套 |
| 改 P1-63 排空、entrypoint、supervisor | 静态＋R0／03–06＋P1-63 回归 |
| 改首升编排或 OQ-1 裁定 | 05A／05B 及关联管理读、纯 MCP、审计核对 |
| 改 P1-83 最长路径注入器 | R0／04／05A，必要时 05B |
