---
name: release
description: Cut a Substratum release. Picks the next version from the commits since the last tag, bumps every package.json, previews the release notes, then commits, tags and pushes once the developer approves, and watches the publish workflow through to the GHCR image and GitHub Release. Use when asked to release, ship, cut or publish a version, or to bump the version for a release.
---

# Releasing Substratum

Pushing a `v*` tag is the release. `.github/workflows/publish.yml` then does the rest:

1. **verify**: the tag's commit must be on `main`, and the tag must equal the version in every `package.json` (`scripts/version.mjs check`).
2. **ci**: the full CI suite, run against the tagged commit.
3. **image**: builds amd64 and arm64 images and pushes `:vX.Y.Z`, `:vX.Y` and `:latest` to GHCR. A pre-release tag such as `v1.2.0-rc.1` gets only its own tag.
4. **release**: creates the GitHub Release with notes from `scripts/release-notes.mjs`, and attaches the extension zip (`substratum-extension-X.Y.Z.zip`).

The Chrome Web Store is a separate, manual step afterwards (step 6), because most releases don't change the extension.

Your job is everything before the tag, and checking the result afterwards. Don't recreate the CI steps by hand.

Pushing a tag publishes to every self-hoster on `:latest`. Get the developer's explicit go-ahead on the exact version before you commit, tag or push. Asking for a release is not that go-ahead.

## 1. Preflight

Stop and report if any of these fail:

```bash
git switch main && git pull --ff-only
git status --porcelain                           # must be empty
pnpm release:check                               # versions in sync
gh run list --workflow ci.yml --branch main --limit 1 --json headSha,conclusion
```

The last command's `headSha` must equal `git rev-parse HEAD`, and `conclusion` must be `success`. If CI is still running, wait for it with `gh run watch <id> --exit-status`, running it in the background. If CI on `main` is red, don't release.

## 2. Pick the version

```bash
git describe --tags --abbrev=0 --match 'v*'      # previous release
pnpm release:notes vNEXT HEAD                     # what's in this one
```

Use the commits since the previous tag to choose the version (semver, still at 0.x):

- Breaking change (`!` or `BREAKING CHANGE`): bump the **minor** while at 0.x, the major from 1.0 on.
- Any `feat`: bump the **minor**.
- Only `fix`, `perf` or maintenance: bump the **patch**.
- If the notes show only maintenance, ask whether a release is worth it at all.

If the developer named a version, use that, but say so if it disagrees with the rules above.

The README's "Choosing a version" section says minor-version image tags start at v0.5. If this release is not v0.5.0, or is later than it, check that the sentence is still accurate.

## 3. Show the plan and get the go-ahead

Show the developer:

- the version, and why you picked it
- the release notes preview (`pnpm release:notes vX.Y.Z HEAD`), including the migration warning if it appears
- the exact commands you'll run in step 4

Wait for an explicit yes to that version.

## 4. Bump, commit, tag, push

```bash
pnpm release:version X.Y.Z
pnpm release:check
pnpm format:check
git commit -am "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push --atomic origin main vX.Y.Z
```

`--atomic` updates `main` and the tag together. If you push the tag before `main`, the verify job fails because the tag's commit isn't on `main` yet.

## 5. Watch the publish

```bash
gh run list --workflow publish.yml --branch vX.Y.Z --limit 1 --json databaseId,url
gh run watch <id> --exit-status                   # in the background; ~15 min
```

When it succeeds, check the published result:

```bash
gh release view vX.Y.Z
docker buildx imagetools inspect ghcr.io/francescobia/substratum:vX.Y.Z   # if Docker is running
```

The image list should show `linux/amd64` and `linux/arm64`, and the release should list `substratum-extension-X.Y.Z.zip` as an asset. Report the release URL to the developer.

## 6. Offer the Chrome Web Store submission

Skip this for a pre-release: the store can't tell `v1.2.0-rc.1` from `v1.2.0`, and the workflow refuses it.

Check whether the extension changed since it was last submitted. The last submitted tag is in the title of the newest successful run that isn't a dry run:

```bash
gh run list --workflow publish-extension.yml --status success --json displayTitle --jq '[.[] | select(.displayTitle | contains("dry run") | not)][0].displayTitle'
```

If there's none, nothing has been submitted yet, and the first submission is done by hand (see the extension README). Otherwise:

```bash
git diff --stat vLAST vX.Y.Z -- apps/extension packages/shared packages/ui
```

If nothing changed (a version bump in `package.json` doesn't count), say so and stop. Otherwise show the developer what changed and ask whether to submit. Submitting pushes an update to every store user within hours, while self-hosters upgrade their servers whenever they like, so check the changes still work against older instances. Only on an explicit yes:

```bash
gh workflow run publish-extension.yml -f tag=vX.Y.Z
gh run list --workflow publish-extension.yml --limit 1 --json databaseId,url
gh run watch <id> --exit-status
```

A successful run means the build was submitted for review, not that it's live. If it fails because a previous submission is still in review, tell the developer: they can wait, or cancel the pending review in the dashboard and run it again.

## If the publish fails

What you can safely do depends on whether the **image** job pushed:

- **Failed in verify or ci (nothing published):** the tag can be fixed in place. Fix the problem on `main`, then with the developer's OK delete and recreate the tag. In this case nothing was published, so moving the tag is safe.
  ```bash
  git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z
  # fix, commit, then repeat step 4 from `git tag`
  ```
- **The image was pushed (image job succeeded, or the release job failed):** never move the tag. Self-hosters may already be running that image. Release job failure: rerun just that job with `gh run rerun <id> --failed`, which updates or creates the release. Problem in the image itself: fix it and cut a new patch release.

Never use `--force` on a tag that already has a published image.

## Out of scope for now

- Releases from branches other than `main`, which the verify job rejects.
