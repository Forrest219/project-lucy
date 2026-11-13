/**
 * 访问关系图「允许」词表。
 *
 * 现行审计写入（`webui/server/proxy/audit.ts`）成功调用是 `outcome='ok'`。
 * Spec 187 早期合同写的是 `outcome='allow'`。两词都进入 band E；
 * `denied`／`deny`／`error`／`budget_stop` 及其余值仍进拒绝计数。
 */
const ACCESS_MAP_ALLOWED_OUTCOMES = new Set(["ok", "allow"]);

export function isAccessMapAllowedOutcome(outcome: string | null | undefined): boolean {
  return outcome != null && ACCESS_MAP_ALLOWED_OUTCOMES.has(outcome);
}
