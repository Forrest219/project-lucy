# Lucy 2.0 升级验收与正式环境放行

每次使用新包均按 `UPGRADE-RELEASE-CHECKLIST.md` 逐项记录。原生服务器首先从最终归档重新解压并准备实例，回传真实 `scripts/deploy.sh --dry-run` 结果；供应方合成集群回归不能代替这一步及后续实际升级/恢复。失败时回传阶段、错误码、异常类型和脱敏诊断，不修改脚本/校验/身份信息绕过。

先在原生 amd64 K3s/K8s 测试环境，使用最终交付包和真实固定旧镜像完成升级与恢复演练。正式环境在批准的维护窗口执行。HTTP 与 HTTPS 分别记录，一个访问方式的结果不代表另一个已验收。

## 记录身份

记录包 SHA256、BUILD-INFO Git/Chart/产品/KTX 版本、旧新镜像及 Pod 实际 imageID、namespace/release、前后 revision、开始结束时间。逐项记录 PASS/FAIL、脱敏错误及恢复结果。不要回传密钥、密码、Cookie、完整 values、PVC 备份或 Secret。

## 必验项目

- [ ] 包内工具准备实例，dry-run 和实际部署通过；Pod 身份属于 `image/image-identity.json` 的候选链。
- [ ] 保留同一 PVC 和资源名；Service 不暴露 KTX 7878。
- [ ] Pod 环境包含本次确定的内容根（`LUCY_CONTENT_ROOT` 为 `.`，或省略以使用 Chart 默认）以及 HTTPS 所需的 `LUCY_TRUST_PROXY`、`LUCY_TRUSTED_PROXY_CIDRS`。
- [ ] Service 类型和 Service 端口与升级前基线一致；容器端口为 WebUI 5174、MCP 7879。
- [ ] 初始备份及 baseline.json、baseline-values.json、initial-backup.json 存在，备份哈希通过。
- [ ] 认领前 `/api/auth/status` 为 bootstrap；缺失/错误密钥不能创建所有者。
- [ ] 正确密钥创建首个所有者；重复认领被拒绝。
- [ ] 退出后重新登录；未认证访问受保护管理 API 被拒绝。
- [ ] Pod 重启和同实例再次部署后仍能登录，不重新认领或轮换密钥。
- [ ] HTTP 会话正确；HTTPS 验证实际证书/CA和 Secure Cookie，错误 CA 不被忽略。
- [ ] 原 ktx.yaml、语义层、Wiki、Skill、权限、密码保留；新增账号/安全库和日志允许按预期变化。
- [ ] 原 MCP Token 可 initialize/tools/list 和执行一条真实允许查询；无 Token、原禁止查询仍拒绝。
- [ ] 连接、索引重建通过；历史审计可访问。
- [ ] 测试环境完成 RECOVERY.md，还原旧卷和旧版本并验证业务，再次升级符合恢复预期。

基础检查在客户目录运行，填写实际名称/URL/连接；MCP Token 从密钥管理器注入环境，不在命令参数输入明文：

```bash
if [ -f tls-ca.pem ]; then
  export CURL_CA_BUNDLE="$PWD/tls-ca.pem"
fi
bash package/scripts/acceptance.sh --namespace ACTUAL_NAMESPACE \
  --release ACTUAL_RELEASE --deployment ACTUAL_DEPLOYMENT --service ACTUAL_SERVICE \
  --public-mcp-url ACTUAL_MCP_URL --webui-url ACTUAL_WEBUI_URL \
  --connection ACTUAL_CONNECTION --expect-content-root .
```

基础脚本不替代管理员旅程、权限查询和恢复演练。最终身份对应的适用项目通过后才能放行正式环境；未执行项填写待验，不能填 PASS。
