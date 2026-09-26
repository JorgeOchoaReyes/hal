import "server-only";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * Persistence abstraction. Two backends behind one interface:
 *  - SQLite (default) via Node's built-in `node:sqlite` — a real embedded DB,
 *    no native module to compile, survives concurrent use.
 *  - JSON files (fallback) — used if `node:sqlite` is unavailable or HAL_DB=json.
 *
 * Everything is stored as (kind, id) → JSON document, ordered by created_at.
 */
export interface Persistence {
  readonly backend: "sqlite" | "json";
  loadAll<T extends { id: string }>(kind: string): T[];
  put(kind: string, id: string, data: unknown, createdAt?: number): void;
  remove(kind: string, id: string): boolean;
}

const KINDS = ["testcases", "results", "accounts", "agents", "targets", "byotkeys"] as const;

// --- SQLite backend ----------------------------------------------------------

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

function tryOpenSqlite(dbPath: string): DatabaseSyncLike | null {
  try {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => DatabaseSyncLike;
    };
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE IF NOT EXISTS store (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, id))",
    );
    return db;
  } catch {
    return null;
  }
}

class SqlitePersistence implements Persistence {
  readonly backend = "sqlite" as const;
  constructor(private readonly db: DatabaseSyncLike) {}

  loadAll<T extends { id: string }>(kind: string): T[] {
    const rows = this.db
      .prepare("SELECT data FROM store WHERE kind = ? ORDER BY created_at ASC")
      .all(kind) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as T);
  }
  put(kind: string, id: string, data: unknown, createdAt = Date.now()): void {
    this.db
      .prepare(
        "INSERT INTO store (kind, id, data, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data",
      )
      .run(kind, id, JSON.stringify(data), createdAt);
  }
  remove(kind: string, id: string): boolean {
    const res = this.db.prepare("DELETE FROM store WHERE kind = ? AND id = ?").run(kind, id) as {
      changes?: number;
    };
    return (res.changes ?? 0) > 0;
  }
}

// --- JSON backend (fallback) -------------------------------------------------

class JsonPersistence implements Persistence {
  readonly backend = "json" as const;
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private file(kind: string) {
    return join(this.dir, `${kind}.json`);
  }
  loadAll<T extends { id: string }>(kind: string): T[] {
    try {
      const f = this.file(kind);
      return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T[]) : [];
    } catch {
      return [];
    }
  }
  put(kind: string, id: string, data: unknown): void {
    const rows = this.loadAll<{ id: string }>(kind).filter((r) => r.id !== id);
    rows.push(data as { id: string });
    this.write(kind, rows);
  }
  remove(kind: string, id: string): boolean {
    const rows = this.loadAll<{ id: string }>(kind);
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return false;
    this.write(kind, next);
    return true;
  }
  private write(kind: string, rows: unknown[]) {
    try {
      writeFileSync(this.file(kind), JSON.stringify(rows, null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[hal] JSON persist failed", err);
    }
  }
}

/** Create the persistence backend for a data directory. */
export function createPersistence(dataDir: string): Persistence {
  mkdirSync(dataDir, { recursive: true });
  if (process.env.HAL_DB !== "json") {
    const db = tryOpenSqlite(join(dataDir, "hal.db"));
    if (db) return new SqlitePersistence(db);
  }
  return new JsonPersistence(dataDir);
}

export { KINDS };
