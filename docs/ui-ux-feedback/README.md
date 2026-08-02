# UI/UX Feedback Ledger

本目录用于长期记录 WebUI 页面级 UI/UX 反馈，作为后续浏览器核查、回归检查和修复验收的稳定事实源。

## 目录结构

```text
docs/ui-ux-feedback/
  README.md
  pages/
    connections.md
  assets/
    connections/
      UX-CONNECTIONS-001.png
```

## 使用规则

- 每个页面维护一个文档，放在 `pages/` 下。
- 每条反馈使用稳定 ID：`UX-<PAGE>-NNN`，例如 `UX-CONNECTIONS-001`。
- 新反馈只追加，不覆盖历史；若问题复现，用同一个 ID 更新状态和补充证据。
- 每条反馈必须包含 `Status`、`Route`、`Feedback`、`Expected`、`Browser Check`。
- 修复代码后将 `Status` 更新为 `Fixed`；浏览器复核通过后再更新为 `Verified`。
- 截图放在 `assets/<page>/`，文件名尽量和反馈 ID 对齐。
- 浏览器检测应优先读取对应条目的 `Browser Check`，不要依赖聊天记录回忆。

## Status

| Status | 含义 |
|---|---|
| `Open` | 已确认或待确认的问题，尚未修复 |
| `Fixed` | 已有代码修复，但尚未完成浏览器复核 |
| `Verified` | 已通过浏览器或人工验收复核 |
| `Won't Fix` | 经确认不修复，需在 Notes 说明原因 |

## 条目模板

```md
## UX-CONNECTIONS-001: 表格统计列对齐不一致

Status: Open
Route: /connections
Area: Connection card schema table
Severity: P2
Reported: 2026-08-02

### Feedback
用户原始反馈或问题摘要。

### Evidence
- Screenshot: ../assets/connections/UX-CONNECTIONS-001.png

### Expected
期望体验和验收口径。

### Browser Check
1. Open `/connections`.
2. Locate the affected area.
3. Verify the expected behavior.

### Notes
实现备注、PR、残余风险或待复核事项。
```
