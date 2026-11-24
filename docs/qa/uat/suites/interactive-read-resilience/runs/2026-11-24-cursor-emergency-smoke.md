# emergency-smoke 跑次 — 2c7d1493

| 元数据 | 内容 |
|---|---|
| 选择器 | emergency-smoke |
| 日期 | 2026-11-24 |
| 镜像 | `sha256:92227f0e76b2ea58b16f928a887c9aad0d1ef83a9eb7139ab3e0ca277ff2adb8` |
| gitSha | `2c7d1493992729f7b3399ddd47ec8e19ae17298f` |
| 判定 | **PASS（应急）** |
| 证据包 | `inbox/emergency-release-2c7d1493/` |
| 可见 Source | **1403**（对齐历史 KSCC 全局档；`gate0-visible-catalog-1403.json`） |

## 场景结果

| 场景 | 判定 |
|---|---|
| Gate 0 | PASS（含可见目录 1403 冻结） |
| S1 四页 | PASS |
| S2 启用表 | PASS |
| S3 MCP 暖态 | PASS（1403 重跑） |
| S4 混合压 | PASS（1403 重跑） |
| S5 撤权换代 | PASS（3 源档原跑；未因扩目录重跑） |

## 规模对齐说明

本卷物理 `uat:scale-baseline` 已过；MCP 可见范围原仅 3 Source。按历史 `install_mcp_scope` 挂载 `uat-wide-mysql`（1400 表＋1 Manifest／1400 overlay）并将 `demo_readonly` 改为 `catalog_bound` 后，`lucy_catalog`=1403。S3／S4 在该身份上重跑通过。

## Non-claim

本跑次 ≠ UAT-READ-RES-07／正式 G2 PASS；≠ P1-75 功能合同收口；≠ INDEX 套件收口；≠ 可上线。
