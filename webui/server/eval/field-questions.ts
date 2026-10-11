import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getEvalDb } from "./db.js";
import { INFERRED_TURN_SPLIT_THRESHOLD } from "./offline-batch.js";

export type FieldCall = {
  tool: string;
  outcome: string;
  decisionReason?: string;
  sourceMapVersion?: string;
  measures?: string[];
  dimensions?: string[];
  filterFields?: string[];
  inferredTurnId?: string;
  inferredTurnCallCount?: number;
  roleIds?: string[];
  seenOn: string;
};

export type FieldPack = {
  domain: string;
  completeness?: { complete?: boolean };
  calls?: FieldCall[];
};

type Group = {
  sourceMapVersion: string;
  shapeHash: string;
  failureClass: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  roleIds: string[];
  measures: string[];
};

function shapeHash(call: FieldCall): string {
  const body = {
    measures: [...(call.measures ?? [])].sort(),
    dimensions: [...(call.dimensions ?? [])].sort(),
    filterFields: [...(call.filterFields ?? [])].sort()
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function isDenied(call: FieldCall): boolean {
  const reason = call.decisionReason ?? "";
  return call.outcome === "denied" || reason.includes("forbidden") || reason.startsWith("denied");
}

export function splitInferredTurns(calls: FieldCall[]): FieldCall[] {
  const byTurn = new Map<string, FieldCall[]>();
  const loose: FieldCall[] = [];
  for (const call of calls) {
    if (!call.inferredTurnId) {
      loose.push(call);
      continue;
    }
    const list = byTurn.get(call.inferredTurnId) ?? [];
    list.push(call);
    byTurn.set(call.inferredTurnId, list);
  }
  const kept = [...loose];
  for (const group of byTurn.values()) {
    const count = group[0]?.inferredTurnCallCount ?? group.length;
    if (count === 0) continue;
    if (count > INFERRED_TURN_SPLIT_THRESHOLD) {
      kept.push(...group);
      continue;
    }
    kept.push(...group);
  }
  return kept;
}

export function extractFieldQuestionGroups(pack: FieldPack): { refused?: string; groups: Group[] } {
  if (pack.completeness?.complete !== true) {
    return { refused: "这份日志不完整，未抽取", groups: [] };
  }
  const calls = splitInferredTurns(pack.calls ?? []).filter((call) => (
    call.tool === "lucy_query" && call.outcome !== "ok" && !isDenied(call) && call.sourceMapVersion
  ));
  const groups = new Map<string, Group>();
  for (const call of calls) {
    const failureClass = call.decisionReason || call.outcome;
    const key = `${call.sourceMapVersion}|${shapeHash(call)}|${failureClass}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        sourceMapVersion: call.sourceMapVersion!,
        shapeHash: shapeHash(call),
        failureClass,
        count: 1,
        firstSeen: call.seenOn,
        lastSeen: call.seenOn,
        roleIds: call.roleIds ?? [],
        measures: call.measures ?? []
      });
      continue;
    }
    existing.count += 1;
    if (call.seenOn < existing.firstSeen) existing.firstSeen = call.seenOn;
    if (call.seenOn > existing.lastSeen) existing.lastSeen = call.seenOn;
  }
  return { groups: [...groups.values()].filter((group) => group.count >= 2) };
}

function ensureTable(db: { exec: (sql: string) => void }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS field_question (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_map_version TEXT NOT NULL,
      shape_hash TEXT NOT NULL,
      failure_class TEXT NOT NULL,
      hit_count INTEGER NOT NULL,
      first_seen_on TEXT NOT NULL,
      last_seen_on TEXT NOT NULL,
      role_ids_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    )
  `);
}

export function registerFieldQuestionRoutes(app: FastifyInstance): void {
  app.get("/api/eval/field-questions", async () => {
    const db = await getEvalDb();
    ensureTable(db);
    const rows = db.prepare("SELECT * FROM field_question ORDER BY updated_at DESC").all();
    return { ok: true, data: { questions: rows } };
  });

  app.post<{ Body: FieldPack }>("/api/eval/field-questions/extract", async (request, reply) => {
    const extracted = extractFieldQuestionGroups(request.body);
    if (extracted.refused) {
      return reply.status(422).send({ ok: false, error: { message: extracted.refused } });
    }
    const db = await getEvalDb();
    ensureTable(db);
    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO field_question (
        id, created_at, updated_at, domain, source_map_version, shape_hash, failure_class,
        hit_count, first_seen_on, last_seen_on, role_ids_json, summary, status, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        hit_count = excluded.hit_count,
        last_seen_on = excluded.last_seen_on,
        summary = excluded.summary
    `);
    for (const group of extracted.groups) {
      const id = createHash("sha256").update(`${request.body.domain}|${group.sourceMapVersion}|${group.shapeHash}|${group.failureClass}`).digest("hex").slice(0, 16);
      const measure = group.measures[0] ?? "指标";
      upsert.run(
        id,
        now,
        now,
        request.body.domain,
        group.sourceMapVersion,
        group.shapeHash,
        group.failureClass,
        group.count,
        group.firstSeen,
        group.lastSeen,
        JSON.stringify(group.roleIds),
        `查 ${measure} 时，${group.failureClass}`,
        JSON.stringify({ measures: group.measures })
      );
    }
    return { ok: true, data: { inserted: extracted.groups.length } };
  });

  app.post<{ Params: { id: string } }>("/api/eval/field-questions/:id/promote", async (request, reply) => {
    const db = await getEvalDb();
    ensureTable(db);
    const row = db.prepare("SELECT * FROM field_question WHERE id = ?").get(request.params.id) as {
      evidence_json: string;
      failure_class: string;
    } | undefined;
    if (!row) return reply.status(404).send({ ok: false, error: { message: "现场提问不存在" } });
    const evidence = JSON.parse(row.evidence_json) as { measures?: string[] };
    return {
      ok: true,
      data: {
        draft: {
          question: "",
          review_status: "active",
          executable: {
            required_measures: evidence.measures ?? [],
            grain: [],
            required_columns: evidence.measures ?? [],
            required_filters: []
          }
        }
      }
    };
  });
}
