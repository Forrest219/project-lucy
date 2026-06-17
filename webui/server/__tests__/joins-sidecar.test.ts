import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJoinCandidates, writeJoinCandidates } from "../joins-sidecar";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-joins-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("join candidate sidecar", () => {
  it("stores candidate joins only in .ktx-ui sidecar", async () => {
    const data = await writeJoinCandidates(projectRoot, [
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
        note: "inferred"
      }
    ]);

    expect(data.candidates).toHaveLength(1);
    await expect(readJoinCandidates(projectRoot)).resolves.toEqual(data);
    await expect(readFile(path.join(projectRoot, ".ktx-ui", "join-candidates.json"), "utf8")).resolves.toContain("orders.customer_id");
    await expect(readFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "orders.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
