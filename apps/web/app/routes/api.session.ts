import { getOwnerFromSession } from "~/auth/session.server";
import { extensionCorsHeaders } from "~/lib/cors.server";
import type { Route } from "./+types/api.session";

/**
 * Whether this request carries a valid Owner session. The extension calls this
 * when pairing, so it can say "signed in as you@example.com" instead of failing
 * mysteriously on the first Capture.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const owner = await getOwnerFromSession(request);

  return Response.json(
    owner ? { authenticated: true, email: owner.email } : { authenticated: false },
    { headers: extensionCorsHeaders(request) },
  );
}
