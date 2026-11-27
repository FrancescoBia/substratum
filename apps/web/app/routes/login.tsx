import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { eq } from "drizzle-orm";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, data, redirect, useNavigation } from "react-router";
import { verifyPassword } from "~/auth/password.server";
import { createSession, getOwner, getOwnerFromSession } from "~/auth/session.server";
import { AuthShell } from "~/components/auth-shell";
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
  const { next } = loaderData;
  const error = actionData?.error;

  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!error || !passwordRef.current) return;
    passwordRef.current.value = "";
    passwordRef.current.focus();
  }, [actionData, error]);

  return (
    <AuthShell>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-sm">Sign in to your library.</p>

      <Form method="post" className="mt-8 flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            aria-invalid={error ? true : undefined}
            required
            className="h-10 px-3"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              required
              className="h-10 pr-10 pl-3"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </div>
        </div>

        {error && (
          <p
            id="login-error"
            role="alert"
            className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <CircleAlertIcon className="size-4 shrink-0" />
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy} className="mt-1 h-10">
          {busy ? (
            <>
              <LoaderCircleIcon className="animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRightIcon
                data-icon="inline-end"
                className="transition-transform group-hover/button:translate-x-0.5"
              />
            </>
          )}
        </Button>
      </Form>

      <details className="group/reset mt-8 text-xs">
        <summary className="hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 transition-colors [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3.5 transition-transform group-open/reset:rotate-90" />
          Forgotten your password?
        </summary>
        <div className="mt-3 rounded-lg border p-3">
          <p>There's no reset email — run this on the server instead:</p>
          <code className="bg-muted text-foreground mt-2 block overflow-x-auto rounded-md px-2 py-1.5 font-mono whitespace-nowrap">
            docker compose exec app node ./scripts/reset-password.ts
          </code>
        </div>
      </details>
    </AuthShell>
  );
}
