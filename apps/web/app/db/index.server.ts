import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dbPath } from "~/lib/config.server";
import * as schema from "./schema";

/**
 * Migrations run automatically on startup — upgrading an instance is
 * `docker compose pull && up`, never a manual migrate step. This module is a
 * singleton, so they run exactly once per process, before the first query.
 */
function connect() {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: "./drizzle" });
  return database;
}

// Vite dev-server module reloads would otherwise open a new connection (and
// re-run migrations) on every change.
const globalForDb = globalThis as unknown as { __substratumDb?: ReturnType<typeof connect> };

export const db = (globalForDb.__substratumDb ??= connect());
export { schema };
