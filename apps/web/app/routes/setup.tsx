import { randomUUID } from "node:crypto";
import { Form, data, redirect, useNavigation } from "react-router";
import { hashPassword, validatePassword } from "~/auth/password.server";
import { createSession, getOwner } from "~/auth/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { db, schema } from "~/db/index.server";
import type { Route } from "./+types/setup";

export function meta() {
  return [{ title: "Set up Substratum" }];
}

/** First run only. Once an Owner exists this door is closed for good. */
export async function loader() {
  if (await getOwner()) throw redirect("/login");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  if (await getOwner()) throw redirect("/login");

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (!email.includes("@")) {
    return data({ error: "Enter a valid email address." }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return data({ error: passwordError }, { status: 400 });
  if (password !== confirm) {
    return data({ error: "The two passwords do not match." }, { status: 400 });
  }

  await db.insert(schema.owner).values({
    id: randomUUID(),
    email,
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
  });

  return redirect("/", { headers: { "Set-Cookie": await createSession() } });
}

export default function Setup({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Substratum</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          This instance is brand new. Create the account you'll use to sign in — you're the only
          person who ever will.
        </p>

        <Form method="post" className="mt-8 flex flex-col gap-4">
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
              autoComplete="new-password"
              required
            />
            <p className="text-muted-foreground text-xs">At least 10 characters.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>

          {actionData?.error && (
            <p role="alert" className="text-destructive text-sm">
              {actionData.error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="mt-2">
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </Form>
      </div>
    </main>
  );
}
