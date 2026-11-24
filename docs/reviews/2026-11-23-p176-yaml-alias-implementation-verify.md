# P1-76 实现与验收记录（YAML 产物禁 alias 治理）

| 元数据 | 内容 |
|---|---|
| 清单 | P1-76／REQ-030-097 |
| 日期 | 2026-11-23 |
| 状态 | S4｜v0.1。实现已落地；SC-01–SC-04 已验证、SC-05 随登记闭环；待委托人验收，未做功能合同收口 |
| 提交 | `29105bba`（实现）、`dadd207c`（S4 登记）、`6f99fd0f`（S3 开发授权）、`b46f753f`（入池）、`dbb2a2af`（S2 终稿确权） |
| 根因 | `yaml.stringify` 对共享对象引用去重产出 anchor/alias；KTX 以 `yaml` 解析器默认 `maxAliasCount: 100` 读取，超限报 `Excessive alias count indicates a resource exhaustion attack` 拒读 |

## 1. SC-04 真实 KTX 对照验证

环境：demo 容器 `compose-lucy-1`（随包 KTX 0.16.0）。方法：同一 150 连接对象 manifest 写两版 `ktx.yaml`，跑 `ktx status`。

### 对照组（`yaml.stringify` 默认，149 个别名）

```
✗ Config    ktx.yaml has 1 schema issue
    ✗ ktx.yaml parse error: Excessive alias count indicates a resource exhaustion attack
```

KTX 拒读，与 2026-11-23 另一 Agent 现场事故一致。

### 实验组（`aliasDuplicateObjects: false`，0 别名）

```
ktx status · alias-verify (/tmp/alias-verify)
  LLM           none  ✗ no LLM configured; ...
  Storage       sqlite (state) · sqlite-fts5 (search)
```

配置解析通过（仅余 LLM 未配置提示，与本验证无关）。

**结论**：写入侧 `aliasDuplicateObjects: false` 是充分修复；读取侧无需也无法（KTX 为上游依赖）。SC-04 PASS。

## 2. 交付内容

| 类别 | 内容 |
|---|---|
| 统一写出口 | `webui/server/yaml-safe.ts`：`stringifySafe(value, options?)` 默认 `aliasDuplicateObjects: false`；既有选项（`lineWidth: 0`）透传；调用方无法绕过 |
| 调用点替换 | 8 文件 15 处 `stringify` → `stringifySafe`：project.ts 3、admin/roles.ts 7、admin/tokens.ts 3、admin/access-config.ts 1、admin/access-roles-agent-concurrent-edit.ts 2、admin/agents.ts 2、auth/admins-store.ts 1、catalog-reload.ts 1（含测试再导出 `_stringifyYaml`） |
| 静态门禁 | `scripts/lint/yaml-alias-gate.mjs`（入口 `npm run lint:yaml-alias`）：文本级 alias/anchor 判定＋AST 交叉验证；存量基线 0 命中，注入样例判 FAIL 并报 `文件:行号`；按 Plan「接 CI 另按治理确认」暂未挂 PR CI |
| 单测 | `webui/server/__tests__/yaml-safe.test.ts`：4 例（共享引用 150 处零别名／默认 parse 往返相等／选项透传／不可绕过） |

## 3. 验收结果

| SC | 结果 | 证据 |
|---|---|---|
| SC-01 | PASS | 单测 4/4 |
| SC-02 | PASS | `tsc --noEmit` 全绿；改动模块定向单测 9 文件 190 项通过 189 |
| SC-03 | PASS | 存量 84 文件 0 命中基线；注入样例 FAIL |
| SC-04 | PASS | 本记录 §1 |
| SC-05 | PASS | Spec／Plan／总账／REQ／两处索引镜像同句 S4 |

## 4. 回归归属说明（不属本条）

- 共享工作树中 `admin-agents.test.ts` 有 1 例 P1-75 用例失败（期望 200 得 503）。**干净工作树对照实验**：搬入并行会话在途 WIP（display-snapshot／mcp-proxy／acl／audit-trace-span 及新测试）而完全排除本条改动后，失败增至 6 例 ⇒ 归属并行会话在途实现，非本条回归。
- 临时工作树中 `project.add-schema.test.ts` 2 例失败，原因为工作树缺根 `ktx.yaml`（`Could not find ktx.yaml from …`）；主树同文件 10/10 通过 ⇒ 工作树环境假失败。
- 全量 webui 套件（390 文件单 worker）超过 5 分钟上限未跑完，本记录以定向模块套件＋类型检查为验收证据；全量补跑可另行安排。
