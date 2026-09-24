# WO-202609-24：WebUI 管理 Skill 文件

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202609-24：WebUI 管理 Skill 文件 |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-24 |
| 撰写人 | Composer |
| 委托人 | xingchen |
| 基于材料 | Spec 147；批准 T1–T7 |
| 适用范围 | 实现与静态验收；Demo 浏览器验收另开 |
| 输出位置 | `webui/docs/plans/wo-202609-24-skill-file-management.md` |

| 字段 | 内容 |
|---|---|
| 状态 | Active |
| 权威契约 | [Spec 147](../147-skill-file-management-spec.md) |

## 任务

| 任务 | 内容 | 验证 |
|---|---|---|
| T1 | 构建前复制仓库 `skills/` → demo 模板；客户镜像仍空 | SC-147-01 |
| T2 | `POST /api/skills` 新建 | SC-147-02 |
| T3 | `PUT /api/skills/:domain/:name` 更新 / 改名 | SC-147-03 |
| T4 | 状态下拉写 frontmatter `status` | SC-147-05 |
| T5 | `DELETE /api/skills/:domain/:name` | SC-147-04 |
| T6 | 保存前校验；已发布无 eval 可保存 | SC-147-06 |
| T7 | demo_readonly 工具 + 幂等补丁 | SC-147-07 |
| 收口 | 术语检查 + vitest | SC-147-08 |

## 退出门槛

SC-147-01 至 SC-147-08 全过。之后再做 `npm run demo:upgrade` 与浏览器验证。
