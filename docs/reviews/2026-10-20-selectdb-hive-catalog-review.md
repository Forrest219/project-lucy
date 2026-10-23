# SelectDB 外部目录与 Lucy 连接：故事与建议

> **状态**: 待审阅
> **日期**: 2026-10-20
> **性质**: 客户现场说明与配置建议。不是 Spec，不改代码。
> **范围**: 客户 SelectDB（Studio 中的 `internal`、`hive`、`hive_jd`）与 Lucy 连接 `doris-main`、`hive`

## 1. 截图里的地址

这些画面不是在本机环境执行的。客户截图放在：

```text
/Users/forrest/Desktop/tolucy debug
```

SelectDB Studio 的地址栏是：

```text
http://172.16.19.51:8004/webui/query/editor
```

浏览器标为不安全，所以是 `http`。SQL 编辑器在这一页：目录选 `hive`，库选 `hive.dw`，语句是 `hive.dw.dw_sns_user`，查询成功。同一页的目录下拉里有 `internal`、`hive`、`hive_jd`。后一张只截了目录下拉，没有再次露出地址栏，页面内容与上面这个地址是同一处编辑器。

Studio 里查出的库，服务地址写在 Lucy 连接卡片上，不是上面这个网页地址：

```text
172.16.19.21:9030
```

`doris-main` 与名叫 `hive` 的连接都是这个主机端口。`doris-main` 的 Database 是 `chatbi`，`hive` 的 Database 是 `dm`。

Lucy 管理台和 OpenClaw 的截图没有浏览器地址栏，材料里没有这两处的网页 URL。管理台画面是「连接概览」和「启用表范围」；OpenClaw 画面是 2026-10-19 12:17 的问数报错。

## 2. 对方给出的架构

对方补充的架构是预期路由，不是已经走通的现网路径。`hive` 这一支标注为「预期路由」。

```text
OpenClaw → Lucy → Doris / SelectDB
                 ├─ internal Catalog ← Lucy 连接 doris-main
                 │   └─ chatbi、dm、ods 等数据库
                 └─ hive Catalog     ← Lucy 连接 hive（预期路由）
                     └─ dm、dw、dwd 等数据库
                         └─ 各业务表
```

这张图只画了 `internal` 和 `hive`。Studio 截图里还有第三个 Catalog `hive_jd`，不在这张图上。

对方随后给了更具体的填法，并写明了 IP。两条连接都指向同一台 SelectDB，差别在 Database 字段：

```text
Doris / SelectDB: 172.16.19.21:9030
├─ Lucy 连接 doris-main
│   database: chatbi
│   └─ internal → chatbi、dm、ods 等
└─ Lucy 连接 hive
    database: hive.dm
    schemas: dm、dw、dwd
    └─ hive → dm、dw、dwd 等
```

对方的说法是：支持用这两个连接分别访问同一台 Doris 上的 `internal` 和 `hive`。关键是 `hive` 这条连接的 Database 填 `hive.dm`，只把连接名叫 `hive` 不够。并称虚拟测试已验证 Schema 列表、表结构和查询路由；真实环境还要等网络恢复后再验证，并确认这台 Doris 支持 `catalog.db` 这种连接方式。

这个 IP 与连接卡片上的主机端口一致。客户现网卡片上，`hive` 的 Database 写的是 `dm`，不是 `hive.dm`。虚拟测试不是这次在本机或客户现网做的，稿里先记为对方提供的填法，不记为已经在 `172.16.19.21` 上验证通过。

## 3. 结论

客户要查的 Hive 数据，在 SelectDB 里是两个外部 Catalog：`hive` 和 `hive_jd`。数据库在 Catalog 下面。Lucy 的连接只记录「连到哪台 SelectDB」和「哪个数据库」，没有 Catalog 这一层。

管理台里名叫 `hive` 的连接，并没有站在 Studio 里的 `hive` 目录上。它和 `doris-main` 连的是同一台 SelectDB，登录后仍在 `internal`。所以添加 Schema 时看到的是 `internal` 的库。

OpenClaw 报 `Connection "hive" is not configured in ktx.yaml`，说的是当时接住问数的进程名单里只有 `doris-main`。管理台已经能看到 `hive`，不能据此当成「文件里没有这条连接」。升级当前仓库里的 Lucy 修不了 Catalog 这一层：镜像仍绑定 KTX 0.16.0，列库方式也没有按 Catalog 区分。

建议先在客户那套正在跑的 Lucy 上重启，让问数进程重新读配置。访问两个 Hive 目录的数据，要各建一条连接，并先在 SelectDB 里验证登录后的默认目录。现有那张 `hive` 连接不要再加 Schema。

## 4. 故事

客户使用 SelectDB，Studio 的 SQL 编辑器里能看到三个 Catalog：

| Catalog | 在 Lucy 里对应什么 | 里面有什么 |
|---|---|---|
| `internal` | 连接 `doris-main` | SelectDB 自己的库，例如 `chatbi`、`dm` |
| `hive` | 客户期望单独接入 | Hive 侧的库，例如 `dw`、`dwd`，以及一个同名但不是同一套表的 `dm` |
| `hive_jd` | 尚未接入 | 另一套外部目录 |

Studio 里这条语句可以查出数：`hive.dw.dw_sns_user`。名字的三层是 Catalog、数据库、表。数据仍在 Hive，SelectDB 按目录去读。

客户在 Lucy「连接概览」里另建了一张连接，ID 就叫 `hive`。卡片类型是 MySQL，主机端口与 `doris-main` 相同（`172.16.19.21:9030`），Database 是 `dm`。其下 Schema `dm` 已启用 3 张表。配置同步时间是 2026-10-19 11:38，卡片上的连通探测有结果。

