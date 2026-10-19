import { rm } from "node:fs/promises";
import type { CaptureResponse } from "@repo/shared";
import { getOwnerFromSession } from "~/auth/session.server";
import { extensionCorsHeaders } from "~/lib/cors.server";
import { ingestFile } from "~/lib/ingest.server";
import { downloadSource } from "~/lib/source-download.server";
import { spoolPath } from "~/lib/upload.server";
import type { Route } from "./+types/api.capture";

/**
 * How long a capture may work before the answer has to start going out. Chrome
 * stops the extension's worker when a fetch response takes more than 30s to
 * arrive, taking the ✓ or the failure notice with it — and a 95 MB video,
 * downloaded, probed and stored, can take longer than that. Well inside it.
 */
const ANSWER_BY_MS = 10_000;

/**
 * How often a capture that is still working says so, once its answer has
 * started. One space each time: JSON allows any amount of leading whitespace,
 * so the body still parses as the verdict that follows.
 */
const HEARTBEAT_MS = 10_000;

/**
 * Capture from the extension, of an image or a video. The extension sends only
 * URLs — this server fetches the bytes, which is what keeps the extension's
 * permissions minimal enough to avoid the "read your data on all websites"
 * warning.
 *
 * Synchronous by design: the verdict is the extension's success signal, so it
 * is not sent until the Image is actually stored. A slow capture still answers
 * within {@link ANSWER_BY_MS}, but with only a status line and whitespace until
 * the verdict is ready — see `streamVerdict`.
 */
export async function action({ request }: Route.ActionArgs) {
  const headers = extensionCorsHeaders(request);

  const respond = (body: CaptureResponse, status = 200) => Response.json(body, { status, headers });

  const owner = await getOwnerFromSession(request);
  if (!owner) {
    return respond(
      { ok: false, code: "unauthenticated", message: "Sign in to your Substratum instance first." },
      401,
    );
  }

  const form = await request.formData();
  const sourceImageUrl = form.get("sourceImageUrl");
  const sourcePageUrl = form.get("sourcePageUrl");
  const sourcePageTitle = form.get("sourcePageTitle");

  if (
    typeof sourceImageUrl !== "string" ||
    typeof sourcePageUrl !== "string" ||
    typeof sourcePageTitle !== "string" ||
    !sourceImageUrl
  ) {
    return respond({ ok: false, code: "invalid-request", message: "Missing capture fields." }, 400);
  }

  const verdict = capture({ sourceImageUrl, sourcePageUrl, sourcePageTitle });

  const early = await Promise.race([
    verdict,
    new Promise<null>((resolve) => setTimeout(resolve, ANSWER_BY_MS, null)),
  ]);
  if (early) return respond(early.body, early.status);

  return streamVerdict(verdict, headers);
}

type Verdict = { body: CaptureResponse; status: number };

/** Downloads, ingests and cleans up. Never rejects: every outcome is a verdict. */
async function capture(source: {
  sourceImageUrl: string;
  sourcePageUrl: string;
  sourcePageTitle: string;
}): Promise<Verdict> {
  const path = spoolPath();
  try {
    const downloaded = await downloadSource(source.sourceImageUrl, source.sourcePageUrl, path);
    if (!downloaded.ok) {
      return { body: downloaded, status: 422 };
    }

    // A failure at any step stores nothing, so there's no partial state to undo.
    const result = await ingestFile(path, downloaded.size, source);
    if (!result.ok) {
      return { body: { ok: false, code: result.code, message: result.message }, status: 422 };
    }
    return { body: { ok: true, imageId: result.id }, status: 200 };
  } catch (error) {
    return {
      body: {
        ok: false,
        code: "server-error",
        message: error instanceof Error ? error.message : "Couldn't save that.",
      },
      status: 500,
    };
  } finally {
    await rm(path, { force: true });
  }
}

/**
 * A 200 sent now, whose body is whitespace until the verdict is ready and then
 * the verdict itself. The status can no longer tell success from failure, so
 * the extension reads `ok` from the body — which it already did.
 *
 * Nothing between here and the extension may hold the stream back, or the
 * response arrives no sooner than before: `no-transform` keeps compression
 * (react-router-serve's, a CDN's) off it, and `X-Accel-Buffering` keeps nginx
 * from buffering it.
 */
function streamVerdict(verdict: Promise<Verdict>, cors: Record<string, string>): Response {
  const encoder = new TextEncoder();
  let heartbeat: NodeJS.Timeout | undefined;
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(" "));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(" ")), HEARTBEAT_MS);

      void verdict.then(({ body }) => {
        clearInterval(heartbeat);
        if (cancelled) return;
        controller.enqueue(encoder.encode(JSON.stringify(body)));
        controller.close();
      });
    },
    // The extension went away. The capture carries on and is stored or not as
    // it would have been; there's just no one left to tell.
    cancel() {
      cancelled = true;
      clearInterval(heartbeat);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
