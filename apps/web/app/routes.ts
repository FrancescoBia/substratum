import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Everything inside the library shares the sidebar shell and the detail panel.
  layout("routes/library.tsx", [
    index("routes/stream.tsx"),
    // Plural and keyed by id: the Owner's view of a board. The singular
    // `board/:slug` below is the public page, and it gets the prettier URL
    // because that is the one people share.
    route("boards/:id", "routes/boards.$id.tsx"),
    route("tag/:name", "routes/tag.$name.tsx"),
    route("trash", "routes/trash.tsx"),
    route("triage", "routes/triage.tsx"),
  ]),

  // Public, unauthenticated, indexable. Outside the layout: no sidebar, and
  // nothing that would leak the rest of the library.
  route("board/:slug", "routes/board.$slug.tsx"),
  route("robots.txt", "routes/robots.txt.ts"),

  route("setup", "routes/setup.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),

  route("upload", "routes/upload.ts"),
  route("export", "routes/export.ts"),
  route("boards", "routes/boards.ts"),
  route("image/:id", "routes/image.$id.ts"),
  route("img/:id/:variant", "routes/img.$id.$variant.ts"),

  route("api/session", "routes/api.session.ts"),
  route("api/capture", "routes/api.capture.ts"),
] satisfies RouteConfig;
