import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { stringify as yamlStringify } from "yaml";

const stringify = (value) => yamlStringify(value, { aliasDuplicateObjects: false });

/** Only extends a freshly prepared, runner-owned project. Never accepts a customer path. */
export function seedUpgradeFixture(run) {
  const root = run.paths.project;
  if (run.executionMode !== "local" || run.instance.startedBy !== "runner"
    || root !== path.join(run.paths.runDir, "project")) throw new Error("upgrade fixture requires a fresh local runner-owned project");
  const dbPath = path.join(root, "upgrade.sqlite");
  rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, region TEXT, amount INTEGER); INSERT INTO orders VALUES(1,'East',100),(2,'West',200),(3,'East',300); CREATE TABLE extra_orders(id INTEGER); INSERT INTO extra_orders VALUES(1); CREATE TABLE hidden_orders(id INTEGER); INSERT INTO hidden_orders VALUES(999);");
  const columns = [{ name: "id", type: "number" }, { name: "region", type: "string" }, { name: "amount", type: "number" }];
  const tables = { orders: { table: "main.orders", columns }, extra_orders: { table: "main.extra_orders", columns: [columns[0]] }, hidden_orders: { table: "main.hidden_orders", columns: [columns[0]] } };
  for (let i = 0; i < 301; i++) {
    const name = `empty_${String(i).padStart(3, "0")}`;
    db.exec(`CREATE TABLE ${name}(id INTEGER)`);
    tables[name] = { table: `main.${name}`, columns: [columns[0]] };
  }
  db.close();
  writeFileSync(path.join(root, "ktx.yaml"), stringify({
    connections: { "upgrade-db": { driver: "sqlite", path: dbPath, schemas: ["main"], readonly: true, enabled_tables: ["main.orders", "main.extra_orders"] } },
    storage: { state: "sqlite", search: "sqlite-fts5", git: { author: "Upgrade QA <qa@example.invalid>" } }
  }));
  rmSync(path.join(root, "semantic-layer"), { recursive: true, force: true });
  mkdirSync(path.join(root, "semantic-layer/upgrade-db/_schema"), { recursive: true });
  writeFileSync(path.join(root, "semantic-layer/upgrade-db/_schema/main.yaml"), stringify({ tables }));
  writeFileSync(path.join(root, "semantic-layer/upgrade-db/orders.yaml"), stringify({ name: "orders", grain: ["id"], measures: [{ name: "total_amount", expr: "sum(amount)" }, { name: "order_count", expr: "count(distinct id)" }] }));
  const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
  const tools = ["lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_begin_question", "wiki_search", "wiki_read", "lucy_skill_search", "lucy_skill_read", "connection_list"];
  const role = (names) => ({ permission_model_version: 2, allow: { connections: ["upgrade-db"], tableSelectors: [{ connection: "upgrade-db", schema: "main", names, row_access: "all" }], tools } });
  const roles = { finance_reader: role(["orders", "hidden_orders"]), sales_reader: role(["extra_orders"]), lucy_admin: { permission_model_version: 2, allow: { source_scope: "catalog_bound", connections: ["*"], tools } } };
  // Keep random credentials from prepare-environment, but make all role facts self-contained.
  const users = ["e2e_finance", "e2e_sales"].map((id) => ({ id, name: id, enabled: true, role: id === "e2e_finance" ? "finance_reader" : "sales_reader", tokens: [{ hash: `sha256:${createHash("sha256").update(tokens[id]).digest("hex")}`, label: "upgrade-fixture", created: "2026-10-20" }] }));
  if (users.length !== 2 || !tokens.e2e_finance || !tokens.e2e_sales) throw new Error("prepared fixture identities missing");
  writeFileSync(path.join(root, "webui/config/access.yaml"), stringify({ roles, users, defaults: { deny_tools: [] } }));
  rmSync(path.join(root, "wiki"), { recursive: true, force: true });
  mkdirSync(path.join(root, "wiki/finance"), { recursive: true });
  writeFileSync(path.join(root, "wiki/finance/upgrade.md"), "---\nallowed_roles: [finance_reader]\nversion: upgrade-v1\n---\n# 升级收入说明\n收入是已完成订单金额合计。UPGRADE_FINANCE_ONLY\n");
  writeFileSync(path.join(root, "wiki/finance/missing-acl.md"), "# 未授权内容\nUPGRADE_DEFAULT_DENY\n");
  mkdirSync(path.join(root, "evals/upgrade/eval"), { recursive: true });
  const cases = ["correct", "wrong", "unanswered"].map((id) => ({ id, case_type: "single_turn", question: `升级评测 ${id}`, expected_source: "semantic_layer", review_status: "active", as_of_binding: { kind: "business_period", period: "2026-10" }, executable: { required_measures: [id === "unanswered" ? "missing_measure" : "total_amount"], grain: [], required_columns: [id === "wrong" ? "missing_expected_column" : "total_amount"], required_filters: [] } }));
  writeFileSync(path.join(root, "evals/upgrade/eval/upgrade-eval-cases.yaml"), stringify({ lucy_eval_schema_version: 2, kind: "lucy_eval_suite", suite_id: "upgrade_v2", domain: "upgrade", title: "升级评测", cases }));
  mkdirSync(path.join(root, "skills/domains/upgrade"), { recursive: true });
  for (const [name, status, acl] of [
    ["upgrade-finance", "published", "roles_allowed: [finance_reader]\n"],
    ["upgrade-draft", "draft", "roles_allowed: [finance_reader]\n"],
    ["upgrade-disabled", "disabled", "roles_allowed: [finance_reader]\n"],
    ["upgrade-no-acl", "published", ""]
  ]) {
    writeFileSync(path.join(root, `skills/domains/upgrade/${name}.skill.md`), `---\nname: ${name}\ntitle: 升级技能 ${name}\ndomain: upgrade\nversion: 1.0.0\nstatus: ${status}\n${acl}triggers: [升级技能]\ndescription: 升级技能授权验证\n---\n# 升级技能\nUPGRADE_SKILL_${name}\n`);
  }
  for (const dir of ["semantic-layer", "wiki", "skills", "evals"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
    cpSync(path.join(root, dir), path.join(root, "config", dir), { recursive: true });
  }
  writeFileSync(path.join(root, "semantic-layer/upgrade-db/retired.yaml"), "name: retired\n");
  run.instance.env.LUCY_CONTENT_ROOT = path.join(root, "config");
  run.upgrade = { sqlitePath: dbPath, connection: "upgrade-db", expectedAmount: 600 };
  writeFileSync(path.join(run.paths.runDir, "run.json"), JSON.stringify(run, null, 2));
  return run;
}
