# Lucy 客户 Docker 部署测试报告

| 元数据 | 内容 |
|---|---|
| 测试日期 | 2026-06-23 |
| 测试角色 | 客户工程师视角 |
| 测试目标 | 使用 Docker 部署 Lucy，并完成样例数据测试 |
| 测试提交 | `ea8236e52f9020286c703b996000fa9788dcfc3b` |
| 交付包 | `/tmp/lucy-customer-engineer-test/release/lucy-docker-source-bundle.tar.gz` |
| 结果 | Pass |

## 1. 测试方式

为避免混入本机工作区未提交改动，本次测试先从 `HEAD` 导出干净源码，再生成客户交付包：

```bash
git archive --format=tar HEAD -o /tmp/lucy-customer-engineer-test.tar
tar -xf /tmp/lucy-customer-engineer-test.tar -C /tmp/lucy-customer-engineer-test/clean-src
node scripts/release-artifacts.mjs --out /tmp/lucy-customer-engineer-test/release
```

随后解包客户 source bundle，并只使用 Docker Compose 执行部署与测试：

```bash
tar -xzf /tmp/lucy-customer-engineer-test/release/lucy-docker-source-bundle.tar.gz \
  -C /tmp/lucy-customer-engineer-test/deploy
cd /tmp/lucy-customer-engineer-test/deploy/lucy-docker-source-bundle
docker compose -f docker-compose.demo.yml -p lucy-customer-engineer up -d --build
```

## 2. 交付包检查

生成的 release 目录包含：

```text
lucy-customer-deployment-guide.md
lucy-deployment-docker.md
lucy-docker-source-bundle.tar.gz
lucy-release-metadata.json
lucy-release-notes.md
lucy-sbom.json
lucy-test-cases.md
```

source bundle 黑名单检查通过，未发现 `.git`、`.codex`、`inbox`、`release`、`node_modules`、`webui/docs`、`webui/scripts`、测试目录、`AGENTS.md`、`CLAUDE.md`、`lucy-skills`、`kx_financial`、`mysql-aliyun` 等开发或内部内容。

source bundle 大小约 `328K`。

## 3. Docker 部署结果

`docker compose ps` 结果：

```text
lucy-customer-engineer-demo-db-1   mysql:8.4           Up (healthy)   0.0.0.0:53306->3306/tcp
lucy-customer-engineer-lucy-1      project-lucy:demo   Up (healthy)   0.0.0.0:55176->5174/tcp, 0.0.0.0:57881->7879/tcp
```

WebUI health:

```json
{"ok":true,"data":{"status":"ok","lucyVersion":"1.0.0","bundledKtxVersion":"0.13.0"}}
```

## 4. 样例数据测试

demo MySQL 行数校验：

```text
orders   1000
people   4
returns  60
```

KTX connection test:

```text
Connection test passed: demo-mysql
Driver: mysql
Status: ok
```

KTX reindex:

```text
kind=reindex
sl/demo-mysql scanned=3 updated=3
force=true
```

Semantic layer validate:

```text
Valid semantic-layer source: demo-mysql/superstore_orders
```

Region 销售额查询：

```text
Central South  363958.9831
East           550670.8159
Northeast      302200.0925
Southwest      242646.2038
```

上述结果与 `examples/docker-demo/mysql/_baseline.json#sales_by_region` 一致。

## 5. 清理

测试结束后已执行：

```bash
docker compose -f docker-compose.demo.yml -p lucy-customer-engineer down -v
```

清理确认：

- 无 `lucy-customer-engineer` 残留容器。
- 无 `lucy-customer-engineer` 残留 volume。

## 6. 结论

客户工程师可以使用 `lucy-docker-source-bundle.tar.gz` 在 Docker 中部署 Lucy，并完成 demo 样例数据测试。

建议客户交付时从包内 `docs/customer-deployment-guide.md` 或 `docs/deployment-docker.md` 开始。
