# 新建角色默认只读问答工具 Implementation Plan

> 执行者：按任务顺序实施并核对对应 Spec；本次仅起草文档，实施须经审阅确认。

**Goal:** 新建角色默认预选现有只读问答工具，让管理员聚焦数据范围配置，并在保存前明确拦截空工具列表。

**Architecture:** 复用 `READONLY_QA_PRESET`、角色共享草稿、本地校验和现有权限确认 Drawer。分别维护“新建初始草稿”和“新增权限比较基线”，保证默认工具既不造成初始脏状态，也不从审阅摘要中消失。运行时编译及 API 保持现有契约。

**Tech Stack:** React、TypeScript、TanStack Query、Vitest、React Testing Library、jsdom。

---

| 元数据 | 内容 |
|---|---|
| 版本 / 日期 | v0.1-draft / 2026-10-30 |
| 状态 | 草案，待审阅；未实施 |
| 主 Spec | [Spec 194](../../webui/docs/194-role-create-readonly-defaults-spec.md) |
| 授权边界 | 本次完成 Spec / Plan 起草及文档静态检查；编码、测试开发、部署和提交另待授权 |
| 验收状态 | RD-01–RD-10 全部未执行 |
| 优先级 | 先默认工具与完整创建流程，再配置引导及空工具校验；不得仅改错误文案即宣称完成 |

## 1. 实施前核对

1. 审阅 Spec 194 的默认集合、编辑/复制边界、初始干净状态与完整权限审阅要求。
2. 获得实施确认；执行时可使用已安装的 `executing-plans` 技能，遵循仓库开发治理。不默认启动多 Agent 流水线或创建用户聊天。
3. 记录工作区现有改动并保护无关文件，尤其是不跟踪的本地配置；不读取或输出凭据。
4. 复核下列代码锚点，若实现已变化，先登记差异并按 Spec 调整方案，不静默扩大范围。

| 文件 | 当前锚点 / 任务 |
|---|---|
| `webui/src/lib/rolePermissionDraft.ts` | `READONLY_QA_PRESET`、`partitionGrantableTools`、`derivePermissionImpact`；复用事实源，通常无需修改 |
| `webui/src/pages/admin/RoleDetail.tsx` | `EMPTY_DRAFT`、`initializeDraft`、`dirty`、`impact`、`validateDraft`、`requestSave`、放弃修改和基本信息/工具页渲染 |
| `webui/src/components/RoleToolGrants.tsx` | 现有预设、复选框及空状态；优先在页面层承载校验，必要时仅补关联属性 |
| `webui/src/__tests__/role-detail.test.tsx` | 初始化、跨 Tab、保存 dryRun 与确认 payload、复制与编辑回归的主要测试入口 |
| `webui/src/__tests__/role-detail-row-policy-save.test.tsx` | 限定行保存及预览确认回归 |
| `webui/src/__tests__/role-permission-draft.test.ts` | 草稿 hash、权限差异等既有语义回归 |
| `webui/server/__tests__/role-permission-draft-parity.test.ts` | 系统禁止工具集合一致性回归 |

## 2. Task 1：新建默认工具与基线

**Modify:** `webui/src/pages/admin/RoleDetail.tsx`。

**Test:** `webui/src/__tests__/role-detail.test.tsx`。

1. 新增 RD-01 / RD-04 测试：初始 6 个工具选中、空标识、空表范围、无脏状态；修改后放弃还原；再次新建不受上一个草稿污染。先运行确认失败属于现有空默认行为。
2. 在新建初始化分支引用 `READONLY_QA_PRESET`，创建独立草稿和基线副本；明确按 `mode === "create"` 应用默认值，不将缺少 detail 的其他分支误判为新建。
3. 新建初始草稿与 dirty 比较基线均带默认工具；新建 `impact` 单独使用空权限草稿作为比较起点。编辑和复制保持现有行为。
4. 同步首次 React 状态和后续 `initializeDraft` / 放弃修改路径，避免依赖候选请求补默认或短暂显示零工具。
5. 为权限差异补 RD-02 断言：填标识、选表后直接保存，Drawer / dryRun 包含全部 6 个新增工具；不再通过先点击预设使测试“通过”。

建议实现形状（命名可适配现有局部结构）：

```ts
function newReadonlyDraft(): RolePermissionDraft {
  return {
    roleId: "",
    description: "",
    scope: { mode: "names", tables: [] },
    tools: [...READONLY_QA_PRESET],
  };
}
// 新建 draft 与 pristine baseline 分别调用工厂，避免共享可变引用。
// impact 使用 mode === "create" ? EMPTY_DRAFT : baseline。
// 不将服务端解析基线替换为新建预设。
```

**验证命令**（仓库根目录）：

```bash
npm --prefix webui test -- src/__tests__/role-detail.test.tsx
```

**退出条件：** RD-01、RD-02、RD-04 对应测试通过；新建默认能力与权限审阅完整，初始无未保存修改提示。

## 3. Task 2：保持用户选择和原有角色边界

**Modify / Test:** 同 Task 1，按需复用现有测试 fixture。

1. 为 RD-03 / RD-08 添加候选接口延迟、失败及失效重取场景：先修改工具，再完成或刷新候选请求，草稿选择不回滚。
2. 扩展现有跨 Tab 及提交测试：移除一个默认工具，最终 payload 恰好为剩余选择，确认提交与 dryRun 角色 payload 深相等。
3. 为 RD-07 添加编辑与复制场景，源角色分别只有自定义查询工具或 Wiki 工具，断言不会自动添加预设。保留复制标识、过滤禁止工具、旧配置迁移等既有行为。
4. 检查默认值不依赖 `toolsQuery` 返回；不增加在候选刷新时重设草稿的 effect，不按候选列表静默过滤预设。

