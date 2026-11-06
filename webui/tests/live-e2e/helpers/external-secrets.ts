// Load live-demo credentials from paths OUTSIDE the git repo.
// Never log secret values. Register them with the real-e2e vault for leak checks.

import { existsSync, readFileSync } from "node:fs";
import { vault } from "../../real-e2e/helpers/secret-capture";

export type WebuiLogin = { adminId: string; password: string };

export type MysqlEndpointCreds = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export function defaultLoginFile(): string {
  return (
    process.env.LUCY_E2E_WEBUI_LOGIN_FILE ??
    "/Users/forrest/Projects/config-for-agents/lucywebui logi.txt"
  );
}

export function defaultMysqlAliyunFile(): string {
  return (
    process.env.LUCY_E2E_MYSQL_ALIYUN_CREDENTIALS_FILE ??
    "/Users/forrest/Projects/config-for-agents/mysql-aliyun.txt"
  );
}

export function liveSecretsAvailable(): boolean {
  return existsSync(defaultLoginFile()) && existsSync(defaultMysqlAliyunFile());
}

/** Non-empty lines: adminId, spare, password. */
export function parseWebuiLoginFile(text: string): WebuiLogin {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) {
    throw new Error("WebUI login file needs adminId, spare identifier, and password lines");
  }
  return { adminId: lines[0], password: lines[2] };
}

/**
 * Prefer the first "# 有效" section. Do not split on bare "#":
 * passwords may contain "#" (regression: truncated Password:…#…).
 */
export function parseMysqlAliyunCredentialsFile(text: string): MysqlEndpointCreds {
  const lines = text.split(/\r?\n/);
  let inValid = !text.includes("# 有效");
  const block: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# 有效")) {
      inValid = true;
      continue;
    }
    if (inValid && trimmed.startsWith("#") && !trimmed.startsWith("# 有效")) {
      break;
    }
    if (inValid) block.push(line);
  }
  const section = block.join("\n");
  const host = section.match(/Hostname:\s*\n?\s*(\S+)/i)?.[1];
  const port = Number(section.match(/Port:\s*(\d+)/i)?.[1] ?? "3306");
  const username = section.match(/Username:\s*(\S+)/i)?.[1];
  const password = section.match(/Password:\s*(\S+)/i)?.[1];
  if (!host || !username || !password || !Number.isInteger(port) || port < 1) {
    throw new Error("MySQL credentials file missing host/username/password/port in active section");
  }
  return { host, port, username, password };
}

export function loadLiveDemoSecrets(): {
  login: WebuiLogin;
  mysql: MysqlEndpointCreds;
} {
  const login = parseWebuiLoginFile(readFileSync(defaultLoginFile(), "utf8"));
  const mysql = parseMysqlAliyunCredentialsFile(readFileSync(defaultMysqlAliyunFile(), "utf8"));
  vault.register(login.password);
  vault.register(mysql.password);
  return { login, mysql };
}
