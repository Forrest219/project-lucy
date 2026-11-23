# YAML 产物禁 alias 治理 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1 |
| 日期 / 产品线 | 2026-11-23 / 0.30.0（`lucy-v0.30`） |
| 功能编号 | P1-76／REQ-030-097 |
| 台账号 | 无 |
| 阶段 | S2 |
| 状态 | S2｜v0.1。终稿已确权（委托人 2026-11-23 明示）；开发未授权；待开发授权后按 Plan 实施。 |
| 授权边界 | 委托人已确权终稿（2026-11-23 明示）。实现、发布与客户环境变更另按仓库流程在开发授权后执行。 |
| 需求 / 验收 | [总账 P1-76](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [REQ-030-097](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-097yaml-产物禁-alias-治理) · 验收 SC-01–SC-05 |
| 配对计划 | [YAML 产物禁 alias 治理 Plan](../plans/lucy-20261123-yaml-alias-free-artifacts-plan.md) |

## 闭口层级

- 层级：功能合同
- 性质：工程约束／缺陷修复级加固（不改变任何用户可见行为）。
- 本条承诺：仓库内一切 YAML 产物（静态配置与生成器输出）不含 YAML anchor／alias；Lucy 服务端全部 YAML 写出口默认不产生 alias；新增静态门禁拦住回归。
- 本条出口：SC-01–SC-05 全部通过，证据为单测、静态门禁跑次与一次真实 KTX 对照验证。
- 不在本条出口：KTX 上游任何修改；读取侧 `maxAliasCount` 放宽；客户环境交付形态；其它序列化格式（JSON／TOML）。
- 上线关系：本条收口不表示可上线。

## 1. 根因与实证

2026-11-23，另一 Agent 合成 catalog manifest 时复用了列定义对象引用，`yaml.stringify` 将重复引用序列化为 anchor／alias（150 次复用 → 149 个 `*a1`）。KTX 以 `yaml` 解析器**默认 `maxAliasCount: 100`** 读取，直接报 `parse error: Excessive alias count indicates a resource exhaustion attack` 并拒绝读取该文件。

本仓容器内已实证（`compose-lucy-1`，KTX 随包 0.16.0）：

| 实验 | 结果 |
|---|---|
| 149 个别名的 `ktx.yaml` 跑 `ktx status` | `✗ ktx.yaml parse error: Excessive alias count indicates a resource exhaustion attack` |
| `stringify(doc, { aliasDuplicateObjects: false })` | 输出 0 个 anchor／alias，150 行 roundtrip 解析正常 |
| `parse(text, { maxAliasCount: N })` | 可读，但 KTX 为上游依赖，此路不可走（见 §4 边界） |

暴露面盘点：Lucy 服务端约 10 处 `yaml.stringify` 写盘点（access.yaml 写入 6 处、admins-store、roles／agents／tokens 提案等）均未设 `aliasDuplicateObjects: false`，目前只靠「配置均 spread 构建、无共享引用」的约定性安全，无强制防护。UAT 规模基线造数三件套（`seed-scale-*.mjs`）为字符串模板生成，天生免疫，无需整改。

## 2. 合同

- **C1 规范**：仓库内一切 YAML 产物——`config/semantic-layer/`、`customer-config/`、`examples/`、`webui/config/`、产品运行时写入的 `access.yaml` 等，以及一切生成器（含将来入库的合成 manifest 生成器）的输出——**禁止 YAML anchor／alias**（`&anchor`／`*alias`）。定义复用必须 inline 展开或按键引用，不得复用对象引用。读取侧不得放宽 `maxAliasCount`。
- **C2 统一写出口**：新增 Lucy 服务端统一 YAML 写封装（如 `webui/server/yaml-safe.ts`），`stringify` 默认 `aliasDuplicateObjects: false`（保留 `lineWidth: 0` 等既有选项语义）；替换全部直接 `stringify` 写盘点，并加单测守护。
- **C3 静态门禁**：新增「YAML 产物禁 alias」静态检查（`scripts/lint/` 下独立门禁或并入 `lint:spec-docs` 新规则）：扫描约定树内静态 YAML，出现 anchor／alias 语法即 FAIL；先跑存量基线（当前存量 0 命中）再挂 PR CI。生成器类由各自单测守输出。

## 3. 验收

| 编号 | 验收项 | 证据形态 |
|---|---|---|
| SC-01 | 共享引用对象经统一写出口序列化：输出零 anchor／alias；默认 `yaml.parse` 可读回且语义相等 | 新增单测 |
| SC-02 | 替换后的全部写盘点回归：access.yaml／admins 的 dryRun／确认写、并发版本冲突、读回一致；既有 webui 单测全绿 | 既有测试套件跑次 |
| SC-03 | 静态门禁：对注入 alias 的样例 YAML 判 FAIL；对存量全树零误报 | 门禁跑次记录 |
| SC-04 | 真实对照：>100 别名 manifest 被 KTX 拒识（对照组）、inline 版本被 KTX 正常读取（实验组），记录 `ktx status` 输出 | 一次性验证记录（inbox 或 reviews） |
| SC-05 | 文档与登记：本 Spec／Plan、总账、REQ、索引镜像同句；规范条文落入本文件 §2 C1；造数三件套在 Plan 中声明无别名风险 | 文档 diff |

## 4. 核心流程（伪代码）

```text
writeYamlArtifact(path, value, options):
  text = yaml.stringify(value, { lineWidth: 0, ...options, aliasDuplicateObjects: false })
  atomicWrite(path, text)                     # 既有写盘语义不变，仅序列化选项加固

lintYamlArtifacts(rootDirs):
  for each .yaml/.yml under rootDirs:
    for each line matching anchorOrAliasSyntax:
      fail(file, line)                        # anchor/alias 即 FAIL，存量基线须为 0 命中

verifyKtxReadable(path):
  run ktx status against project containing path
  reject on parse error                        # 对照验证：alias 文件拒识、inline 文件可读
```

实现选择（封装模块名、门禁挂接点）留待终稿评审后按 Plan 阶段 1–3 执行。

## 5. 边界（不做什么）



1. **不改 KTX 源码、不要求 KTX 放宽 `maxAliasCount`**——KTX 是上游依赖（`AGENTS.md` 边界），正确解法在写入侧与门禁侧。
2. 不引入 YAML merge key（`<<: *ref`）等其它复用语法，一律 inline。
3. 不改读取侧容错：Lucy 读 YAML 维持默认解析选项，不兜底 alias 文件——违规文件应在门禁层被拦。
4. 不扩展到 JSON／TOML／markdown-frontmatter（gray-matter 走独立库，另行排查，不进本条）。

## 6. 受影响画像

| 画像 | 影响 | 说明 |
|---|---|---|
| 问数方 | ＝ | 纯工程约束，无用户可见面变化 |
| 治理方 | ↑ | 新增明确规范＋静态门禁，生成器产出可预期性增强 |
| 运维方 | ＝ | access.yaml 写入行为不变（仅序列化选项加固） |
| 管理层 | ＝ | 无直接影响 |

无 `↓` 判定，无需补偿路径。

## 7. Terminology Compliance

This feature follows [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md).

New terms: 无。本条不新增产品概念，无用户可见文案。文中 anchor／alias／`maxAliasCount` 为工程术语，仅用于 Spec／Plan／单测，不进入 WebUI、API 错误、Toast 或测试断言的产品文案；如出现上述场景需遵守术语标准。
