// T12 — keep connection-error classification tightly scoped to connectivity
// facts: never let a probe pass imply authorization, never bundle every
// transport error under one label. ENOTFOUND (DNS), ECONNREFUSED/ETIMEDOUT
// (route/transport), and auth are separate concerns; missing library and
// missing table get their own category so a schema gap is not hidden behind
// a generic "network" banner.

export type ConnectionErrorCategory =
  | "starrocks_max_execution_time"
  | "ktx_runtime_uv"
  | "auth"
  | "dns"
  | "network"
  | "missing_target"
  | "generic";

export type ConnectionErrorGuidance = {
  category: ConnectionErrorCategory;
  title: string;
  summary: string;
  actions: string[];
};

const MAX_EXEC_RE = /max_execution_time|Unknown system variable/i;
const UV_RUNTIME_RE = /could not download uv|ktx Python runtime install failed|runtime install failed/i;
const AUTH_RE = /access denied|authentication|password|login/i;
const DNS_RE = /ENOTFOUND|getaddrinfo|resolve host|no such host/i;
const TRANSPORT_RE = /ECONNREFUSED|ETIMEDOUT|connect|connection refused|connection timed out|connection reset|network is unreachable/i;
const MISSING_TARGET_RE = /library not found|missing library|table .*doesn'?t exist|table not found|no such table|unknown table|schema .*doesn'?t exist|relation .*does not exist/i;

export function classifyConnectionError(raw: string | undefined | null): ConnectionErrorGuidance {
  const text = (raw ?? "").trim();
  if (MAX_EXEC_RE.test(text)) {
    return {
      category: "starrocks_max_execution_time",
      title: "StarRocks / MySQL 协议兼容",
      summary: "目标库不支持 MySQL 的 max_execution_time 会话变量（常见于 StarRocks MySQL 协议端口）。",
      actions: [
        "请使用已包含 ktx StarRocks 兼容补丁的 Lucy 镜像（scripts/runtime/patch-ktx-mysql-starrocks-compat.js）",
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
        "换用已通过 G4b  bake-in runtime 的交付镜像（scripts/release/build-customer-amd64-image.sh）",
        "检查 /api/health 中 ktxRuntime.ready 是否为 true",
        "勿依赖容器启动时从 github.com 下载 uv"
      ]
    };
  }
  // T12 — auth stays independent of network: a refused connection is not a
  // credential failure and vice versa. The probe card and the read-API both
  // rely on this distinction.
  if (AUTH_RE.test(text)) {
    return {
      category: "auth",
      title: "认证失败",
      summary: "用户名或密码不正确，或账号无目标库权限。",
      actions: ["核对凭据与 schema", "确认账号对目标 host:port 有 CONNECT 权限"]
    };
  }
  if (DNS_RE.test(text)) {
    return {
      category: "dns",
      title: "DNS 解析失败",
      summary: "无法解析数据库 host 名，请检查 DNS / 容器解析配置。",
      actions: [
        "在 Lucy 容器内 `nslookup <host>` 确认能解析",
        "核对 ktx.yaml 中连接配置的 host 拼写与大小写",
        "内网环境确认 /etc/resolv.conf 与 search domain"
      ]
    };
  }
  if (TRANSPORT_RE.test(text)) {
    return {
      category: "network",
      title: "网络连通",
      summary: "已解析 host，但无法建立到 host:port 的连接或连接被中断。",
      actions: [
        "确认 Lucy 容器到数据库 host:port 的网络路由与安全组",
        "用 mysql 客户端从同网段验证可达性",
        "核对连接配置的端口与协议（MySQL / StarRocks / KTX 专属端口）"
      ]
    };
  }
  if (MISSING_TARGET_RE.test(text)) {
    return {
      category: "missing_target",
      title: "目标对象缺失",
      summary: "连通正常，但访问的库、表或函数在数据库中不存在。",
      actions: [
        "在连接概览的「启用表范围」中核对已选库 / 表是否与数据库实际一致",
        "刷新 Schema Manifest 后再次连通测试",
        "若新增表尚未补 Manifest，先在数据库侧确认存在"
      ]
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
