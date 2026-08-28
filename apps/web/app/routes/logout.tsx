import { redirect } from "react-router";
import { destroySession } from "~/auth/session.server";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  return redirect("/login", { headers: { "Set-Cookie": await destroySession(request) } });
}

/** Nothing to render — reaching this by GET just bounces home. */
export async function loader() {
  return redirect("/");
}
