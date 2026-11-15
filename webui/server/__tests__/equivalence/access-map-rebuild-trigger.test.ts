/**
 * P1-33 / F-2 — the access map must not force a full inferred-turn rebuild of every user in
 * its window on every request. A user is rebuilt only when it has calls newer than what the
 * maintainer has already seen. (Legacy behaviour: `markDirty` for every window user, i.e. 67
 * delete+reinsert rebuilds per request on the customer-scale fixture.)
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { defaultEnsureInquiryRebuild } from "../../admin/access-map-echo";
import { bindInferredTurnMaintainer, createInferredTurnMaintainer } from "../../admin/inferred-turn-maintainer";

function setup() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL)");
  const add = (user: string, ts: string) => db.prepare("INSERT INTO access_log (ts, user_id) VALUES (?, ?)").run(ts, user);
  const base = Date.now() - 3600_000;
  const iso = (offsetSec: number) => new Date(base + offsetSec * 1000).toISOString();
  add("a", iso(1)); add("b", iso(2)); add("c", iso(3));
  const rebuilds: string[] = [];
  const maintainer = createInferredTurnMaintainer({ getDb: async () => db, rebuild: async (u) => { rebuilds.push(u); }, pollMs: 3_600_000 });
  bindInferredTurnMaintainer(maintainer);
  return { db, add, iso, rebuilds, maintainer };
}

afterEach(() => bindInferredTurnMaintainer(null));

describe("F-2 access-map rebuild trigger", () => {
  it("users with no new calls are NOT rebuilt, however often the map is requested", async () => {
    const { db, rebuilds, maintainer } = setup();
    await maintainer.catchUp();
    rebuilds.length = 0;
    for (let i = 0; i < 5; i += 1) {
      await defaultEnsureInquiryRebuild({ db, userIds: ["a", "b", "c"] });
      await maintainer.runPass();
    }
    expect(rebuilds).toEqual([]);
  });

  it("a user with a new call IS rebuilt (freshness is preserved), and only that user", async () => {
    const { db, add, iso, rebuilds, maintainer } = setup();
    await maintainer.catchUp();
    rebuilds.length = 0;
    add("b", iso(10));
    await defaultEnsureInquiryRebuild({ db, userIds: ["a", "b", "c"] });
    await maintainer.runPass();
    expect(rebuilds).toEqual(["b"]);
    rebuilds.length = 0;
    await defaultEnsureInquiryRebuild({ db, userIds: ["a", "b", "c"] });
    await maintainer.runPass();
    expect(rebuilds).toEqual([]); // the new call has been absorbed
  });

  it("without a bound maintainer it is a harmless no-op", async () => {
    const { db } = setup();
    bindInferredTurnMaintainer(null);
    await expect(defaultEnsureInquiryRebuild({ db, userIds: ["a"] })).resolves.toBeUndefined();
  });
});
