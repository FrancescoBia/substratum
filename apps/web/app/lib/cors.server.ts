import { extensionId } from "./config.server";

/**
 * Headers letting the extension *read* our responses. Requests themselves are
 * deliberately kept "simple" (form-encoded bodies, no custom headers) so the
 * browser never sends a CORS preflight — React Router does not route OPTIONS,
 * and avoiding preflight means we need no custom server to answer it.
 *
 * Credentialed CORS forbids a wildcard origin, so we echo the caller's origin
 * and only ever for chrome-extension:// callers.
 */
export function extensionCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (origin !== `chrome-extension://${extensionId}`) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

/**
 * A request from some other extension. Withholding the CORS headers only stops
 * it reading the answer: a simple POST still arrives and would still run, so a
 * route with side effects turns these away first. Requests that carry no
 * extension origin (a script, curl) are not affected.
 */
export function isOtherExtension(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return (
    !!origin?.startsWith("chrome-extension://") && origin !== `chrome-extension://${extensionId}`
  );
}
