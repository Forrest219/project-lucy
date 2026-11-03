# L25-16 W-A 复核缺陷修复记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-10-30 |
| 基线 | Spec v1.4 / Plan v0.12；实现基线 `24c485ef` |
| 范围 | W-A（S1–S4）。不含 S5、S8、Docker 重建、推送或客户交付 |
| 复核 | 对照 Spec v1.4 的独立复核结论为 fail，5 条必须先修。本记录只说明这 5 条的修复和当次测试，**不把 VOPS-01–78 改为通过** |

## 修复

1. 创建或修改带 `allow.ops` 的角色必须是所有者。门禁不再只看 owner-only 工具，合并后的角色也要检查。
2. `instance_scope: read_only` 不能匹配写类控制面工具。角色保存和 `lint:spec` 同样拒绝这种 grant。
3. 连接表效果阶段按目标 id（`tables:<conn>` / `schema:<conn>:<schema>`）写入。非终态收尾保留本次执行写过的阶段，不再退回认领时的 `none`。
4. 源表恢复在没有写后摘要、且文件内容已经偏离预览基线时，判为不可判定，不再判成功。
5. `addSchema` 与 `removeConnection` 改为先取 `ktx.yaml` 写锁，再进显示写屏障。删除语义文件的连接删除同时取得发布窗口。连接探测仍在锁外。

## 当次测试

在 `webui/` 执行，全部通过：

- `server/ops/__tests__`、`server/__tests__/ops-mcp-wiring.test.ts`、`server/__tests__/project.add-schema.test.ts`：9 个文件、72 条
- `server/__tests__/project.remove-connection.test.ts`、`server/__tests__/ops-evidence-delete.test.ts`：2 个文件、17 条

这些是本地单测，不是 VOPS 矩阵的逐条取证。VOPS-01–78 仍全部未执行。
