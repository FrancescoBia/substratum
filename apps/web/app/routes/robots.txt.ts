/**
 * Published boards are meant to be indexable; nothing else here is. The private
 * app is behind a session anyway, so this is about not offering the sign-in page
 * and asset URLs to crawlers rather than about access control.
 */
export function loader() {
  const body = [
    "User-agent: *",
    "Allow: /board/",
    "Allow: /img/",
    "Disallow: /",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
