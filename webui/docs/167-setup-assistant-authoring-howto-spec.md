# 接入向导：不知道如何生成时的提醒

| 元数据 | 内容 |
|---|---|
| 文档名称 | 接入向导：不知道如何生成时的提醒 |
| 文档类型 | Product / UX Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/connections` 接入向导第 2 步与第 5 步 |
| 上游 | Spec 130、Spec 157、Spec 158、`webui/docs/00-product-terminology-standard.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 第 2 步增加「如何生成 Schema Manifest」，第 5 步增加「如何写业务 Wiki」。提醒不挡主按钮。编写说明可复制或下载，不指定客户端 |

用户连上数据库之后，仍可能不知道 Schema Manifest 从哪来，也不知道业务 Wiki 写什么。把编写说明放在启动向导之前，会让已经能直接读库的人以为必须先准备文件。

## 1. 问题

2026-10-12 审阅接入向导时确认：

- 第 2 步对 MySQL、PostgreSQL，以及走 MySQL 协议的 StarRocks、Doris，主按钮已经是「从数据库读取表结构」。不知道这一点的人仍会以为必须手写 YAML。
- SQLite、SQL Server、Oracle 不能读库，主动作只剩上传。没有合格文件时，这一步走不下去。
- 第 5 步可以手写、上传或跳过。不知道口径怎么写的人看不到下一步。
- 编写说明若写成「去某个客户端安装 Skill」，会把不用该客户端的人挡在外面，也会和「业务 Skill」混淆。

## 2. 目标

1. 用户不知道如何生成 Schema Manifest 时，在第 2 步看到「如何生成 Schema Manifest」。
2. 用户不知道如何写业务 Wiki 时，在第 5 步看到「如何写业务 Wiki」。
3. 能在向导里完成的路径写在前面。需要文件时，再让用户把编写说明交给自己的 Agent。
4. 复制与下载的说明不指定客户端。
5. 提醒不取代、不禁用第 2 步和第 5 步的主按钮。

## 3. 非目标

- 不在第 1 步、空状态或启动向导之前要求准备 YAML 或 Markdown。
- 不改第 3、4、6 步。
- 不改第 2 步的读库、复用、上传和「结束并稍后继续」。主动作仍按 Spec 157 §6.3。
- 不把业务 Wiki 改成必填。跳过仍进入第 6 步。
- 不把编写说明写入 `/skills`，也不把它称为业务 Skill。
- 不在向导里执行 Agent，不代用户连接数据库生成文件。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 157 未描述生成文件的帮助 | 第 2 步和第 5 步的 how to 以本文件为准。Spec 157 §6.5 只保留交叉引用 |
| Spec 130 §3.2 把上传写成第 2 步的主要说明 | 上传仍可用。不知道如何生成时，先看本文件的提醒，再决定读库或上传 |

## 5. 提醒

两条提醒都是 `<details>`。标题是 `<summary>`。`Schema Manifest`、`YAML`、`Markdown`、`Agent` 使用 `notranslate` 与 `translate="no"`。

提醒内的「复制说明」「下载编写说明」使用 `pl-btn--ghost`。它们不是该步的 primary 或 secondary。

| 步骤 | 标题 | `data-testid` | 默认 |
|---|---|---|---|
| 2 | 如何生成 Schema Manifest | `setup-howto-schema-manifest` | 见 §6 |
| 5 | 如何写业务 Wiki | `setup-howto-business-wiki` | 折叠 |

第 2 步正文：

1. 能读取这套数据库时，点「从数据库读取表结构」。写入的 Schema Manifest 包含表名、字段和类型。
2. 不能读取，或用户要自己准备文件时，把编写说明交给 Agent，让它连接同一套数据库并生成 YAML，再把文件拖到本页或粘贴到下面。

第 5 步正文：

1. 可以直接在下面写口径，或上传一份 Markdown。暂时没有也可以跳过。
2. 还不知道写什么时，把编写说明交给 Agent，让它按已启用的表写成中文口径，再贴回本页。

复制按钮在成功后短暂显示「已复制」。下载不离开向导。

| 种类 | 下载文件名 |
|---|---|
| Schema Manifest | `lucy-schema-manifest-howto.md` |
| 业务 Wiki | `lucy-business-wiki-howto.md` |

复制与下载使用同一份正文。

## 6. 编写说明

Schema Manifest 说明要求 Agent：

