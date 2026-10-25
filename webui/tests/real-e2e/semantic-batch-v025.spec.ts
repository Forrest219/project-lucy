// SEM25 — the browser dimension of the W2-SEM responsibility branch (Plan §5.2).
//
// Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md §10
//   (V05, V06, V09, V16, V17, V20) — the semantic-asset write path, the publish
//   workbench action boundary and the authorization of the maintenance API.
// The semantic compiler and the ACL engine are NOT re-implemented here: this
//   spec drives the real /api/semantic-assets/* routes and the real publish
//   workbench page, and asserts their contract.
//
// covers() links the FROZEN catalog ids that the approved coverage manifest
//   assigns to the SEM branch and whose declared assertion tokens this spec's
//   assertions really evaluate
//   (scripts/e2e/contracts/v025-coverage.yaml → existingCatalogMappings).
//   SEM25-V01..V22 are NEW scenarios: they are not in the frozen catalog
//   (case-catalog.yaml is frozen and must not gain rows), so each test records
//   them in an `execution` annotation for the v0.25 result writer.
//
// NOT EXECUTED in the authoring environment — there is no prepared run instance
//   here. The command that runs it:
//   cd webui && LUCY_REAL_E2E_RUN=<runDir>/run.json \
//     npx playwright test --config playwright.real.config.ts tests/real-e2e/semantic-batch-v025.spec.ts
//   (the instance itself comes from scripts/e2e/prepare-environment.mjs).

import { expect, test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers } from "./helpers/blocked";
import { fixtureCanaries, ownerContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

test.describe.configure({ mode: "serial" });

/** Records the v0.25 execution ids this test is the browser dimension of. */
function execution(testInfo: TestInfo, ...ids: string[]): void {
  for (const id of ids) testInfo.annotations.push({ type: "execution", description: id });
}

/** A semantic overlay that parses but is not a legal asset (YAML top level is a scalar). */
const ILLEGAL_YAML = "just-a-string-not-a-mapping\n";

/** A legal semantic overlay for one table of the fixture connection. */
const LEGAL_OVERLAY = [
  "name: marketing_daily",
  "",
  "grain:",
  "  - day",
  "  - region",
  "  - channel",
  "",
  "measures:",
  "  - name: total_spend_cents",
  "    expr: sum(spend_cents)",
  "    description: 投放金额合计（分）。",
  ""
].join("\n");

type ValidateResponse = {
  ok?: boolean;
  data?: {
    valid?: boolean;
    validationId?: string;
    errors?: Array<{ code?: string; message?: string; filePath?: string }>;
    warnings?: Array<{ code?: string; message?: string }>;
  };
};

test("every semantic-asset read and write path refuses an anonymous or forged session and writes nothing", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-15-V01", "SEC-15-V02", "SEC-15-V03");
  execution(testInfo, "SEM25-V17", "SEM25-V09");
  blockUnless(testInfo, "lucy-http", "browser");

  const context = await ownerContext(browser);
  let before = "";
  try {
    const owner = await context.newPage();
    const releases = await owner.request.get(new URL("/api/semantic-assets/releases", baseURL!).toString());
    before = await releases.text();

    // The same endpoints, this time without a session and with a forged one.
    const anonPage = await browser.newPage();
    try {
      const calls: Array<{ method: string; url: string; body?: unknown }> = [
        { method: "GET", url: "/api/semantic-assets/releases" },
        { method: "POST", url: "/api/semantic-assets/validate", body: { files: [] } },
        { method: "POST", url: "/api/semantic-assets/publish", body: { validationId: "forged" } },
        { method: "POST", url: "/api/semantic-assets/reindex", body: {} },
        { method: "POST", url: "/api/semantic-assets/export", body: {} }
      ];
      const statuses: number[] = [];
      const bodies: string[] = [];
      for (const call of calls) {
        const res = await anonPage.request.fetch(new URL(call.url, baseURL!).toString(), {
          method: call.method,
          data: call.body,
          headers: { "content-type": "application/json" }
        });
        statuses.push(res.status());
        bodies.push(await res.text());
      }
      const refused = statuses.every((status) => status === 401 || status === 403 || status === 503);
      assertion(testInfo, "deny", refused, `anonymous semantic-asset calls -> ${statuses.join("/")}`);
      const canaries = Object.values(fixtureCanaries());
      const leaked = bodies.filter((body) => canaries.some((canary) => body.includes(canary)) || vault.contains(body));
      assertion(testInfo, "no_leak", leaked.length === 0, `${leaked.length}/${bodies.length} answers carried content or a credential`);

      // A forged session cookie is refused exactly like no session at all.
      const forged = await anonPage.request.get(new URL("/api/semantic-assets/releases", baseURL!).toString(), {
        headers: { cookie: "lucy_admin_session=forged-session-value" }
      });
      assertion(
        testInfo,
        "deny",
        forged.status() === 401 || forged.status() === 403 || forged.status() === 503,
        `a forged session -> ${forged.status()}`
      );
      const forgedBody = await forged.text();
      assertion(
        testInfo,
        "no_leak",
        !canaries.some((canary) => forgedBody.includes(canary)) && !vault.contains(forgedBody),
        "the refused answer carried content or a credential"
      );

      // Nothing was written: the committed release list is byte-identical.
      const after = await owner.request.get(new URL("/api/semantic-assets/releases", baseURL!).toString());
      const afterText = await after.text();
      assertion(testInfo, "no_side_effect", afterText === before, "the release list is unchanged after the refused calls");
      expect(statuses.every((status) => status === 401 || status === 403 || status === 503)).toBe(true);
    } finally {
      await anonPage.close();
    }
  } finally {
    await context.close();
  }
});

