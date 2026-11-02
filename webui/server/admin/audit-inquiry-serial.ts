import Database from "better-sqlite3";

const HIGH_WATER_KEY = "high_water";
const BACKFILL_COMPLETE_KEY = "backfill_complete";
const FAIL_CLOSED_MESSAGE = "inquiry serial backfill failed closed: numbers exist without backfill_complete marker";

type BackfillRow = {
  source: "reported" | "inferred";
  correlationKey: string;
  sortTime: string;
};

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function tableExists(database: Database.Database, table: string): boolean {
  const row = database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
  return row !== undefined;
}

function setMeta(database: Database.Database, key: string, value: string): void {
  database.prepare(`
    INSERT INTO inquiry_serial_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function hasBackfillMarker(database: Database.Database): boolean {
  const row = database.prepare(`SELECT 1 FROM inquiry_serial_meta WHERE key = ?`).get(BACKFILL_COMPLETE_KEY);
  return row !== undefined;
}

function readHighWater(database: Database.Database): number {
  const row = database.prepare(`SELECT value FROM inquiry_serial_meta WHERE key = ?`).get(HIGH_WATER_KEY) as { value: string } | undefined;
  if (!row) return 0;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasPartialSerials(database: Database.Database): boolean {
  const mapRow = database.prepare(`SELECT 1 FROM inquiry_correlation_serial LIMIT 1`).get();
  if (mapRow) return true;
  if (tableExists(database, "conversation_turns")) {
    const reported = database.prepare(`SELECT 1 FROM conversation_turns WHERE inquiry_no IS NOT NULL LIMIT 1`).get();
    if (reported) return true;
  }
  if (tableExists(database, "inferred_turns")) {
    const inferred = database.prepare(`SELECT 1 FROM inferred_turns WHERE inquiry_no IS NOT NULL LIMIT 1`).get();
    if (inferred) return true;
  }
  return false;
}

function loadBackfillRows(database: Database.Database): BackfillRow[] {
  const rows: BackfillRow[] = [];
  if (tableExists(database, "conversation_turns")) {
    const reported = database.prepare(`SELECT turn_id, created_at FROM conversation_turns`).all() as Array<{ turn_id: string; created_at: string }>;
    for (const row of reported) {
      rows.push({ source: "reported", correlationKey: row.turn_id, sortTime: row.created_at });
    }
  }
  if (tableExists(database, "inferred_turns")) {
    const inferred = database.prepare(`SELECT inferred_turn_id, started_at FROM inferred_turns`).all() as Array<{ inferred_turn_id: string; started_at: string }>;
    for (const row of inferred) {
      rows.push({ source: "inferred", correlationKey: row.inferred_turn_id, sortTime: row.started_at });
    }
  }
  rows.sort((left, right) => {
    if (left.sortTime < right.sortTime) return -1;
    if (left.sortTime > right.sortTime) return 1;
    if (left.correlationKey < right.correlationKey) return -1;
    if (left.correlationKey > right.correlationKey) return 1;
    return 0;
  });
  return rows;
}

export function ensureInquirySerialSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiry_serial_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inquiry_correlation_serial (
      correlation_key TEXT PRIMARY KEY,
      inquiry_no INTEGER NOT NULL UNIQUE
    );
  `);
  if (tableExists(db, "conversation_turns")) {
    ensureColumn(db, "conversation_turns", "inquiry_no", "INTEGER");
  }
  if (tableExists(db, "inferred_turns")) {
    ensureColumn(db, "inferred_turns", "inquiry_no", "INTEGER");
  }
}

export function lookupInquiryNo(db: Database.Database, correlationKey: string): number | null {
  ensureInquirySerialSchema(db);
  const row = db.prepare(`
    SELECT inquiry_no FROM inquiry_correlation_serial WHERE correlation_key = ?
  `).get(correlationKey) as { inquiry_no: number } | undefined;
  return row?.inquiry_no ?? null;
}

export function allocateInquiryNo(db: Database.Database, correlationKey: string): number {
  ensureInquirySerialSchema(db);
  const issue = (): number => {
    const existing = lookupInquiryNo(db, correlationKey);
    if (existing != null) return existing;
    const next = readHighWater(db) + 1;
    db.prepare(`
      INSERT INTO inquiry_correlation_serial (correlation_key, inquiry_no) VALUES (?, ?)
    `).run(correlationKey, next);
    setMeta(db, HIGH_WATER_KEY, String(next));
    return next;
  };
  if (db.inTransaction) return issue();
  return db.transaction(issue).immediate();
}

export function resolveTurnCorrelationKey(db: Database.Database, turnIdOrSerial: string): string | null {
  ensureInquirySerialSchema(db);
  const raw = turnIdOrSerial.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const row = db.prepare(`
      SELECT correlation_key FROM inquiry_correlation_serial WHERE inquiry_no = ?
    `).get(Number(raw)) as { correlation_key: string } | undefined;
    return row?.correlation_key ?? null;
  }
  const mapped = db.prepare(`
    SELECT correlation_key FROM inquiry_correlation_serial WHERE correlation_key = ?
  `).get(raw) as { correlation_key: string } | undefined;
  if (mapped) return mapped.correlation_key;
  if (tableExists(db, "conversation_turns")) {
    const reported = db.prepare(`SELECT turn_id FROM conversation_turns WHERE turn_id = ?`).get(raw) as { turn_id: string } | undefined;
    if (reported) return reported.turn_id;
  }
  if (tableExists(db, "inferred_turns")) {
    const inferred = db.prepare(`SELECT inferred_turn_id FROM inferred_turns WHERE inferred_turn_id = ?`).get(raw) as { inferred_turn_id: string } | undefined;
    if (inferred) return inferred.inferred_turn_id;
  }
  return null;
}

export function backfillInquirySerials(db: Database.Database): void {
  ensureInquirySerialSchema(db);
  const apply = db.transaction(() => {
    if (hasBackfillMarker(db)) return;
    if (hasPartialSerials(db)) throw new Error(FAIL_CLOSED_MESSAGE);
    const rows = loadBackfillRows(db);
    const insertMap = db.prepare(`
      INSERT INTO inquiry_correlation_serial (correlation_key, inquiry_no) VALUES (?, ?)
    `);
    const updateReported = tableExists(db, "conversation_turns")
      ? db.prepare(`UPDATE conversation_turns SET inquiry_no = ? WHERE turn_id = ?`)
      : null;
    const updateInferred = tableExists(db, "inferred_turns")
      ? db.prepare(`UPDATE inferred_turns SET inquiry_no = ? WHERE inferred_turn_id = ?`)
      : null;
    rows.forEach((row, index) => {
      const inquiryNo = index + 1;
      insertMap.run(row.correlationKey, inquiryNo);
      if (row.source === "reported") updateReported?.run(inquiryNo, row.correlationKey);
      else updateInferred?.run(inquiryNo, row.correlationKey);
    });
    setMeta(db, HIGH_WATER_KEY, String(rows.length));
    setMeta(db, BACKFILL_COMPLETE_KEY, "1");
  });
  apply();
}

export function ensureBackfillBeforeAllocate(db: Database.Database): void {
  backfillInquirySerials(db);
}

/** Attach the durable inquiry number for a turn insert. Caller owns the write transaction. */
export function withAllocatedInquiryNo<T extends object>(
  db: Database.Database,
  correlationKey: string,
  fields: T
): T & { inquiryNo: number } {
  ensureBackfillBeforeAllocate(db);
  return { ...fields, inquiryNo: allocateInquiryNo(db, correlationKey) };
}
