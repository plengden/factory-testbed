import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

// Applies each migrations/NNNN_name.sql once, in order, each in its own transaction.
function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((row) => String(row.name)));
  const pending = readdirSync(MIGRATIONS_DIR).filter((f) => MIGRATION_NAME.test(f) && !applied.has(f)).sort();
  for (const name of pending) {
    const sql = readFileSync(new URL(name, MIGRATIONS_DIR), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
