import { eq } from "drizzle-orm";
import { Form, data, redirect, useNavigation } from "react-router";
import { verifyPassword } from "~/auth/password.server";
import { createSession, getOwner, getOwnerFromSession } from "~/auth/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { db, schema } from "~/db/index.server";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: "Sign in to Substratum" }];
}

/** Only ever redirect within this app — never to an attacker-supplied host. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!(await getOwner())) throw redirect("/setup");

  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (await getOwnerFromSession(request)) throw redirect(next);

  return { next };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));

  const [owner] = await db.select().from(schema.owner).where(eq(schema.owner.email, email));

  // Same message either way, so this can't be used to discover the email.
  const failure = data({ error: "Wrong email or password." }, { status: 400 });
  if (!owner) return failure;
  if (!(await verifyPassword(owner.passwordHash, password))) return failure;

  return redirect(next, { headers: { "Set-Cookie": await createSession() } });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const next = loaderData.next;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

        <Form method="post" className="mt-8 flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {actionData?.error && (
            <p role="alert" className="text-destructive text-sm">
              {actionData.error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="mt-2">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </Form>

        <p className="text-muted-foreground mt-6 text-xs">
          Forgotten your password? Reset it on the server with{" "}
          <code className="bg-muted rounded px-1 py-0.5">
            docker compose exec app node ./scripts/reset-password.ts
          </code>
          .
        </p>
      </div>
    </main>
  );
}
