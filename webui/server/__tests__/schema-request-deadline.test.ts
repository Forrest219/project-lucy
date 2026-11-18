import { describe, expect, it, vi } from 'vitest';
import type { ConnectionInfo } from '../model.js';
import { readSchemaColumns } from '../schema-structure.js';

const hive: ConnectionInfo = { id: 'budget-hive', driver: 'mysql', engine: 'mysql', wireProtocol: 'mysql', database: 'hive_jd.app', schemas: ['app'], enabledTables: [] };

describe('schema API shared request deadline', () => {
  it('never publishes fields obtained after slow syntax retries exhausted the total deadline', async () => {
    let tick = 0;
    const calls: number[] = [];
    const read = await readSchemaColumns('/isolated', hive.id, 'app', {
      tables: ['orders'], callBudgetMs: 10_000, now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => ({close: vi.fn(), async run(_sql, options) {
        calls.push(options.timeoutMs); tick += 7_100;
        if (calls.length < 3) throw new Error('You have an error in your SQL syntax');
        return {rows: [['id', 'bigint', 'NO', 'PRI']], truncated: false};
      }})
    });
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.columns).toEqual([]);
    expect(read.rejections).toEqual([{table: 'orders', reason: 'timeout'}]);
    expect(calls[2]).toBeLessThan(6_000);
  });

  it('charges connection setup to the same budget as the field query', async () => {
    let tick = 0;
    const read = await readSchemaColumns('/isolated', hive.id, 'app', {
      tables: ['orders'], callBudgetMs: 10_000, now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => {tick += 12_000; return {close() {}, async run() {
        tick += 8_000; return {rows: [['id', 'bigint', 'NO', 'PRI']], truncated: false};
      }};}
    });
    expect(read.status === 'ok' && read.columns.length).toBe(0);
    expect(read.status === 'ok' && read.rejections).toEqual([{table: 'orders', reason: 'timeout'}]);
  });

  it('still reads a legal third syntax when fast rejections leave enough budget', async () => {
    let tick = 0, calls = 0;
    const read = await readSchemaColumns('/isolated', hive.id, 'app', {
      tables: ['orders'], callBudgetMs: 10_000, now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => ({close() {}, async run() {
        calls++; tick += calls < 3 ? 100 : 7_100;
        if (calls < 3) throw new Error('You have an error in your SQL syntax');
        return {rows: [['id', 'bigint', 'NO', 'PRI']], truncated: false};
      }})
    });
    expect(read.status === 'ok' && read.columns.map(c => c.column)).toEqual(['id']);
    expect(read.status === 'ok' && read.tables).toEqual(['orders']);
  });
});
