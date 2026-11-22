# P1-53 四入口全真取证（X_REL）— 2026-11-22

| 元数据 | 内容 |
|---|---|
| 文档名称 | UAT-SUITE-MCP-UPGRADE-COMPATIBILITY P1-53 four-entrypoint X_REL |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | P1-53 Spec／Plan v1.1；委托人「收口 X_REL」；`inbox/p153-xrel-closure-20261122/`；先前 [candidate](2026-11-22-cursor-p153-certify-candidate.md) |
| 适用范围 | demo 四入口全真；**≠ 可上线／客户出包签字** |
| 输出位置 | docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md |

## 环境

- WebUI：`http://127.0.0.1:55176`；MCP：`http://127.0.0.1:57881/mcp`
- CompatConfigProfile：`sha256:957326482275fcc47a6c81e0462fa9085103af6b30fcaad5612297a80e733053`
- suiteDigest：`sha256:9725b9a4b1e69800e8c92f485cb193b91696ac13d8867bdda2af325c751578fc`
- Agent：`kimi-code-cli` 2.7.2；concurrency 3；`--budget-escape`；coverage full
- 私有基线：`inbox/p153-xrel-closure-20261122/private/mcp-compat-baseline.json`（mode **0600**；仓外／inbox tmp）

## 四入口结果

| 入口 | 判定 | 证据 |
|---|---|---|
| `certifyCandidate` | **PASS**（三维） | [candidate 跑次](2026-11-22-cursor-p153-certify-candidate.md)；JSON `results/mcp-compatibility-candidate.json` |
| `captureInstanceBaseline` | **PASS** | `capture.log`；baseline snapshotId `snap-895984504e1b` |
| `certifyInstanceUpgrade` | **PASS**（三维） | `mcp-compatibility-instance.json` phases.POST＝PASS |
| `replayInstanceBaseline`（ROLLBACK_VERIFY） | **PASS** | instance phases.ROLLBACK_VERIFY＝PASS |

零 `new deny`／零 `expected denial becoming allow`（candidate＋instance JSON）。

## INDEX／上线关系

INDEX 已为 **PASS**（candidate）；本跑次补齐实例／回滚相位。**≠ 可上线**；发布聚合器仍须匹配 digest／指纹／证据 kind。
