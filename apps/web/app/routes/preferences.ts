import { eq } from "drizzle-orm";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import type { Route } from "./+types/preferences";

export async function action({ request }: Route.ActionArgs) {
  const owner = await requireOwnerSession(request);

  const form = await request.formData();
  const gridLayout = form.get("gridLayout");
  if (gridLayout !== "flat" && gridLayout !== "mosaic") {
    return { ok: false, error: "Unknown grid layout." };
  }

  await db.update(schema.owner).set({ gridLayout }).where(eq(schema.owner.id, owner.id));
  return { ok: true };
}
