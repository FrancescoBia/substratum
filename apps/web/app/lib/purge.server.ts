import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "~/db/index.server";
import { trashPurgeIntervalMs, trashRetentionDays } from "./config.server";
import { storage, storageKeys } from "./storage.server";

/**
 * Deletes Images that have sat in the Trash past the retention window — rows and
 * stored files both, since a self-hosted instance's disk is the Owner's own.
 *
 * Files go first: a leftover row with no bytes renders as a broken tile, while a
 * leftover file is invisible and gets swept up next time round.
 */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const cutoff = now - trashRetentionDays * 24 * 60 * 60 * 1000;

  const expired = await db
    .select({ id: schema.images.id })
    .from(schema.images)
    .where(and(isNotNull(schema.images.deletedAt), lt(schema.images.deletedAt, cutoff)));

  let removed = 0;
  for (const { id } of expired) {
    try {
      await storage.deletePrefix(storageKeys.prefix(id));
      await db.delete(schema.images).where(eq(schema.images.id, id));
      removed++;
    } catch (error) {
      // One bad row shouldn't stop the sweep; the next one retries it.
      console.error(`[purge] could not remove image ${id}:`, error);
    }
  }

  if (removed > 0) {
    console.log(`[purge] removed ${removed} image(s) past the ${trashRetentionDays}-day window`);
  }
  return removed;
}

/**
 * Runs once at startup and then on an interval — no external cron, so a
 * self-hoster has nothing to wire up. Guarded against Vite's dev-server module
 * reloads, and unref'd so it never keeps the process alive by itself.
 */
function startPurgeSweeps() {
  void purgeExpiredTrash().catch((error) => console.error("[purge] startup sweep failed:", error));

  const timer = setInterval(() => {
    void purgeExpiredTrash().catch((error) => console.error("[purge] sweep failed:", error));
  }, trashPurgeIntervalMs);

  timer.unref?.();
  return timer;
}

const globalForPurge = globalThis as unknown as {
  __substratumPurgeTimer?: ReturnType<typeof startPurgeSweeps>;
};

globalForPurge.__substratumPurgeTimer ??= startPurgeSweeps();