test("the publish workbench keeps its action boundary and stays behind the login wall", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-15-V04");
  execution(testInfo, "SEM25-V20", "SEM25-V16");
  blockUnless(testInfo, "lucy-http", "browser");

  // 1. an anonymous browser never reaches the workbench
  const anon = await browser.newPage();
  try {
    await anon.goto("/publish/workbench");
    await anon.waitForURL(/\/login/);
    const body = await anon.locator("body").innerText();
    assertion(testInfo, "deny", /登录|创建首个所有者/.test(body), "the anonymous browser is sent to the login wall");
  } finally {
    await anon.close();
  }

  // 2. an authorized operator gets the workbench, and the workbench exposes
  //    校验 / 整批同步 only — no upload and no export control.
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/publish/workbench");
    await expect(page.getByTestId("publish-workbench-layout")).toBeVisible();
    const validate = await page.getByTestId("workbench-validate").count();
    const publish = await page.getByTestId("workbench-publish-and-reindex").count();
    const sync = await page.getByTestId("workbench-sync-index").count();
    const hasValidateFlow = validate > 0 && publish > 0;
    const hasSyncFlow = sync > 0;
    assertion(
      testInfo,
      "allow_control",
      hasValidateFlow || hasSyncFlow,
      `the workbench exposes 校验/整批同步 (validate=${validate} publish=${publish} sync=${sync})`
    );
    const forbidden = await page.getByRole("button", { name: /上传|导出/ }).count();
    assertion(testInfo, "allow_control", forbidden === 0, `the workbench must not offer upload/export (found ${forbidden})`);
    expect(forbidden).toBe(0);
  } finally {
    await context.close();
  }
});

test("an illegal semantic batch is refused by validation and by publish, and the committed state does not move", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-15-V05", "SEC-15-FM-01");
  execution(testInfo, "SEM25-V05", "SEM25-V06");
  blockUnless(testInfo, "lucy-http", "browser");

  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const releasesUrl = new URL("/api/semantic-assets/releases", baseURL!).toString();
    const before = await (await page.request.get(releasesUrl)).text();

    // 1. the illegal file is refused by the validation gate, per file
    const invalid = await page.request.post(new URL("/api/semantic-assets/validate", baseURL!).toString(), {
      data: {
        files: [{ filename: "marketing_daily.yaml", content: ILLEGAL_YAML }],
        defaultConnectionId: "fin-db",
        defaultSchema: "analytics"
      }
    });
    const invalidBody = (await invalid.json()) as ValidateResponse;
    const invalidErrors = invalidBody.data?.errors ?? [];
    assertion(
      testInfo,
      "deny",
      invalidBody.data?.valid === false && invalidErrors.length > 0,
      `an illegal file must not validate (valid=${invalidBody.data?.valid})`
    );
    assertion(
      testInfo,
      "deny",
      invalidErrors.some((error) => error.code === "INVALID_MANIFEST" || error.code === "YAML_PARSE_FAILED"),
      `the refusal names the reason (${invalidErrors.map((error) => error.code).join(",")})`
    );

    // 2. publishing that validation is refused too
    const published = await page.request.post(new URL("/api/semantic-assets/publish", baseURL!).toString(), {
      data: { validationId: invalidBody.data?.validationId ?? "", confirmOverwrite: true }
    });
    assertion(
      testInfo,
      "deny",
      published.status() >= 400,
      `publishing a refused validation must fail -> ${published.status()}`
    );

    // 3. the committed state did not move
    const after = await (await page.request.get(releasesUrl)).text();
    assertion(testInfo, "no_side_effect", after === before, "the release list is unchanged after the refused batch");

    // 4. positive control: a legal overlay does validate (the gate is not a blanket refusal)
    const legal = await page.request.post(new URL("/api/semantic-assets/validate", baseURL!).toString(), {
      data: {
        files: [{ filename: "marketing_daily.yaml", content: LEGAL_OVERLAY }],
        defaultConnectionId: "fin-db",
        defaultSchema: "analytics"
      }
    });
    const legalBody = (await legal.json()) as ValidateResponse;
    assertion(
      testInfo,
      "allow_control",
      legalBody.data?.valid === true,
      `a legal overlay must validate (errors=${(legalBody.data?.errors ?? []).map((error) => error.code).join(",")})`
    );
    expect(legalBody.data?.valid).toBe(true);
  } finally {
    await context.close();
  }
});
