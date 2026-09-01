export type ConnectionErrorCategory =
  | "starrocks_max_execution_time"
  | "ktx_runtime_uv"
  | "auth"
  | "network"
  | "generic";

export type ConnectionErrorGuidance = {
  category: ConnectionErrorCategory;
  title: string;
  summary: string;
  actions: string[];
};

const MAX_EXEC_RE =
  /max_execution_time|Unknown system variable/i;
const UV_RUNTIME_RE = /could not download uv|ktx Python runtime install failed|runtime install failed/i;
const AUTH_RE = /access denied|authentication|password|login/i;
const NETWORK_RE = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|timed out|connect/i;

export function classifyConnectionError(raw: string | undefined | null): ConnectionErrorGuidance {
  const text = (raw ?? "").trim();
  if (MAX_EXEC_RE.test(text)) {
    return {
      category: "starrocks_max_execution_time",
      title: "StarRocks / MySQL 协议兼容",
      summary:
        "目标库不支持 MySQL 的 max_execution_time 会话变量（常见于 StarRocks MySQL 协议端口）。",
      actions: [
        "请使用已包含 ktx StarRocks 兼容补丁的 Lucy 镜像（scripts/patch-ktx-mysql-starrocks-compat.js）",
        "新建连接时数据库类型请选择 StarRocks（MySQL 协议）",
        "升级后重新测试连接并拉取 live catalog"
      ]
    };
  }
  if (UV_RUNTIME_RE.test(text)) {
    return {
      category: "ktx_runtime_uv",
      title: "KTX Python Runtime 未就绪",
      summary: "内网环境无法在线下载 uv，live catalog 与部分查询能力不可用。",
      actions: [
        "换用已通过 G4b  bake-in runtime 的交付镜像（scripts/build-customer-amd64-image.sh）",
        "检查 /api/health 中 ktxRuntime.ready 是否为 true",
        "勿依赖容器启动时从 github.com 下载 uv"
      ]
    };
  }
  if (AUTH_RE.test(text)) {
    return {
      category: "auth",
      title: "认证失败",
      summary: "用户名或密码不正确，或账号无目标库权限。",
      actions: ["核对凭据与 schema", "确认账号对目标 host:port 有 CONNECT 权限"]
    };
  }
  if (NETWORK_RE.test(text)) {
    return {
      category: "network",
      title: "网络连通",
      summary: "无法到达数据库 host:port。",
      actions: ["确认 Lucy 容器到数据库的网络路由与安全组", "用 mysql 客户端从同网段验证"]
    };
  }
  return {
    category: "generic",
    title: "连接失败",
    summary: text || "未知错误",
    actions: ["查看原始诊断日志", "联系运维并提供 ktx connection test 输出"]
  };
}

export function formatConnectionErrorMessage(raw: string | undefined | null): string {
  const guidance = classifyConnectionError(raw);
  const action = guidance.actions[0];
  return `${guidance.summary}${action ? ` 建议：${action}` : ""}`;
}
