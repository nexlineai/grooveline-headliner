// A D1 stand-in over node:sqlite, so the paywall's real queries and the real migration run in the unit tests.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
class Stmt {
  private args: unknown[] = [];
  private db: DatabaseSync;
  private sql: string;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T = Row>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...(this.args as never[])) as T | undefined) ?? null; }
  async all<T = Row>() { return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] }; }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../migrations/0001_players.sql", import.meta.url), "utf8"));
  return { prepare: (sql: string) => new Stmt(db, sql), raw: db };
}
