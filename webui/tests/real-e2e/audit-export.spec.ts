// SEC-18-V06, SEC-20-V01, SEC-20-V02, SEC-20-V06 — real audit page, real exports, reconciled against the
// events THIS run produced (Spec §6.5 step 8). Agents are driven over the real MCP endpoint with the fixture
// Tokens; the owner uses the real UI and its export links. Nothing is read from a mock.

import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { assertion, covers } from "./helpers/blocked";
import { fixtureAgentTokens, fixtureCanaries, mcpCall, ownerContext, parseCsv, readZipEntries, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

const rpc = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test.describe.configure({ mode: "serial" });

test("exports reconcile with the events of this run, the page, and the manifest", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-18-V06", "SEC-20-V01", "SEC-20-V02", "SEC-20-V06");
  const { runId } = runContext();
  const tokens = fixtureAgentTokens();
  const canaries = fixtureCanaries();
  const since = new Date(Date.now() - 1000).toISOString();

  // Events produced by this run: two allowed reads, one cross-domain denial, one formula-shaped argument.
  const formula = `=HYPERLINK("http://example.invalid/${runId}","x")`;
  const allowedA = await mcpCall(tokens.e2e_finance, rpc(1, "wiki_read", { path: "finance/cac-definition.md" }));
  const allowedB = await mcpCall(tokens.e2e_finance, rpc(2, "wiki_read", { path: "finance/cac-definition.md" }));
  const denied = await mcpCall(tokens.e2e_sales, rpc(3, "wiki_read", { path: "finance/cac-definition.md" }));
  const search = await mcpCall(tokens.e2e_finance, rpc(4, "wiki_search", { q: formula }));
  expect(allowedA.text.includes(canaries.financeWiki) && allowedB.text.includes(canaries.financeWiki)).toBe(true);
  expect(denied.text.includes(canaries.financeWiki)).toBe(false);
  expect(search.status).toBe(200);

  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const until = new Date(Date.now() + 60_000).toISOString();
    const filter = `since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&includeProtocol=true`;

    // The API view of the same window (what the page lists).
    const api = await page.request.get(new URL(`/api/admin/audit?${filter}&limit=500`, baseURL!).toString());
    expect(api.status()).toBe(200);
    const apiEntries = ((await api.json()) as { data: { entries: Array<{ id: number; userId: string; tool: string; outcome: string }> } }).data.entries;
    const financeReads = apiEntries.filter((e) => e.userId === "e2e_finance" && e.tool === "wiki_read");
    const salesDenied = apiEntries.filter((e) => e.userId === "e2e_sales" && e.tool === "wiki_read");
    assertion(testInfo, "audit_event", financeReads.length >= 2 && salesDenied.length >= 1, `API shows ${financeReads.length} finance reads and ${salesDenied.length} sales attempts for this window`);
    assertion(testInfo, "consistency", salesDenied.every((e) => e.outcome !== "ok"), `the cross-domain read is recorded as ${salesDenied.map((e) => e.outcome).join(",")}`);

    // The page itself shows the window (real UI, not just the API).
    await page.goto(`/admin/audit?view=calls&since=${encodeURIComponent(since)}`);
    await expect(page.getByTestId("audit-view-tabs")).toBeVisible();
    await expect(page.locator("body")).toContainText("e2e_finance");

    // CSV export through the real export link.
    const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export-current").click()]);
    const csvText = (await readStream(await csvDownload.createReadStream())).toString("utf8");
    const rows = parseCsv(csvText);
    const header = rows[0];
    const col = (name: string) => header.indexOf(name);
    expect(col("id")).toBeGreaterThanOrEqual(0);
    const csvIds = new Set(rows.slice(1).map((r) => Number(r[col("id")])));
    const missing = [...financeReads, ...salesDenied].filter((e) => !csvIds.has(e.id));
    assertion(testInfo, "consistency", missing.length === 0, `${missing.length} of this run's events are missing from the CSV`);

    // Formula-shaped data is neutralised in the CSV (SEC-20-V02).
    const dangerous = rows.slice(1).flatMap((r) => r).filter((cell) => /^[=+@]/.test(cell) || (/^-[A-Za-z(]/.test(cell)));
    assertion(testInfo, "no_leak", dangerous.length === 0, `${dangerous.length} unneutralised formula cell(s)`);
    assertion(testInfo, "consistency", !vault.contains(csvText), "no credential in the CSV");

    // Evidence pack: files, hashes and row counts must match the manifest (SEC-20-V06 / SEC-20-V01).
    const [zipDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export-pack").click()]);
    const zip = readZipEntries(await readStream(await zipDownload.createReadStream()));
    const manifestEntry = zip.find((e) => e.name === "manifest.json");
    expect(manifestEntry).toBeTruthy();
    const manifest = JSON.parse(manifestEntry!.data.toString("utf8")) as { files: Array<{ name: string; sha256: string; rowCount: number }>; completeness: { complete: boolean } };
    let manifestOk = manifest.files.length > 0;
    for (const file of manifest.files) {
      const entry = zip.find((e) => e.name === file.name);
      const actual = entry ? createHash("sha256").update(entry.data).digest("hex") : "";
      if (!entry || actual !== file.sha256) manifestOk = false;
      if (entry && file.name.endsWith(".csv")) {
        const dataRows = parseCsv(entry.data.toString("utf8")).length - 1;
        if (dataRows !== file.rowCount) manifestOk = false;
      }
    }
    assertion(testInfo, "consistency", manifestOk, `manifest lists ${manifest.files.length} files; hashes and row counts ${manifestOk ? "match" : "DO NOT match"}`);
    const packCsv = zip.find((e) => e.name === "access_log.csv");
    const packIds = new Set(parseCsv(packCsv?.data.toString("utf8") ?? "").slice(1).map((r) => Number(r[0])));
    assertion(testInfo, "consistency", [...financeReads, ...salesDenied].every((e) => packIds.has(e.id)), "the evidence pack contains the same events as the CSV");
    assertion(testInfo, "no_leak", !zip.some((e) => vault.contains(e.data.toString("utf8"))), "no credential in any exported file");
    expect(manifestOk).toBe(true);
  } finally {
    await context.close();
  }
});

async function readStream(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
