# P0 问数六套件 UAT（方案 B）Implementation Plan

| 治理字段 | 内容 |
|---|---|
| 状态 | 执行进度以本文件原Task勾选和已有跑次为准；本次仅补齐文档形态，未复跑本计划业务验收，当前候选结果待验。 |
| 授权边界 | 仅本计划既有Task所列范围，原审批和禁止项见正文；本次文档治理修订不新增运行代码、提交、部署或发布授权。 |
| 验收 | 以本文件验收小节、Task通过标准及已链接证据为准；历史结果不代表当前候选已复测。 |

> **For agentic workers:** 本会话按委托人选定 **方案 B**（六个独立 Suite）内联执行。全真优先；禁止 vitest／CR 冒充 PASS。

**Goal:** 为 P0-1／P0-2／P0-3／P0-4／P0-5／P0-A 各挂一套客户场景 UAT，关闭 GAP-UAT-P0 的「无套件」缺口；本波尽量全真跑出 runs。

**Architecture:** 每套件目录含 `suite.md`／`cases.md`／`fixtures.md`／`runs/`。环境＝本机 demo Docker WebUI `:55176` + MCP Proxy `:57881`（Bearer 只经 env／进程，不写仓库）。勾连 INDEX、e2e-ledger、`check-e2e-ledger.mjs`、总账 Spec 列指针。

**Tech Stack:** docs/qa/uat 约定；MCP JSON-RPC；curl／node 探针；compose demo。

## Global Constraints

- 全真：真实 demo 容器／MCP／API；禁 CR／mock 冒充 PASS
- 凭据：只写路径或 env 名，不写密码／token 内容进仓库
- 跟进状态句：总账／Spec 头部不以本 UAT 改「功能合同已收口」；只加测试台指针
- ≠ 可上线

## Tasks

### Task 1: 落盘六套件骨架 + 勾连

- [x] 六套 `suite.md`／`cases.md`／`fixtures.md`
- [x] INDEX／e2e-ledger／CONVENTIONS／`check-e2e-ledger.mjs`／总账 Spec 列指针

### Task 2: 全真跑（按影响序）并写 runs

- [x] P0-3／1／A／4／5／2 Cursor demo MCP 跑次 `2026-11-13-cursor-docker-p0-qa.md`
- [x] 可选夹具债：CALIBER-02／EXPOSURE-02 **BLOCKED**（未降级）

### Task 3: 更新 INDEX 结果 + 关／降 GAP-UAT-P0 + lint

- [x] INDEX 六行结果；GAP-UAT-P0 降为夹具债；`npm run lint:e2e-ledger`

## 目标（治理补齐）

为P0-1/2/3/4/5/A建立六个独立UAT套件并登记真实跑次。

## 开工前置（治理补齐）

先验证demo健康、MCP鉴权及各fixtures可用；凭据只进进程。

## 验收（治理补齐）

核对Task 1–3的六套件、runs与INDEX；CALIBER-02/EXPOSURE-02夹具债按原记录保持BLOCKED。

## 完成定义（治理补齐）

六套件均有suite/cases/fixtures及可追runs，INDEX/e2e-ledger回链一致；无套件缺口与夹具债分开关闭。

## 风险（治理补齐）

禁止vitest/CR替代全真MCP；缺夹具不得改期望或降级成PASS。