- 先向用户确认数据库、Schema 和要包含的表。用户没指定表时，先列出该 Schema 的表并请用户确认。
- 若该连接能读库，告诉用户回到第 2 步点「从数据库读取表结构」，不必再生成文件。
- 需要文件时，产出 `<schema>.yaml`。`table` 写成 `schema.物理表名`。列 `type` 只能是 `string`、`number`、`time`、`boolean`。
- `descriptions.db` 与 `descriptions.ai` 用中文。
- `joins.relationship` 只能是 `many_to_one`、`one_to_many`、`one_to_one`。不要写 `many_to_many`。
- 不要编造用户没确认的指标公式。
- 明确写「不要假定用户使用哪一个客户端」。

业务 Wiki 说明要求 Agent：

- 先向用户确认连接 ID、Schema、已启用的表，以及指标、单位和容易算错的地方。
- 用户说不清口径时，按表和字段注释起草，并把不确定的句子标成「待确认」。
- 产出 Markdown。要关联到表时，文件头包含 `visibility: private` 和 `sl_refs`，引用形如 `<connectionId>/<schema>/<source_name>`。
- 正文用中文，写清业务对象、算法、单位、不能漏的过滤和常见算错方式。
- 告诉用户可以贴进第 5 步、上传该文件，或先跳过。
- 明确写「不要假定用户使用哪一个客户端」。

两份说明都不出现某个客户端的安装目录，也不把这份说明称为 Skill。

## 核心流程（伪代码）

```text
step2HowTo(projectFetched, primaryAction):
  render collapsed "如何生成 Schema Manifest"
  # primaryAction 沿用 Spec 157：choose | read | upload | use | retry
  if projectFetched and primaryAction == upload and not autoOpened:
    open the details once
    autoOpened = true
  # 用户之后自行折叠或展开，不再被自动打开覆盖

step5HowTo():
  render collapsed "如何写业务 Wiki"
  do not auto-open

onCopy(kind):
  write authoringNotes(kind) to the clipboard
  show "已复制" briefly
  do not change the wizard step or disable the primary action

onDownload(kind):
  download authoringNotes(kind) as the filename in §5
  stay on the current step

authoringNotes(schema_manifest):
  return the Schema Manifest brief in §6

authoringNotes(business_wiki):
  return the Business Wiki brief in §6
```

`projectFetched` 为假时，第 2 步不得因「连接尚未返回」就展开提醒。连接返回后，只有主动作是「上传 Schema Manifest」才自动展开一次。

## 7. 验收

| ID | 场景 | 期望 |
|---|---|---|
| SC-1 | MySQL 连接，第 2 步可以读库 | 可见「如何生成 Schema Manifest」，提醒折叠。主按钮仍是「从数据库读取表结构」，且可点 |
| SC-2 | SQL Server 连接，第 2 步只能上传 | 项目数据返回后提醒展开。主按钮仍是「上传 Schema Manifest 并继续」 |
| SC-3 | 第 5 步 | 可见「如何写业务 Wiki」，默认折叠。「跳过并稍后设置」可点。展开后可见「暂时没有也可以跳过」 |
| SC-4 | 展开任一提醒后复制 | 剪贴板内容与该步编写说明一致。Schema Manifest 说明包含「不要假定用户使用哪一个客户端」，且不出现客户端专名 |
| SC-5 | 下载编写说明 | 下载对应文件名的 Markdown，向导不关闭、不跳步 |
| SC-6 | 第 1 步与连接概览空状态 | 不出现这两条提醒，不要求先下载编写说明 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 如何生成 Schema Manifest：第 2 步折叠提醒的标题。
- 如何写业务 Wiki：第 5 步折叠提醒的标题。
- 编写说明：复制或下载后交给 Agent 的生成说明。UI 主术语用「复制说明」「下载编写说明」。

禁止文案：下载 Skill、业务 Skill、配置作者、去某个客户端安装、先准备好 YAML 再启动向导、维基模板、把业务 Wiki 写成必填。

`Schema Manifest`、`YAML`、`Markdown`、`Agent` 的 DOM 节点保持 `notranslate` 与 `translate="no"`。

## Design System Compliance

- 引用 `webui/docs/design-system/10-components-button.md`：同一状态只有一个 primary。how to 里的复制和下载是 ghost，不与「从数据库读取表结构」或「保存并继续」并列成第二颗主按钮。
- 引用 `webui/docs/design-system/00-principles.md`：帮助出现在用户不知道怎么做的那一步，不在进入向导前增加必经清单。
- 提醒使用原生 `<details>`，标题可键盘展开，不另做一层模态。

## 8. 测试

`webui/src/__tests__/setup-assistant.test.tsx` 覆盖 SC-1 至 SC-4。下载触发浏览器保存，测试断言创建了下载地址。

本 Spec 的实现验收用 Vitest。SC-6 由第 1 步和空状态不渲染这两条提醒保证，不另开页面级用例。
