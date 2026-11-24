# UAT-SUITE-PAGE-OPEN 跑次：2026-11-18（修复后）

| 元数据 | 内容 |
|---|---|
| 套件 | [suite.md](../suite.md) |
| 环境 | 本机 demo Docker `compose-lucy-1`，`http://127.0.0.1:55176`，`gitSha=801b9c02…`，`gitDirty=true`（含未提交修复） |
| 修复 | `RouteChunkBoundary` 分流（`webui/src/app/App.tsx`）；调用流水 `auth_failure` 行与故事线空值防护（同日前序修复） |
| 命令 | `cd webui && npx tsx ../scripts/uat/page-open-probe.mts`（先 `npx tsx ../scripts/uat/page-open-probe.mts --selfcheck`） |
| 证据 | `inbox/uat-page-open-2026-11-18/result.json`、`summary.md` |
| 判定器自检 | 4/4 OK：干净页 PASS；渲染崩溃 FAIL；chunk 加载失败 FAIL；空白页 FAIL |

## 结果

| 用例 | 结果 | 说明 |
|---|---|---|
| R0 | PASS | 管理员登录成功 |
| PO-01 | **PASS** | 侧栏二级入口与 `/help` 共 27 个路由，27 个页面检查点全部无 pageerror、无兜底边界、有标题或正文 |
| PO-02 | **PASS** | 页签与分段控件共 28 个检查点（含访问日志「问询记录／调用流水」、时间预设、使用概况、访问关系图、行权限等），全部通过 |
| PO-03 | NOT-RUN | 详情页未做，见下 |

总检查点 55（27 页面＋28 页签），FAIL 0。

## 缺口（GAP，不计入通过）

1. **PO-03 未做**：`/admin/agents/:id`、`/skills/:id`、`/catalog/...`、`/sources/...` 等带参数路由未用真实 id 打开。
2. **页签上限 6 个**：本轮各页签数量均未超限，但上限本身是探针的截断，未来页面超过 6 个页签时需要调高。
3. **负控说明**：本轮没有用探针对修复前的构建做一次复现。修复前的失败形态由错题 §2 的控制台栈与 `GET /api/admin/audit` 的数据形态记录，判定器的 FAIL 分支由 `--selfcheck` 与 `route-chunk-boundary.test.tsx` 覆盖。若要把负控做成实跑，需要保留修复前镜像再跑一次。
4. 客户实例（`10.69.95.109:8276`）未升级、未跑。

## 构建时间说明

容器于修复 `RouteChunkBoundary` 之后、类型修补之前构建。之后又加了两处纯类型修补（`entry.userId ?? ""` 等，见 `ObjectDetailDrawer.tsx` 与 `Audit.tsx`），运行时行为与容器一致。下一次跑次应在最终工作树上重建后再跑。

## 同时通过的单测

- `src/__tests__/route-chunk-boundary.test.tsx`：3/3（渲染 TypeError → 「本页出错」而非版本文案；重试只重置边界不刷新；chunk 加载失败仍显示版本文案）。
- `src/lib/audit-call-storyline.test.ts`、`src/__tests__/audit.test.tsx`：12/12（同前序修复）。

≠ 可上线。
