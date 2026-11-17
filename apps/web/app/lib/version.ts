// The monorepo version lives in the root package.json (kept in sync across
// packages). Vite tree-shakes named JSON imports, so only this field ships.
export { version as APP_VERSION } from "../../../../package.json";
