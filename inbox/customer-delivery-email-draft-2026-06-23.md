# 客户邮件草稿：Lucy Docker 部署包交付

收件人：客户工程师  
主题：Lucy Docker 部署包及样例数据测试材料

您好，

随信附上 Lucy Docker 部署交付包及配套文档。本包面向 Docker Compose 单机部署，客户侧无需在宿主机安装 Node.js、KTX CLI、Python、pnpm 或 uv。

附件说明：

1. `lucy-docker-source-bundle.tar.gz`  
   客户可安装包。解压后可直接使用 Docker Compose 构建并启动 Lucy demo 环境。

2. `lucy-customer-deployment-guide.md`  
   客户部署与运维指南，建议先阅读此文档。

3. `lucy-deployment-docker.md`  
   Docker Compose 部署细节与命令说明。

4. `lucy-test-cases.md`  
   全链路测试用例矩阵，包含 Docker-only 最小验收路径。

5. `customer-docker-deployment-test-2026-06-23.md`  
   我方在本机 Docker 环境完成的部署与样例数据测试报告。

快速验证步骤如下：

```bash
tar -xzf lucy-docker-source-bundle.tar.gz
cd lucy-docker-source-bundle
docker compose -f docker-compose.demo.yml up -d --build
docker compose -f docker-compose.demo.yml ps
curl http://127.0.0.1:55176/api/health
```

样例数据校验：

```bash
docker compose -f docker-compose.demo.yml exec demo-db \
  mysql -u lucy -plucy_demo dataforai -e \
  "SELECT COUNT(*) AS orders FROM superstore_orders; SELECT COUNT(*) AS people FROM superstore_people; SELECT COUNT(*) AS returns_count FROM superstore_returns;"
```

期望结果：

- orders = 1000
- people = 4
- returns_count = 60

语义层与查询链路校验：

```bash
docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy connection test demo-mysql

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy admin reindex --force --output json

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-mysql

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy sl --connection-id demo-mysql query \
  --measure superstore_orders.total_sales \
  --dimension superstore_orders.region \
  --segment superstore_orders.active_rows \
  --limit 5 \
  --execute \
  --max-rows 5 \
  --format json
```

测试完成后可清理 demo 环境：

```bash
docker compose -f docker-compose.demo.yml down -v
```

我方已基于提交 `ea8236e52f9020286c703b996000fa9788dcfc3b` 在本机 Docker 环境完成验证，结果为 Pass。详见附件测试报告。

如部署过程中遇到网络拉取镜像慢、端口占用或 Docker Desktop 代理配置问题，请先参考 `lucy-deployment-docker.md` 中的排障与大陆网络环境说明。

谢谢。
