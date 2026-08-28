import { expect, test as setup } from "@playwright/test";
import { OWNER, STORAGE_STATE } from "./helpers";

/**
 * Authenticates once, over HTTP, and saves the session for every other test.
 *
 * This is the piece that makes an auth-gated app reviewable: nothing has to type
 * into the login form, and the app needs no dev-only bypass route — the tests
 * use the same endpoints a real client does.
 */
setup("create owner and save session", async ({ request }) => {
  // Fresh instance: first run creates the Owner. A reused one just signs in.
  const created = await request.post("/setup", {
    form: { email: OWNER.email, password: OWNER.password, confirm: OWNER.password },
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(created.status());

  const session = await request.get("/api/session");
  const body = (await session.json()) as { authenticated: boolean; email?: string };

  if (!body.authenticated) {
    const signedIn = await request.post("/login", {
      form: { email: OWNER.email, password: OWNER.password },
      maxRedirects: 0,
    });
    expect(signedIn.status()).toBe(302);
  }

  const confirmed = await request.get("/api/session");
  expect(((await confirmed.json()) as { authenticated: boolean }).authenticated).toBe(true);

  await request.storageState({ path: STORAGE_STATE });
});
