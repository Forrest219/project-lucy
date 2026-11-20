# 零绑定 begin：隐藏工具决议

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-20 |
| 对象 | P1-60／REQ-030-081；Spec／Plan／UAT |
| 决议 | 委托人批准：**可信 inactive 下隐藏 `lucy_begin_question`**；**预算、ACL 有待商议** |
| 边界 | 仅文档合同修订（升 v0.6-draft／UAT v0.4-draft）；**≠ 终稿确权；≠ 开发授权；未改运行代码** |

## 1. 批准内容

- 当前无表配置支持口径绑定的 YAML，begin 为超前冗余能力。
- inactive：`tools/list` 与 initialize／role-aware 指导 **不得**暴露 begin；默认问数＝N。
- 强制 `tools/call` begin → 工具不可用，不加载注册表、不写 BindingSession，不挡后续 query。
- 正式启用已发布绑定（参与态 active）后再露出工具。

## 2. 明确未批准／待商议

- **OQ-4**：不关闭问询预算；不放宽或改写 ACL／行权限。现行合同保持，直至另发商议结论。
- 本决议不构成开发授权或可上线。

## 3. 落盘

- Spec／Plan → v0.6-draft（D1／OQ-4）。
- UAT suite／cases／fixtures → v0.4-draft。
- 台账镜像同次更新。
