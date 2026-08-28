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
      setStatus({ kind: "bad", message: "That doesn't look like a URL. Try http://localhost:3000" });
      return;
    }

    setStatus({ kind: "checking" });

    if (!(await hasPermission(origin)) && !(await requestPermission(origin))) {
      setStatus({ kind: "bad", message: "Permission denied — the extension can't reach that instance." });
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

  return (
    <main>
      <h1>Substratum</h1>
      <p className="muted">
        Point this extension at your own Substratum instance. Then right-click any image on the web and
        choose <strong>Save to Substratum</strong>.
      </p>

      <label htmlFor="instance">Instance URL</label>
      <input
        id="instance"
        type="url"
        placeholder="https://substratum.example.com"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && pair()}
      />

      <div className="row">
        <button className="primary" onClick={pair} disabled={status.kind === "checking"}>
          <span>{paired === toOrigin(input) && paired ? "Re-pair" : "Pair instance"}</span>
        </button>
        {paired && (
          <button onClick={() => checkSession(paired)} disabled={status.kind === "checking"}>
            Check connection
          </button>
        )}
      </div>

      {status.kind !== "idle" && (
        <div
          className={`status ${status.kind === "ok" ? "ok" : status.kind === "bad" ? "bad" : ""}`}
          role="status"
        >
          {status.kind === "checking" ? "Checking…" : status.message}
        </div>
      )}

      {paired && (
        <p className="muted" style={{ marginTop: "1.5rem" }}>
          Paired with <code>{paired}</code>
        </p>
      )}
    </main>
  );
}
