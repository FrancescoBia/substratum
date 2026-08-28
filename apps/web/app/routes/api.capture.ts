import type { CaptureResponse } from "@repo/shared";
import { getOwnerFromSession } from "~/auth/session.server";
import { extensionCorsHeaders } from "~/lib/cors.server";
import { fetchSourceImage, ingestImage } from "~/lib/ingest.server";
import type { Route } from "./+types/api.capture";

/**
 * Capture from the extension. The extension sends only URLs — this server
 * fetches the bytes, which is what keeps the extension's permissions
 * minimal enough to avoid the "read your data on all websites" warning.
 *
 * Synchronous by design: the response is the extension's success signal, so it
 * must not resolve until the Image is actually stored.
 */
export async function action({ request }: Route.ActionArgs) {
  const headers = extensionCorsHeaders(request);

  const respond = (body: CaptureResponse, status = 200) =>
    Response.json(body, { status, headers });

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

  const fetched = await fetchSourceImage(sourceImageUrl, sourcePageUrl);
  if (!fetched.ok) {
    return respond({ ok: false, code: fetched.code, message: fetched.message }, 422);
  }

  const result = await ingestImage(fetched.bytes, {
    sourceImageUrl,
    sourcePageUrl,
    sourcePageTitle,
  });

  // A failure at any step stores nothing, so there's no partial state to undo.
  if (!result.ok) {
    return respond({ ok: false, code: result.code, message: result.message }, 422);
  }

  return respond({ ok: true, imageId: result.id });
}
