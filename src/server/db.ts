import fs from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { ANALYTICS_DB_PATH, DB_PATH, HISTORY_DB_PATH } from './config.ts';

export type DbRow = Record<string, unknown>;

export function withDatabase<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function withMainDb<T>(fn: (db: DatabaseSync) => T): T {
  return withDatabase(DB_PATH, fn);
}

export function withAnalyticsDb<T>(fn: (db: DatabaseSync) => T): T {
  return withDatabase(ANALYTICS_DB_PATH, fn);
}

export function withHistoryDb<T>(fn: (db: DatabaseSync) => T): T {
  return withDatabase(HISTORY_DB_PATH, fn);
}

export function queryAll(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): DbRow[] {
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ ...r }));
}

export function queryOne(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): DbRow | null {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  return row ? { ...row } : null;
}
