// Wipes the Playwright instance's data so each run starts from a fresh library.
// Deliberately hard-coded: it must never be pointable at a real data directory.
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".playwright-data");

if (!target.endsWith(".playwright-data")) {
  throw new Error(`refusing to delete ${target}`);
}

rmSync(target, { recursive: true, force: true });
rmSync(resolve(process.cwd(), "e2e/.auth"), { recursive: true, force: true });
console.log(`reset ${target}`);
