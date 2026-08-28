import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import type { Route } from "./+types/boards";

/** URL-safe form of a Board name, used once at first publish and then frozen. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "board"
  );
}

export async function action({ request }: Route.ActionArgs) {
  await requireOwnerSession(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  switch (intent) {
    case "create": {
      const name = String(form.get("name") ?? "").trim();
      if (!name) return { ok: false, error: "Give the board a name." };

      const id = randomUUID();
      await db.insert(schema.boards).values({ id, name, createdAt: Date.now() });
      return { ok: true, id };
    }

    case "rename": {
      const id = String(form.get("boardId") ?? "");
      const name = String(form.get("name") ?? "").trim();
      if (!name) return { ok: false, error: "Give the board a name." };

      // Deliberately does not touch the slug: renaming must never break a link
      // that has already been shared.
      await db.update(schema.boards).set({ name }).where(eq(schema.boards.id, id));
      return { ok: true };
    }

    case "publish": {
      const id = String(form.get("boardId") ?? "");
      const [board] = await db.select().from(schema.boards).where(eq(schema.boards.id, id));
      if (!board) return { ok: false, error: "No such board." };

      // The slug is minted once, on first publish, then frozen for good.
      let slug = board.slug;
      if (!slug) {
        const base = slugify(board.name);
        slug = base;
        for (let n = 2; ; n++) {
          const clash = await db.select().from(schema.boards).where(eq(schema.boards.slug, slug));
          if (clash.length === 0) break;
          slug = `${base}-${n}`;
        }
      }

      await db.update(schema.boards).set({ published: true, slug }).where(eq(schema.boards.id, id));
      return { ok: true, slug };
    }

    case "unpublish": {
      const id = String(form.get("boardId") ?? "");
      await db.update(schema.boards).set({ published: false }).where(eq(schema.boards.id, id));
      return { ok: true };
    }

    case "delete": {
      // Memberships cascade; the Images themselves are untouched.
      const id = String(form.get("boardId") ?? "");
      await db.delete(schema.boards).where(eq(schema.boards.id, id));
      throw redirect("/");
    }

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}
