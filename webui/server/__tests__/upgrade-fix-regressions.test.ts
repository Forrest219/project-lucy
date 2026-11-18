import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import { it, expect, vi } from 'vitest';
import { createInferredTurnMaintainer } from '../admin/inferred-turn-maintainer.js';
import { previewSchemaStructure } from '../schema-structure.js';
vi.mock('../../src/lib/apiClient', async () => { const a = await vi.importActual<typeof import('../../src/lib/apiClient')>('../../src/lib/apiClient'); return { ...a, apiPost: vi.fn() }; });
import { apiPost } from '../../src/lib/apiClient';
import { readCheckedTableColumns } from '../../src/lib/prepareSchemaStructure';
it('repairs legacy complete states whose timestamp watermark covered a call never materialized', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE access_log(id INTEGER PRIMARY KEY,ts TEXT,user_id TEXT);CREATE INDEX idx_al_user_ts ON access_log(user_id,ts);CREATE TABLE inferred_rebuild_state(user_id TEXT PRIMARY KEY,status TEXT,watermark TEXT,watermark_id INTEGER,updated_at TEXT);`);
    const older = new Date(Date.now() - 3600000).toISOString(), newer = new Date(Date.now() - 60000).toISOString();
    db.prepare('INSERT INTO access_log VALUES(?,?,?)').run(1, older, 'legacy-user');
    db.prepare('INSERT INTO access_log VALUES(?,?,?)').run(2, newer, 'legacy-user');
    // Existing ff4762c9 completed row; ALTER TABLE watermark_id leaves this NULL.
    db.prepare('INSERT INTO inferred_rebuild_state VALUES(?,?,?,?,?)').run('legacy-user', 'complete', newer, null, newer);
    const rebuilt: string[] = [];
    try {
        await createInferredTurnMaintainer({ getDb: async () => db, rebuild: async (u) => { rebuilt.push(u); } }).catchUp();
        console.log('LEGACY_STATE', JSON.stringify({ state: db.prepare('SELECT * FROM inferred_rebuild_state').get(), rebuilt }));
        expect(rebuilt).toContain('legacy-user');
    }
    finally {
        db.close();
    }
});
it('allows the real table-preparation client to finish valid wide tables after budget deferrals', async () => {
    const names = Array.from({ length: 50 }, (_, i) => 't' + i);
    let tick = 0, calls = 0, sqlCount = 0;
    const channel = { close() { }, async run(sql: string, options: {
            maxRows: number;
        }) {
            sqlCount++;
            tick += 6000;
            if (sql.includes('FROM information_schema.tables'))
                return { rows: names.map(n => [n]), truncated: false };
            const selected = [...sql.matchAll(/'(t\d+)'/g)].map(m => m[1]);
            const rows = selected.flatMap(n => Array.from({ length: 400 }, (_, i) => [n, 'c' + i, 'int', 'YES', i === 0 ? 'PRI' : '', '']));
            return { rows: rows.slice(0, options.maxRows), truncated: rows.length >= options.maxRows };
        } };
    vi.mocked(apiPost).mockImplementation(async (_route: string, body: any) => { calls++; const result = await previewSchemaStructure('/project', 'demo', 's', { tables: body.tables, mode: 'per-table', readConnectionsImpl: async () => [{ id: 'demo', driver: 'mysql', engine: 'mysql', wireProtocol: 'mysql', database: 's', schemas: ['s'], enabledTables: [] }], openChannelImpl: async () => channel, callBudgetMs: 10000, now: () => tick }); console.log('BUDGET_PREVIEW', JSON.stringify({ calls, sqlCount, tick, tableCount: result.tableCount, columnCount: result.columnCount, deferred: result.deferred?.length })); return result as any; });
    try {
        const result = await readCheckedTableColumns('demo', 's', names);
        expect(result.tableCount).toBe(50);
        expect(result.columnCount).toBe(20_000);
        const tables = parseYaml(result.yaml).tables;
        expect(Object.keys(tables)).toEqual(names);
        for (const table of Object.values(tables) as any[]) expect(Object.keys(table.columns)).toHaveLength(400);
    }
    catch (e) {
        console.log('FRONTEND_LOAD_ERROR', String(e));
        throw e;
    }
});
it("bounds old-result reads while rebuilding an existing window", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await mkdtemp(path.join(os.tmpdir(), "rebuild-window-pages-"));
    vi.stubEnv("KTX_PROJECT_ROOT", root);
    vi.stubEnv("LUCY_CONTENT_ROOT", ".");
    vi.stubEnv("LUCY_AUDIT_DB", path.join(root, "audit.sqlite"));
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
    const audit = await import("../proxy/audit.js");
    const returned: number[] = [];
    const prepare = Database.prototype.prepare;
    try {
        for (let i = 0; i < 80; i++)
            await audit.writeLog({ ts: new Date(Date.now() - (80 - i) * 180000).toISOString(), userId: "window-user", tool: "lucy_query", outcome: "ok", durationMs: 1, requestId: "window-" + i });
        await audit.rebuildInferredTurns("window-user");
        const spy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (this: Database.Database, sql: string) {
            const statement = prepare.call(this, sql);
            if (!sql.includes("SELECT inferred_turn_id AS id FROM inferred_turns"))
                return statement;
            return new Proxy(statement, { get(target, key) { const v = Reflect.get(target, key); if (key === "all")
                    return (...params: unknown[]) => { const rows = target.all(params); returned.push(rows.length); return rows; }; return typeof v === "function" ? v.bind(target) : v; } });
        });
        try {
            await audit.rebuildInferredTurns("window-user");
        }
        finally {
            spy.mockRestore();
        }
        expect(returned.length).toBeGreaterThan(0);
        expect(Math.max(...returned)).toBeLessThanOrEqual(25);
        const db = new Database(path.join(root, "audit.sqlite"));
        try {
            expect((db.prepare("SELECT COUNT(*) n FROM inferred_turns WHERE user_id='window-user'").get() as {
                n: number;
            }).n).toBe(80);
        }
        finally {
            db.close();
        }
    }
    finally {
        audit.closeAuditDb();
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
    }
});

it('preserves a single-table budget deferral instead of silently reporting an empty success', async () => {
    let tick = 0;
    const preview = await previewSchemaStructure('/project', 'demo', 's', {
        tables: ['t0'], mode: 'per-table', callBudgetMs: 10_000, now: () => tick,
        readConnectionsImpl: async () => [{ id: 'demo', driver: 'mysql', engine: 'mysql', wireProtocol: 'mysql', database: 's', schemas: ['s'], enabledTables: [] }],
        openChannelImpl: async () => ({ close() {}, async run() { tick += 11_000; return { rows: [['t0']], truncated: false }; } })
    });
    expect(preview.deferred).toEqual(['t0']);
    expect(preview.columnCount).toBe(0);
});

it('continues valid tables and aggregates a rejection after adapting down to singleton batches', async () => {
    let tick = 0;
    const seen: string[] = [];
    const names = Array.from({ length: 30 }, (_, i) => 't' + i);
    vi.mocked(apiPost).mockImplementation(async (_route: string, body: any) => previewSchemaStructure('/project', 'demo', 's', {
        tables: body.tables, batchRead: body.batchRead, mode: 'per-table', callBudgetMs: 10_000, now: () => tick,
        readConnectionsImpl: async () => [{ id: 'demo', driver: 'mysql', engine: 'mysql', wireProtocol: 'mysql', database: 's', schemas: ['s'], enabledTables: [] }],
        openChannelImpl: async () => ({ close() {}, async run(sql: string, _options: { maxRows: number }) {
            tick += 6_000;
            const selected = [...sql.matchAll(/'(t\d+)'/g)].map(m => m[1]);
            if (sql.includes('FROM information_schema.tables')) return { rows: selected.map(n => [n]), truncated: false };
            if (selected.length > 1) return { rows: [], truncated: true };
            seen.push(selected[0]);
            if (selected[0] === 't0') throw new Error('permission denied');
            return { rows: [[selected[0], 'id', 'int', 'NO', 'PRI', '']], truncated: false };
        } })
    } as any) as any);
    await expect(readCheckedTableColumns('demo', 's', names)).rejects.toThrow('有 1 张表没有读到字段');
    expect(seen).toEqual(names);
});

it('never becomes ready solely because MCP startup took longer than 60 seconds', async () => {
    const { isWebuiReady, resetWebuiWarmupForTests, markWebuiWarmupComplete } = await import('../runtime/readiness.js');
    vi.useFakeTimers();
    try {
        resetWebuiWarmupForTests();
        vi.advanceTimersByTime(61_000);
        expect(isWebuiReady()).toBe(false);
        markWebuiWarmupComplete();
        expect(isWebuiReady()).toBe(true);
    } finally { resetWebuiWarmupForTests(); vi.useRealTimers(); }
});

it('preserves the inquiry and unique links when a cluster straddles the rolling cutoff', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const root = await mkdtemp(path.join(os.tmpdir(), 'rolling-inquiry-'));
    vi.stubEnv('KTX_PROJECT_ROOT', root); vi.stubEnv('LUCY_CONTENT_ROOT', '.'); vi.stubEnv('LUCY_AUDIT_DB', path.join(root, 'audit.sqlite'));
    await writeFile(path.join(root, 'ktx.yaml'), 'connections: {}\n');
    const audit = await import('../proxy/audit.js');
    const t = Date.now(), window = 30 * 86400000;
    const clock = vi.spyOn(Date, 'now');
    try {
        clock.mockReturnValue(t - 60000);
        for (const [i, ts] of [t - window - 30000, t - window + 30000].entries()) await audit.writeLog({ ts: new Date(ts).toISOString(), userId: 'rolling', tool: 'lucy_query', outcome: 'ok', durationMs: 1, requestId: 'rolling-' + i });
        await audit.rebuildInferredTurns('rolling');
        const db = new Database(path.join(root, 'audit.sqlite'));
        try {
            const before = db.prepare("SELECT inquiry_no FROM inferred_turns WHERE user_id='rolling'").get() as { inquiry_no: number };
            clock.mockReturnValue(t);
            await audit.writeLog({ ts: new Date(t).toISOString(), userId: 'rolling', tool: 'lucy_query', outcome: 'ok', durationMs: 1, requestId: 'rolling-new' });
            await audit.rebuildInferredTurns('rolling');
            expect(db.prepare('SELECT access_log_id, COUNT(*) n FROM inferred_turn_access_logs GROUP BY access_log_id ORDER BY access_log_id').all()).toEqual([{ access_log_id: 1, n: 1 }, { access_log_id: 2, n: 1 }, { access_log_id: 3, n: 1 }]);
            expect(db.prepare("SELECT inquiry_no,call_count FROM inferred_turns WHERE user_id='rolling' ORDER BY inquiry_no").all()).toEqual([{ inquiry_no: before.inquiry_no, call_count: 2 }, { inquiry_no: before.inquiry_no + 1, call_count: 1 }]);
        } finally { db.close(); }
    } finally { clock.mockRestore(); audit.closeAuditDb(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});

it('lets a one-cluster write slice grow again when disk latency recovers', async () => {
    const { nextSliceSize } = await import('../admin/page-budget.js');
    expect(nextSliceSize(1, 1, 1, 4)).toBe(2);
    expect(nextSliceSize(1, 3000, 1, 4)).toBe(1);
});

it('probes covered users without sorting their entire recent log window', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE access_log(id INTEGER PRIMARY KEY,ts TEXT,user_id TEXT); CREATE INDEX idx_al_user_ts ON access_log(user_id,ts); CREATE TABLE inferred_rebuild_state(user_id TEXT PRIMARY KEY,status TEXT,watermark_id INTEGER);');
    const ts = new Date().toISOString();
    for (let i = 1; i <= 100; i++) db.prepare('INSERT INTO access_log VALUES(?,?,?)').run(i, ts, 'covered');
    db.prepare("INSERT INTO inferred_rebuild_state VALUES('covered','complete',100)").run();
    const queries: string[] = [];
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => { if (sql.includes('FROM access_log WHERE user_id = ?')) queries.push(sql); return original(sql); }) as typeof db.prepare);
    try {
        await createInferredTurnMaintainer({ getDb: async () => db, rebuild: async () => { throw new Error('covered user should not rebuild'); } }).catchUp();
        spy.mockRestore();
        expect(queries.length).toBeGreaterThan(0);
        for (const sql of queries) {
            const args = ['covered', new Date(Date.now() - 86400000).toISOString(), 100].slice(0, (sql.match(/\?/g) ?? []).length);
            const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(args) as Array<{detail: string}>;
            expect(plan.map(row => row.detail).join('\n')).not.toContain('TEMP B-TREE');
        }
    } finally { spy.mockRestore(); db.close(); }
});

it('bounds link inserts and removals even when every call belongs to one large cluster', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os'), path = await import('node:path');
    const root = await mkdtemp(path.join(os.tmpdir(), 'large-inquiry-'));
    vi.stubEnv('KTX_PROJECT_ROOT', root); vi.stubEnv('LUCY_CONTENT_ROOT', '.'); vi.stubEnv('LUCY_AUDIT_DB', path.join(root, 'audit.sqlite'));
    await writeFile(path.join(root, 'ktx.yaml'), 'connections: {}\n');
    const audit = await import('../proxy/audit.js');
    const prepare = Database.prototype.prepare, transaction = Database.prototype.transaction;
    let inserts = 0, maxInserts = 0, maxRemoved = 0;
    let prepareSpy: ReturnType<typeof vi.spyOn> | undefined, transactionSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
        for (let i = 0; i < 100; i++) await audit.writeLog({ ts: new Date(Date.now() - 60000 + i).toISOString(), userId: 'dense', tool: 'lucy_query', outcome: 'ok', durationMs: 1, requestId: 'dense-' + i });
        await audit.rebuildInferredTurns('dense');
        prepareSpy = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function(this: Database.Database, sql: string) {
            const stmt = prepare.call(this, sql);
            return new Proxy(stmt, { get(target, key) {
                const value = Reflect.get(target, key);
                if (key === 'run' && /(?:INSERT INTO|DELETE FROM) inferred_turn_access_logs/.test(sql)) return (...params: unknown[]) => {
                    const result = target.run(params);
                    if (sql.includes('INSERT INTO')) inserts += Number(result.changes);
                    else maxRemoved = Math.max(maxRemoved, Number(result.changes));
                    return result;
                };
                return typeof value === 'function' ? value.bind(target) : value;
            } });
        });
        transactionSpy = vi.spyOn(Database.prototype, 'transaction').mockImplementation(function(this: Database.Database, fn: (...args: any[]) => any) {
            const txn = transaction.call(this, fn);
            return new Proxy(txn, { apply(target, context, args) { inserts = 0; try { return Reflect.apply(target, context, args); } finally { maxInserts = Math.max(maxInserts, inserts); } } });
        } as typeof Database.prototype.transaction);
        await audit.rebuildInferredTurns('dense');
        expect(maxInserts).toBeGreaterThan(0);
        expect(maxInserts).toBeLessThanOrEqual(32);
        expect(maxRemoved).toBeLessThanOrEqual(32);
        const db = new Database(path.join(root, 'audit.sqlite'));
        try {
            expect(db.prepare('SELECT COUNT(*) n FROM inferred_turn_access_logs').get()).toEqual({ n: 100 });
            expect(db.prepare('SELECT inquiry_no,call_count FROM inferred_turns').all()).toEqual([{ inquiry_no: 1, call_count: 100 }]);
        } finally { db.close(); }
    } finally { prepareSpy?.mockRestore(); transactionSpy?.mockRestore(); audit.closeAuditDb(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
