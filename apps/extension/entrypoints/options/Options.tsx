import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { useEffect, useState } from "react";
import {
  getInstanceUrl,
  hasPermission,
  requestPermission,
  setInstanceUrl,
  toOrigin,
} from "@/lib/instance";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; message: string }
  | { kind: "bad"; message: string };

export function Options() {
  const [input, setInput] = useState("");
  const [paired, setPaired] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    getInstanceUrl().then((url) => {
      if (!url) return;
      setPaired(url);
      setInput(url);
    });
  }, []);

  /**
   * Pair, then immediately check the session. That check is the whole auth
   * spike: if it reports the signed-in email, Chrome sent our SameSite=Lax
   * session cookie on an extension-originated request, which is what the
   * session model assumes. If it reports "not signed in" while the app clearly
   * is, the assumption is wrong and we fall back to token auth.
   */
  async function pair() {
    const origin = toOrigin(input);
    if (!origin) {
      setStatus({
        kind: "bad",
        message: "That doesn't look like a URL. Try http://localhost:3000",
      });
      return;
    }

    setStatus({ kind: "checking" });

    if (!(await hasPermission(origin)) && !(await requestPermission(origin))) {
      setStatus({
        kind: "bad",
        message: "Permission denied — the extension can't reach that instance.",
      });
      return;
    }

    await setInstanceUrl(origin);
    setPaired(origin);
    await checkSession(origin);
  }

  async function checkSession(origin: string) {
    setStatus({ kind: "checking" });
    try {
      const response = await fetch(`${origin}/api/session`, { credentials: "include" });
      const body = (await response.json()) as { authenticated: boolean; email?: string };

      setStatus(
        body.authenticated
          ? { kind: "ok", message: `Connected, signed in as ${body.email}.` }
          : {
              kind: "bad",
              message:
                "Reached the instance, but it doesn't see you as signed in. Sign in to Substratum in this browser, then check again.",
            },
      );
    } catch (error) {
      setStatus({
        kind: "bad",
        message: `Couldn't reach ${origin} — ${error instanceof Error ? error.message : "request failed"}`,
      });
    }
  }

  const busy = status.kind === "checking";

  return (
    <main className="flex min-h-screen justify-center p-10">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Substratum</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Point this extension at your own Substratum instance. Then right-click any image on the
          web and choose <strong className="text-foreground font-medium">Save to Substratum</strong>
          .
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <Label htmlFor="instance">Instance URL</Label>
          <Input
            id="instance"
            type="url"
            placeholder="https://substratum.example.com"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && pair()}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <Button onClick={pair} disabled={busy}>
            {paired === toOrigin(input) && paired ? "Re-pair" : "Pair instance"}
          </Button>
          {paired && (
            <Button variant="outline" onClick={() => checkSession(paired)} disabled={busy}>
              Check connection
            </Button>
          )}
        </div>

        {status.kind !== "idle" && (
          // The success case has no variant of its own — `destructive` is the
          // only one the design system offers — so a passing check is a plain
          // alert and only a failure is coloured.
          <Alert className="mt-5" variant={status.kind === "bad" ? "destructive" : "default"}>
            <AlertDescription>{busy ? "Checking…" : status.message}</AlertDescription>
          </Alert>
        )}

        {paired && (
          <p className="text-muted-foreground mt-6 text-xs">
            Paired with <code className="bg-muted rounded px-1 py-0.5">{paired}</code>
          </p>
        )}
      </div>
    </main>
  );
}
