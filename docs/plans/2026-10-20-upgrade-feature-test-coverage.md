# 升级要点测试补齐与独立验证

用户于 2026-10-20 授权修订清单、补齐升级功能用例，并由 Claude Code 验证、Codex 复核。本计划落实该授权，不修改客户配置、生产数据或部署。

## 范围

覆盖客户说明中的 14 项：管理登录、多角色、启用表与管理员范围、Skill/Wiki 授权、删除引用保护、连接与监控界面、版本/升级/目录差异、离线评测、列类型发布校验、问询预算、中文 Wiki 检索、问询关联、审计失败闭锁、Athena 配置。

1. 保留当前已有改动，修复测试 mock 接线与浏览器源码守卫误报；不删除断言或缩小既有 required 分母。
2. 建立逐功能测试映射与 checklist，区分单元、真实 HTTP/MCP、真实浏览器、真实 Agent、目标部署；证据缺失不算 passed。
3. 补齐隔离合成实例可执行的正反例与桌面浏览器用例。真实 AWS、客户端或客户 amd64 K8s 场景显式记录依赖及 blocked，不用模拟成功替代。
4. 修订问询补绑、人工 GUI、旧 UAT 状态与预算阈值的旧口径；保留历史记录，更新冻结目录摘要时保持原有必测 ID。
5. Claude Code 独立运行测试、检查覆盖及结果；Codex 检查原始输出、失败原因和实际差异，再复跑受影响测试。

## 核心流程（伪代码）

```text
for each upgrade feature:
  resolve its executable positive and negative cases
  record required execution layers and environment dependencies
  run on a fresh isolated project; retain candidate identity and assertion results
  missing case, dependency, or result => blocked; failed assertion => failed
  only all required results passed => feature passed for that declared scope
review Claude's command exits and evidence; do not infer release approval from local tests
```

## 完成标准

- 每个升级点都有可执行用例、明确断言及 checklist 映射。
- 已发现的测试接线失败已修复并复验；新测试没有依赖真实私有配置。
- 本地验证与目标环境验收明确分开；没有测试代码/结构测试冒充真实功能验证。
- 保存 Claude Code 验证结果及 Codex 复核结论；真实环境阻塞项如实列明。

## Terminology Compliance

遵守 `webui/docs/00-product-terminology-standard.md`；无新增产品术语。