同一天 12:17，OpenClaw 通过 Lucy 问数，报错原文是：

```text
Connection "hive" is not configured in ktx.yaml.
Configured connections: doris-main.
```

添加 Schema 时还有两个现象：只能从下拉列表选择，不能手填；列表里是 `doris-main` 所在的 `internal` 库，例如 `chatbi`、`ods`，以及 `__internal_schema`，不是 Studio 里 `hive` 目录下的 `dw`、`dwd`，而且相对那个目录也不全。

问数报错发生在客户环境，不是本机执行的结果。判断依据是上述目录里的客户截图、报错原文，以及本仓库与 KTX 0.16.0 的读取路径。

## 5. 两层名字

SelectDB 的层级是：

```text
Catalog
  └─ 数据库
       └─ 表
```

`internal` 是自带目录，不能删，里面是 SelectDB 自己的表。`hive`、`hive_jd` 是外部目录，只保存如何连到外部元数据，不把表搬进 `internal`。`internal.dm` 和 `hive.dm` 可以同名，但是两套表。

连上 SelectDB 后，会话默认站在 `internal`。不写 Catalog 时，看到的库属于 `internal`。要看 Hive，需要 `SWITCH hive`，或者在表名里写全 `hive.库.表`。

Lucy 这边的「连接」不是 SelectDB 的 Catalog。一张连接对应一次登录。登录后站在哪个 Catalog，决定添加 Schema 时能看见哪些库。

## 6. 已核对的行为

问数进程在启动时读取一次 `ktx.yaml`，之后新建会话不会再读。报错里的 `Configured connections` 就是这次查找所用的那份名单。查找失败发生在进数据库之前，所以这句报错不是密码错误，也不是 Catalog 切换失败。

管理台展示连接、刷新本地目录、卡片连通探测，读的是当前文件，或另起一条命令去读当前文件。这些成功，不能证明常驻问数进程已经认识新的连接名。在已有连接上加 Schema 或加表，连接名本来就在，也不需要靠重启让进程「认识」这个名字。

因此，以往新增连接不用重启就能在管理台上用，和这次 OpenClaw 失败，可以同时成立。按一套 Lucy 理解即可：页面看得到 `hive`，问数进程的名单里仍只有 `doris-main`。

列 Schema 时，Lucy 让 KTX 执行一条按 MySQL 协议的 `information_schema` 查询，不切换 Catalog。客户这张 `hive` 连接因此列出 `internal` 的库。列表一旦有候选项，抽屉只给下拉框，不能手填。已经加过的 `dm` 会从候选项里拿掉。

KTX 是查数和语义的执行层。Lucy 是管理台和问数入口，镜像里安装的 KTX 版本是 0.16.0。当前仓库没有按 SelectDB Catalog 列库的改动。升级 Lucy 会重新拉起进程，名单会被重新读一遍，这和重启是同一件事；读进来之后，这张连接仍然站在 `internal`。

## 7. 建议

### 7.1 先让问数进程读到已有配置

在客户那套正在跑的 Lucy 上重启 Pod，不要在分析用的本机复现。部署名一般为 `lucy`，命名空间用客户实际的那个。

重启后用 OpenClaw 再问一次 `hive`。报错不再是「只有 `doris-main`」，说明连接名单已经加载。这时查到的仍是 `internal` 下的 `dm`，不是 `hive.dw`。

若重启后仍然只有 `doris-main`，再核对 OpenClaw 的地址是不是这套管理台。在此之前按一套环境处理。

### 7.2 访问两个 Hive 目录

一条 Lucy 连接只能站在一个 Catalog 里。

- 只访问 `hive` 下面的两个库，例如 `dw` 和 `dwd`：一条连接够用。
- 要同时访问 `hive` 和 `hive_jd`：各建一条连接。

不要继续往现有的 `hive` 连接上加 Schema。那张连接的类型是 MySQL，登录后仍在 `internal`。

在 SelectDB 里为每个目标 Catalog 准备一个给 Lucy 用的账号，让该账号一登录就进入对应目录。3.1 及以上可以设置：

```sql
SET PROPERTY FOR 'lucy_hive' 'default_init_catalog' = 'hive';
SET PROPERTY FOR 'lucy_hive_jd' 'default_init_catalog' = 'hive_jd';
```

用该账号新开一次会话，先跑下面三条。前两条证明站在目标目录；第三条必须也列出 `dw`、`dwd` 这类库。如果第三条仍是 `chatbi`、`ods`，Lucy 的添加 Schema 下拉还是 `internal`，这条配法不成立，先不要在管理台建连接。

```sql
SHOW CATALOGS;
SHOW DATABASES;

SELECT table_schema, COUNT(*)
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
GROUP BY table_schema;
```

三条都对上之后，在 Lucy 新建连接，类型选 Apache Doris，主机端口与 `doris-main` 相同。用户名使用上面的专用账号。Database 填该 Catalog 下真实存在的库，例如 `dw`。主机端口相同时，靠不同用户名建成第二条连接。然后在各自连接上添加该目录下的库。外部目录上的表一般只能查，不能写。

### 7.3 这次不做什么

不把本文写成 Spec，也不为此升级 Lucy。升级不能让一条连接同时代表 `hive` 和 `hive_jd`，也不能让现有列库查询进入外部 Catalog。

## 8. 审阅时请看的边界

- 客户现场按一套 Lucy 理解。尚未用进程启动时间和 OpenClaw 地址做交叉确认；只有重启后报错不变时才需要查是不是打到了另一套。
- `default_init_catalog` 依赖 SelectDB / Doris 版本能力。客户版本未在本次材料里确认，所以必须先做第 7.2 节的三条验证。
- 本文不提出产品改动方案。若审阅后要让 Lucy 原生识别 Catalog，需要另开 Spec。
