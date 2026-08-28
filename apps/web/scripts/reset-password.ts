/**
 * Password recovery for self-hosters: there is no email reset flow, so
 * the operator resets it on the server.
 *
 *   docker compose exec app pnpm reset-password
 *
 * Signing out every existing session is deliberate — if the password had to be
 * reset, any live session should be treated as suspect.
 */
import { createInterface } from "node:readline/promises";
import { hash } from "@node-rs/argon2";
import Database from "better-sqlite3";

const dbPath = process.env.SUBSTRATUM_DATA_DIR
  ? `${process.env.SUBSTRATUM_DATA_DIR}/library.db`
  : "./data/library.db";

const sqlite = new Database(dbPath);
const owner = sqlite.prepare("select id, email from owner limit 1").get() as
  | { id: string; email: string }
  | undefined;

if (!owner) {
  console.error(`No owner account exists yet in ${dbPath}. Open the app to create one.`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`Resetting the password for ${owner.email}.`);
const password = await rl.question("New password (min 10 characters): ");
rl.close();

if (password.length < 10) {
  console.error("Too short — nothing was changed.");
  process.exit(1);
}

sqlite
  .prepare("update owner set password_hash = ? where id = ?")
  .run(await hash(password), owner.id);
sqlite.prepare("delete from sessions").run();

console.log("Password updated. All existing sessions were signed out.");
