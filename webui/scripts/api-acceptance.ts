import { buildServer } from "../server/index";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const projectRoot = process.env.KTX_PROJECT_ROOT ?? "/Users/forrest/Projects/project-lucy";
process.env.KTX_PROJECT_ROOT = projectRoot;
process.env.POSTHOG_DISABLED = "1";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function request<T>(
  app: ReturnType<typeof buildServer>,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown
): Promise<Envelope<T>> {
  const response = await app.inject({
    method,
    url,
    payload
  });
  return response.json() as Envelope<T>;
}

async function ok<T>(
  app: ReturnType<typeof buildServer>,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown
): Promise<T> {
  const body = await request<T>(app, method, url, payload);
  assert(body.ok, `${method} ${url} failed: ${body.ok === false ? body.error.message : "unknown error"}`);
  return body.data;
}

async function main() {
  const app = buildServer();
  await app.ready();

  try {
    const project = await ok<{ connections: Array<Record<string, unknown>> }>(app, "GET", "/api/project");
    assert(project.connections.every((connection) => !Object.hasOwn(connection, "password")), "/api/project leaked password");

    const sources = await ok<{ tables: Array<{ schema: string; table: string }> }>(app, "GET", "/api/sources");
    assert(sources.tables.length > 0, "/api/sources returned no tables");
    assert(sources.tables.some((source) => source.schema === "openclaw_db" && source.table === "customers"), "customers source missing");

    const customers = await ok<{ rawYaml: string; model: { columns: unknown[] } }>(
      app,
      "GET",
      "/api/sources/mysql-aliyun/openclaw_db/customers"
    );
    assert(customers.model.columns.length > 0, "customers has no columns");
    assert(customers.rawYaml.includes('"on"'), "customers raw YAML did not preserve quoted on");

    const dryRun = await ok<{ diff: string }>(app, "PUT", "/api/sources/mysql-aliyun/openclaw_db/customers", {
      dryRun: true,
      patch: {
        columns: [{ name: "customer_id", description: "API acceptance dry-run description." }],
        grain: ["customer_id"]
      }
    });
    assert(dryRun.diff.includes("API acceptance dry-run description"), "dryRun diff did not include edited description");

    const save = await ok<{ written: boolean; validation: { ok: boolean }; changedFiles: unknown[] }>(
      app,
      "PUT",
      "/api/sources/mysql-aliyun/yihe_poc_demo/accrual_demo",
      {
        dryRun: false,
        patch: {
          grain: ["date", "hospital"],
          measures: [{ name: "total_amount", expr: "sum(amount)", description: "Total accrued amount." }],
          segments: [{ name: "positive_amount", expr: "amount > 0", description: "Rows with positive accrued amount." }]
        }
      }
    );
    assert(save.written, "dryRun:false did not report written=true");
    assert(save.validation.ok, "ktx validate did not pass after save");

    const diff = await ok<{ files: unknown[] }>(app, "GET", "/api/diff");
    assert(Array.isArray(diff.files), "/api/diff did not return files array");

    const validateChanged = await ok<{ results: Array<{ validation: { ok: boolean } }> }>(app, "POST", "/api/validate-changed", {});
    assert(validateChanged.results.length > 0, "validate-changed returned no session sources");
    assert(validateChanged.results.every((result) => result.validation.ok), "validate-changed had a failed validation");

    const candidatesPayload = {
      candidates: [
        {
          conn: "mysql-aliyun",
          schema: "openclaw_db",
          fromTable: "orders",
          join: {
            to: "customers",
            on: "orders.customer_id = customers.customer_id",
            relationship: "many_to_one",
            source: "candidate"
          },
          confidence: "candidate",
          note: "M4 acceptance candidate sidecar check"
        }
      ]
    };
    const candidates = await ok<{ candidates: unknown[] }>(app, "PUT", "/api/joins/candidates", candidatesPayload);
    assert(candidates.candidates.length === 1, "join candidate sidecar write failed");

    const wikiPayload = {
      dryRun: false,
      frontmatter: {
        summary: "M5 acceptance wiki page",
        tags: ["acceptance", "m5"],
        sl_refs: ["mysql-aliyun/yihe_poc_demo/accrual_demo"],
        usage_mode: "acceptance"
      },
      content: "# M5 Acceptance\n\nCreated through the WebUI wiki API to verify frontmatter and markdown persistence.\n"
    };
    await ok(app, "PUT", "/api/wiki/global%2Fm5-acceptance.md", wikiPayload);
    const wiki = await ok<{ frontmatter: { summary?: string }; content: string }>(app, "GET", "/api/wiki/global%2Fm5-acceptance.md");
    assert(wiki.frontmatter.summary === "M5 acceptance wiki page", "wiki frontmatter did not round-trip");
    assert(wiki.content.includes("# M5 Acceptance"), "wiki markdown did not round-trip");

    const forbiddenSource = await request(app, "PUT", "/api/sources/bad..conn/yihe_poc_demo/accrual_demo", {
      dryRun: false,
      patch: { tableDescription: "bad" }
    });
    assert(!forbiddenSource.ok && forbiddenSource.error.code === "FORBIDDEN_PATH", "unsafe source path was not rejected");

    const forbiddenWiki = await request(app, "PUT", "/api/wiki/..%2Fraw-sources%2Fa.md", {
      dryRun: true,
      content: "bad"
    });
    assert(!forbiddenWiki.ok && forbiddenWiki.error.code === "FORBIDDEN_PATH", "unsafe wiki key was not rejected");

    console.log(`API acceptance passed against ${projectRoot}`);
    console.log(`sources=${sources.tables.length}, changedFiles=${save.changedFiles.length}, validates=${validateChanged.results.length}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
