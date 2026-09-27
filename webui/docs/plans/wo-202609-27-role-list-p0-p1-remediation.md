# WO-202609-27：Role 列表 P0/P1 修复

| 元数据 | 内容 |
|---|---|
| 文档类型 | Plan |
| 日期 | 2026-09-27 |
| 状态 | Implemented |
| 权威契约 | [Spec 154](../154-role-list-p0-p1-remediation-spec.md) |

## 目标

修复 Role 快捷详情白屏，移除列表下方重复卡片，并将筛选区收敛为常驻搜索/状态与按需高级筛选，同时保持 API、权限模型、四张 KPI、表格列和编辑流程不变。

## 实施任务

| 优先级 | 任务 | 交付与验证 |
|---|---|---|
| P0 | 先用真实 API 解包结构补充 Drawer 成功用例，再修正查询类型 | 直接消费 `RoleDetailType`；成功用例由失败转通过 |
| P0 | 增加 Role 详情最小运行时校验与可恢复错误态 | 缺少必需数组时不抛异常；404、请求失败、关闭与完整页链接回归 |
| P0 | 迁移 warning 诊断到 Drawer | 中文诊断与原始技术详情均可查看 |
| P1 | 删除 `RoleCard` 与旧卡片容器 | Data Grid 为唯一 Role 集合；测试迁移到 `role-row-*` |
| P1 | 收敛行内操作 | 保留查看/编辑、基于此新建、删除；移除重复预览入口 |
| P1 | 实现高级筛选折叠与摘要 | 连接、MCP 工具、表名即时生效；ARIA、计数和折叠后摘要可验证 |
| P1 | 统一清除与空结果恢复 | 一次恢复全部默认值并关闭面板 |
| 治理 | 新增 Spec 154 并登记索引 | 明确修订 Spec 76/89、保留 Spec 103 |

## 测试驱动顺序

1. 在 `object-detail-drawer.test.tsx` 增加真实成功 payload 与 malformed payload，用现状失败证明 P0。
2. 修复 Drawer 后运行该文件，确认成功态、错误态和既有回归全部通过。
3. 将 `role-list.test.tsx` 从卡片选择器迁移到行选择器，增加唯一列表、高级筛选、清除与空态用例，用现状失败证明 P1。
4. 删除重复实现并收敛筛选，运行两份定向测试。
5. 运行完整测试、术语检查、IA 边界检查与生产构建。

## 验证命令

```bash
cd webui
npx vitest run src/__tests__/object-detail-drawer.test.tsx src/__tests__/role-list.test.tsx --maxWorkers=1
npm test
npm run lint:terminology
npm run lint:ia-boundary
npm run build
```

不执行浏览器、E2E 或移动窄屏验证；不覆盖工作区内并行的未提交修改。

## 交付记录

- 2026-09-27：P0 与 P1 已按测试先行顺序实现；两份定向测试 35/35 通过，术语检查、IA 边界检查与生产构建通过。
- 全量 `npm test` 首轮为 165/167 文件、1835/1837 用例通过，长时间运行后两个无关服务端用例发生测试池超时；隔离复跑 `wiki.test.ts` 36/36、`mcp-proxy-instructions.test.ts` 9/9 均通过，确认非本次 Role 变更回归。
