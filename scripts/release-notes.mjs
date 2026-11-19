#!/usr/bin/env node
// Release notes from the Conventional Commits since the previous tag.
//
//   node scripts/release-notes.mjs v1.2.3          notes for an existing tag
//   node scripts/release-notes.mjs v1.2.3 HEAD     preview, before tagging
//
// publish.yml uses this for the GitHub Release body. GitHub's own generated
// notes list merged pull requests only, and most changes here land as direct
// pushes to main, so they would come out nearly empty.
import { execFileSync } from "node:child_process";

const [tag, ref = tag] = process.argv.slice(2);
if (!tag) {
  console.error("Usage: node scripts/release-notes.mjs <tag> [ref]");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// The newest v* tag strictly before `ref`. `ref^` rather than `ref` so a tag
// sitting on `ref` itself (the release being described) doesn't count.
let previous = null;
try {
  previous = git("describe", "--tags", "--abbrev=0", "--match", "v*", `${ref}^`);
} catch {
  // First release: no earlier tag, so describe the whole history.
}
const range = previous ? `${previous}..${ref}` : ref;

const sections = [
  { title: "Breaking changes", commits: [] },
  { title: "Features", types: ["feat"], commits: [] },
  { title: "Fixes", types: ["fix"], commits: [] },
  { title: "Performance", types: ["perf"], commits: [] },
];
const maintenance = [];

// %x1f / %x1e: unit and record separators, so bodies can contain anything.
const log = git("log", "--no-merges", "--format=%s%x1f%b%x1e", range);
for (const record of log.split("\x1e")) {
  const [subject, body = ""] = record.trim().split("\x1f");
  // The version-bump commit itself says nothing a reader needs.
  if (!subject || /^chore(\([^)]*\))?: (release|update to) v?\d/.test(subject)) continue;
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) {
    maintenance.push(subject);
    continue;
  }
  const [, type, scope, bang, description] = match;
  const line = scope ? `**${scope}:** ${description}` : description;
  if (bang || /^BREAKING[ -]CHANGE:/m.test(body)) {
    sections[0].commits.push(line);
  } else {
    const section = sections.find((s) => s.types?.includes(type));
    if (section) section.commits.push(line);
    else maintenance.push(subject);
  }
}

const out = [];

// Migrations run on startup and don't run backwards, so an upgrade that
// carries one is a one-way door for the database. Say so up front.
const migrations =
  previous &&
  git("diff", "--name-only", "--diff-filter=A", previous, ref, "--", "apps/web/drizzle/*.sql");
if (migrations) {
  out.push(
    "> [!IMPORTANT]",
    "> This release changes the database schema. The migration runs on startup and can't be undone by going back to an older image, so back up the `data` volume before upgrading.",
    "",
  );
}

for (const { title, commits } of sections) {
  if (commits.length === 0) continue;
  out.push(`### ${title}`, "", ...commits.map((c) => `- ${c}`), "");
}
if (maintenance.length > 0) {
  out.push(
    "<details><summary>Maintenance</summary>",
    "",
    ...maintenance.map((c) => `- ${c}`),
    "",
    "</details>",
    "",
  );
}
if (out.length === 0) out.push("No changes since the previous release.", "");

const repo = process.env.GITHUB_REPOSITORY ?? "FrancescoBia/substratum";
if (previous)
  out.push(`**Full changelog:** https://github.com/${repo}/compare/${previous}...${tag}`);

console.log(out.join("\n").trimEnd());
