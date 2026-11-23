# P1-80 启用表范围三态前台交互证据（2026-11-23）

本机 demo Docker；真实前台浏览器；视口 1920×1080；路由 `/connections/enabled-tables`。候选构建当时 `gitSha=19b1c314`／`gitDirty=true`（证明改动有效；**不作**可上线封存凭据）。计时与注入方法见测试台跑次 [2026-11-23-cursor-p180-load-state](../qa/uat/suites/enabled-tables-load-state/runs/2026-11-23-cursor-p180-load-state.md)。全程未点击「移出无效启用」。

- E1：通过。打开后识别启用表范围主任务与工具栏（健康基线已选 15/15）。
- E2：通过。本实例有连接配置；空连接态由组件单测／既有夹具覆盖，本跑次未清空连接。
- E3：通过。pending 注入后约 255 ms 可见「正在读取表清单…」；无该连接无效启用与缺 Manifest。
- E4：通过。error 注入后可见「表清单读取失败，请重试。」与重试按钮；无假阳性缺 Manifest／无效启用。
- E5：通过。筛选无命中空态不冒充缺 Manifest（健康与 loading／error 态均可区分）。
- E6：通过。解除注入后恢复已选 15/15；无缺 Manifest／无效启用。
- E7：通过。success `tables:[]` 允许「缺少 Manifest」与无效启用区（真缺扫描）。
- E8：通过。pending／error 下「移出无效启用」不可见；empty 就绪后可见（未点击提交）。
- E9：通过。用户可区分加载／失败与已确认本地无 Manifest；缺 Manifest 横幅含去连接概览上传跳转。

套件判定 **PASS**。组件单测 SC-01–SC-05（含混合连接）5/5 PASS。
