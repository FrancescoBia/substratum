import { randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { createCookie, redirect } from "react-router";
import { db, schema } from "~/db/index.server";
import { cookieSecret } from "~/lib/config.server";

const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/**
 * SameSite=Lax is doing real work here: it blocks cross-site POSTs
 * from arbitrary pages — i.e. CSRF — while still permitting the extension's
 * requests, because Chrome treats an extension fetch as same-site when the
 * extension holds host permission for this origin.
 */
export const sessionCookie = createCookie("session", {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MS / 1000,
  secrets: [cookieSecret],
});

export async function createSession(): Promise<string> {
  const id = randomUUID();
  const expiresAt = Date.now() + SESSION_MS;

  // Opportunistic cleanup of expired rows; no scheduler needed for this.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now()));
  await db.insert(schema.sessions).values({ id, expiresAt });

  return await sessionCookie.serialize(id);
}

export async function destroySession(request: Request): Promise<string> {
  const id = await sessionCookie.parse(request.headers.get("Cookie"));
  if (typeof id === "string") {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  }
  return await sessionCookie.serialize("", { maxAge: 0 });
}

/** The Owner row if this request carries a live session, otherwise null. */
export async function getOwnerFromSession(request: Request) {
  const id = await sessionCookie.parse(request.headers.get("Cookie"));
  if (typeof id !== "string" || !id) return null;

  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }

  return await getOwner();
}

/** The single Owner row, or null before first-run setup. */
export async function getOwner() {
  const [row] = await db.select().from(schema.owner).limit(1);
  return row ?? null;
}

/**
 * Gate for every private page. Sends the visitor to setup when the instance is
 * brand new, and to login otherwise.
 */
export async function requireOwnerSession(request: Request) {
  const existing = await getOwner();
  if (!existing) throw redirect("/setup");

  const authenticated = await getOwnerFromSession(request);
  if (!authenticated) {
    const url = new URL(request.url);
    const next = encodeURIComponent(url.pathname + url.search);
    throw redirect(`/login?next=${next}`);
  }

  return authenticated;
}