**验证：** 运行 Task 1 同一测试文件；失败只围绕默认初始化及相关 fixture 处理，不改生产权限配置。

**退出条件：** RD-03、RD-07、RD-08 对应测试通过；所有用户修改均可稳定进入保存预览。

## 4. Task 3：配置引导及空工具就地校验

**Modify:** `webui/src/pages/admin/RoleDetail.tsx`；仅必要时调整 `webui/src/components/RoleToolGrants.tsx` 的校验关联。

**Test:** `webui/src/__tests__/role-detail.test.tsx`。

1. 在基本信息页加入 Spec 194 §4.2 的弱提示；保留现有 Tab、工具预设和摘要，专业英文节点添加翻译防御。
2. 为 RD-05 / RD-06 先补失败测试：清空工具 → 保存 → 选中工具 Tab、出现页内 alert、焦点可达、无角色 dryRun / 写请求及 Drawer；选回一个有效工具后提示消除并能发起 dryRun。
3. 在通配符检查之后、数据范围及行级策略检查之前加入空可授予工具校验，返回 `section: "tools"` 和 Spec 规定的文案。校验条件为 `partitionGrantableTools(draft.tools).grantable.length === 0`。
4. 复用 `requestSave` 的 Tab 定位；用派生错误或受控错误状态承载页内提示，焦点仅在用户触发失败保存后迁移，不随普通勾选跳动。修复后不残留错误。
5. 覆盖只有禁止工具的防御场景；若正常 UI 会先过滤它们，可在纯校验边界验证，禁止为测试暴露生产调试入口。
6. 后端解析失败、未知工具、行级限制和写入回执继续使用现有机制，不更改机器码或自动放行。

**退出条件：** RD-05、RD-06、RD-10 对应测试通过；错误兜底不替代前两项默认体验交付。

## 5. Task 4：定向回归与交付记录

完成实现后按顺序执行：

```bash
npm --prefix webui test -- src/__tests__/role-detail.test.tsx src/__tests__/role-detail-row-policy-save.test.tsx src/__tests__/role-permission-draft.test.ts server/__tests__/role-permission-draft-parity.test.ts
npm --prefix webui run lint:terminology
npm run lint:spec
npm --prefix webui run build
git diff --check
```

预期：定向测试全部通过，术语和 Spec 检查无本次新增问题，生产构建成功，diff 无空白错误。`build` 为 Vite 构建，不宣称替代独立 TypeScript 全量检查。既有失败需记录原始证据和归属，不修改无关模块以掩盖失败。

核对 RD-09：表和连接仍由管理员显式配置，原有行级策略预览及工具兼容提示通过回归；不新增任何运行时默认授权。若现有测试未覆盖本次默认工具与限定行提示的组合，在现有 jsdom 组件测试中补充。

默认不运行 Playwright、真实浏览器、移动窄屏或真实实例写入；未来若明确要求，另列验证范围。无需构建镜像或修改产品版本。

完成后在 Spec 和 Plan 中逐项登记已执行验收与证据；补充 Spec 150 对新建工具默认值的交叉引用，并核实其旧“空草稿”表述，避免契约矛盾。交付说明包含 Design System Compliance、验证结果及限制。提交、推送、合并与发布按后续授权处理，不将文档或实现完成等同于部署完成。

## 6. 风险与回退

| 风险 | 约束 / 验证 |
|---|---|
| 默认工具导致初始脏状态 | RD-01；默认草稿和 dirty 基线一致 |
| 默认工具未计入权限审阅 | RD-02；新建 impact 单独以空权限为基线 |
| 自动补齐扩大已有角色权限 | RD-07；默认初始化只进入 create 分支 |
| 候选请求或切页覆盖人工选择 | RD-03 / RD-08；初始化与候选请求解耦 |
| 默认工具被误认为绕过数据范围及行限制 | RD-09；显式选择表，沿用编译与行级裁决 |
| 候选能力不支持某项默认工具 | 保留完整草稿，服务端 dryRun 继续校验；不静默换工具或跳过编译 |

回退前端默认初始化、引导和校验的代码变更即可；不迁移或回写已创建角色，不删除管理员已确认的工具权限。此 Plan 不包含部署动作。

## 7. Design System Compliance

遵循 Spec 194 §8 引用的配置页布局、按钮和 Toast 规范。只使用已有说明层、工具控件及页内校验反馈，不新增布局模式或设计 token。验收 RD-10 同时覆盖术语及浏览器翻译防御。

## 8. 本次起草检查记录

2026-10-30，仅执行文档静态检查：

| 检查 | 结果 |
|---|---|
| `npm run lint:spec` | 通过；存量警告：`evals/chatbi_intl/eval/chatbi_intl-eval-cases.yaml` 缺少 `metadata.paired_quiz`，本地 `demo_readonly` 角色缺少 `permission_model_version`（迁移窗口） |
| `npm --prefix webui run lint:terminology` | 通过，扫描 1039 个文件 |
| Spec / Plan 相对链接存在性检查 | 通过 |
| 文档空白与 `git diff --check` | 通过 |

未修改产品代码、角色配置或用户实例；未运行功能测试、生产构建、浏览器验证或部署。上述检查不代表 RD-01–RD-10 已通过。
