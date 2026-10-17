# security-e2e 合成夹具

| 元数据 | 内容 |
|---|---|
| 文档名称 | security-e2e 合成夹具说明 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude（Cursor Builder，T10） |

Spec §6.2 的正式合成夹具。**全部数据为合成**：不得复制私有真实配置、生产数据，也不得从 `.ktx/secrets/` 取材。

| 路径 | 作用 |
|---|---|
| `project-template/` | 运行时内容根模板（`*.template` 由 `scripts/e2e/prepare-environment.mjs` 渲染） |
| `db/seed.sql` | 两个逻辑库（`lucy_e2e_fin` / `lucy_e2e_sales`，含同名 source `analytics.orders`）、只读账号、脱敏 VIEW |
| `gold/compute-gold.mjs` | 独立 gold 计算器：按 run seed 生成数据、INSERT 与 typed gold，仅隔离 checker 执行 |

## 内容要点

- finance / sales 两域；`finance_reader`（全行）、`finance_east`（East 行级）、`sales_reader`、`channel_only`、`discover_only`、`object_only`（同角色闭合与 discover/read 分离对照）。
- Agent：`e2e_finance`、`e2e_finance_east`、`e2e_sales`、`e2e_disabled`、`e2e_channel_only`、`e2e_discover_only`、`e2e_split_roles`、`e2e_legacy`；Token 为每 run 随机值，明文只落 `<runDir>/checker/secrets/`（0600），仓库中只有占位符。
- Wiki：授权角色文档、`['*']` 共享、无 ACL、`object_only` 专用与实例标记文档；Skill：published / draft / deprecated。
- 每 run 随机 canary（`CANARY-<标签>-<随机>`）；gold 与 seed 只在 `<runDir>/checker/`，不进入客户端工作目录。

## 使用

```bash
node scripts/e2e/prepare-environment.mjs --mode local --run-id local-20261018-0100
```

release 模式必须给出 `--candidate <identity.json> --profile scripts/e2e/profiles/customer-release.yaml`，见 `docs/runbooks/real-user-e2e.md`。
