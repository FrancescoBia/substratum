#!/usr/bin/env node
// One version for the whole repo: the root package.json and every workspace
// package that declares a `version` field move together.
//
//   node scripts/version.mjs check          all versions agree
//   node scripts/version.mjs check v1.2.3   ...and they match this tag
//   node scripts/version.mjs set 1.2.3      write 1.2.3 everywhere
//
// CI runs `check` on every change so drift can't build up, and publish.yml
// runs `check <tag>` so a tag pushed onto the wrong commit (one whose
// package.json still says the previous version) fails before anything ships.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
// Mirrors pnpm-workspace.yaml's `apps/*` and `packages/*`.
const workspaceDirs = ["apps", "packages"];

function manifests() {
  const paths = [join(root, "package.json")];
  for (const dir of workspaceDirs) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(root, dir, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(path)) paths.push(path);
    }
  }
  return paths
    .map((path) => ({ path, json: JSON.parse(readFileSync(path, "utf8")) }))
    .filter(({ json }) => typeof json.version === "string");
}

const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const [command, arg] = process.argv.slice(2);

if (command === "check") {
  const found = manifests();
  const versions = new Set(found.map(({ json }) => json.version));
  if (versions.size !== 1) {
    console.error("Versions are out of sync:");
    for (const { path, json } of found) console.error(`  ${json.version}  ${relative(root, path)}`);
    console.error("Fix with: pnpm release:version <version>");
    process.exit(1);
  }
  const [version] = versions;
  if (arg !== undefined && arg !== `v${version}`) {
    console.error(`Tag ${arg} does not match the version in package.json (${version}).`);
    console.error(`The tag is probably on the wrong commit: expected v${version}.`);
    process.exit(1);
  }
  console.log(`${version} (${found.length} manifests)${arg ? ` matches ${arg}` : ""}`);
} else if (command === "set") {
  const version = arg?.replace(/^v/, "");
  if (!version || !semver.test(version)) {
    console.error(`Usage: node scripts/version.mjs set <x.y.z[-pre]>, got ${arg ?? "nothing"}`);
    process.exit(1);
  }
  for (const { path, json } of manifests()) {
    json.version = version;
    writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
    console.log(`${version}  ${relative(root, path)}`);
  }
} else {
  console.error("Usage: node scripts/version.mjs check [vX.Y.Z] | set <X.Y.Z>");
  process.exit(1);
}
