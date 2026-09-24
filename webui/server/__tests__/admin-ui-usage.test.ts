import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { navGroups } from "../../src/app/navigation";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import {
  UI_USAGE_GROUPS,
  UI_USAGE_MENUS,
  classifyUsagePathname,
  queryUiUsageOverview,
  recordUiPageView
} from "../admin/ui-usage";
import { resetAdminsCache } from "../auth/admins-store";
import { buildServer } from "../index";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousAuth: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ui-usage-"));
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousAuth = process.env.LUCY_WEBUI_AUTH;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  delete process.env.LUCY_WEBUI_AUTH;
  resetAuditDbForTests();
  resetAdminsCache();
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
});

afterEach(async () => {
  resetAuditDbForTests();
  resetAdminsCache();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
  else process.env.LUCY_WEBUI_AUTH = previousAuth;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("ui usage catalog", () => {
  it("matches sidebar menus and groups", () => {
    const menus = navGroups.flatMap((group) => group.items);
    expect(UI_USAGE_MENUS.map((item) => item.id)).toEqual(menus.map((item) => item.id));
    expect(UI_USAGE_MENUS.map((item) => item.label)).toEqual(menus.map((item) => item.label));
    expect(UI_USAGE_GROUPS.map((group) => [group.id, group.label])).toEqual(
      navGroups.map((group) => [group.id, group.title])
    );
  });

  it("rolls a table editor path into the catalog menu without keeping the raw path", () => {
    const classified = classifyUsagePathname("/catalog/mysql/dataforai/secret_orders");
    expect(classified).toEqual({
      kind: "page",
      page: expect.objectContaining({
        pageKey: "table-editor",
        menuId: "semantic-catalog",
        groupId: "semantic-modeling"
      })
    });
    expect(JSON.stringify(classified)).not.toContain("secret_orders");
  });

  it("treats redirect paths as redirects", () => {
    expect(classifyUsagePathname("/admin/governance").kind).toBe("redirect");
    expect(classifyUsagePathname("/sources/mysql/dataforai/secret_orders").kind).toBe("redirect");
  });
});

describe("ui usage recording", () => {
  it("aggregates a window and omits the raw path from the audit row", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    await recordUiPageView({
      pathname: "/catalog/mysql/dataforai/secret_orders",
      adminId: "owner",
      now
    });
    await recordUiPageView({
      pathname: "/not-a-page",
      adminId: "owner",
      now
    });
    await recordUiPageView({
      pathname: "/wiki",
      adminId: "other",
      now: new Date("2026-09-20T12:00:00.000Z")
    });

    const db = await getAuditDb();
    const columns = db.prepare("PRAGMA table_info(ui_page_views)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(["id", "ts", "admin_id", "page_key", "menu_id", "group_id"]);
    const stored = JSON.stringify(db.prepare("SELECT * FROM ui_page_views").all());
    expect(stored).not.toContain("secret_orders");
    expect(stored).not.toContain("/not-a-page");
    expect(stored).toContain("unknown");

    const queriedAt = new Date(now.getTime() + 1000);
    const recent = await queryUiUsageOverview(24, queriedAt);
    expect(recent.pageViews).toBe(2);
    expect(recent.visitorCount).toBe(1);
    expect(recent.unmappedViews).toBe(1);
    expect(recent.activeMenuCount).toBe(1);
    expect(recent.menus.find((row) => row.id === "semantic-catalog")?.visits).toBe(1);
    expect(recent.pages.find((row) => row.id === "table-editor")?.visits).toBe(1);
    expect(recent.pages.find((row) => row.id === "wiki")?.visits).toBe(0);
    expect(recent.groups.find((row) => row.id === "semantic-modeling")?.visits).toBe(1);
    expect(recent.pages.some((row) => row.id === "unknown")).toBe(false);

    const week = await queryUiUsageOverview(168, queriedAt);
    expect(week.pageViews).toBe(3);
    expect(week.visitorCount).toBe(2);
    expect(week.pages.find((row) => row.id === "wiki")?.visits).toBe(1);
  });

  it("records open mode as local-admin and rejects a logged-out required session", async () => {
    const app = buildServer();
    await app.ready();
    const open = await app.inject({
      method: "POST",
      url: "/api/admin/ui-usage/page-view",
      payload: { pathname: "/overview" }
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().data.recorded).toBe(true);
    await app.close();
    resetAuditDbForTests();

    const db = await getAuditDb();
    const row = db.prepare("SELECT admin_id, page_key FROM ui_page_views").get() as { admin_id: string; page_key: string };
    expect(row).toEqual({ admin_id: "local-admin", page_key: "overview" });

    process.env.LUCY_WEBUI_AUTH = "required";
    await writeFile(
      path.join(projectRoot, "webui", "config", "admins.yaml"),
      `version: "1"\nadmins:\n  - id: owner\n    display_name: Owner\n    password_hash: "unused"\n    role: owner\n    enabled: true\n    created_at: "2026-09-24T00:00:00.000Z"\n`,
      "utf8"
    );
    resetAdminsCache();
    const locked = buildServer();
    await locked.ready();
    const denied = await locked.inject({
      method: "POST",
      url: "/api/admin/ui-usage/page-view",
      payload: { pathname: "/overview?hours=24" }
    });
    expect(denied.statusCode).toBe(401);
    const invalid = await locked.inject({
      method: "POST",
      url: "/api/admin/ui-usage/page-view",
      headers: { cookie: "lucy_admin_session=nope" },
      payload: { pathname: "/overview?q=secret" }
    });
    expect(invalid.statusCode).toBe(401);
    expect(JSON.stringify(denied.json())).not.toContain("secret");
    await locked.close();
  });
});
