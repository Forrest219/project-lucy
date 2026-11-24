/**
 * Reachable MySQL inside the Lucy demo compose network.
 * Password is the compose demo default (not a customer secret).
 */

export const DEMO_DB = {
  host: "demo-db",
  port: 3306,
  username: "root",
  password: "lucy_demo_root",
  database: "e2e_conn_reload",
  schema: "e2e_conn_reload",
  driver: "mysql"
} as const;

export function uniqueConnectionId(prefix = "e2e-conn-reload"): string {
  return `${prefix}-${Date.now().toString(36)}`;
}
