---
name: linear-workflow
description: >-
  How we plan and track Substratum work in Linear. Use whenever planning a
  feature/bug/refactor, starting a multi-step task, when the user mentions
  Linear, an issue, a ticket, or a SUB-xxx identifier, or when deciding
  what to work on next. Also use before committing or opening a PR for
  tracked work, to link and update the related issue.
---

Linear is the source of truth for planned and in-progress work on Substratum. Before starting non-trivial work, check Linear for an existing issue; when work is planned in chat, capture it in Linear so it survives the conversation.

> This process is intentionally simple for now and will grow over time. If you notice a recurring decision that this file doesn't cover, propose adding it here.

## Workspace facts

- Access Linear through the Linear MCP tools. If they are unavailable, say so and continue without silently skipping the process.
- Team: **Substratum** (issue key `SUB`). Ignore the other teams in the workspace. They belong to other products.
- Issue statuses: `Backlog` → `Todo` → `In Progress` → `In Review` → `Done` (plus `Canceled` / `Duplicate`). `Backlog` is the single backlog, ordered manually by the developer. `Todo` is a small, developer-curated queue of what's about to be worked on. Don't move issues into it on your own. New issues go to `Backlog` unless the developer says otherwise.
- Priority is mostly unused: don't set `Medium`/`Low`. Use `Urgent`/`High` only as exceptional flags when the developer says something is critical.

## Labels

The Substratum team has no labels yet. Don't apply labels or create them on your own. If a labelling scheme would help, propose it to the developer.

## Projects

A project is a **time-bounded initiative with a concrete outcome** (e.g. "Video upload (v1)"), not a permanent theme. Rules:

- Attach an issue to a project only when it clearly serves that project's outcome.
- A project must have a one-line summary describing its goal; if you find one without it, propose one.
- When a project's outcome is shipped, it should be marked Completed. Flag lingering ones.
- Don't create projects on your own. Propose them to the developer instead.

## Process

### When planning work

1. Search Linear for existing issues on the topic before creating anything (avoid duplicates; prefer updating an existing issue).
2. For non-trivial work agreed in chat (anything beyond a quick fix), create an issue in **Substratum**:
   - Title: short, imperative (e.g. "Add lazy loading and pagination to the library grid").
   - Description: the problem/goal, the agreed approach, and acceptance criteria or a checklist for multi-step work. Write it so an agent with no chat context could pick it up. Put implementation detail (file lists, plans) in a collapsible `+++ Agent notes` section at the end.
   - Status: `Backlog`. If it should happen soon, say so. The developer curates `Todo` and the backlog order.
3. If the scope grows while working, update the issue description rather than keeping the new understanding only in chat.

### Quick-capture issues

The developer often jots down issues mid-work with only a cryptic, lowercase title, to be enriched later. When you encounter a title-only issue relevant to your current task, don't guess silently: ask what was meant, or propose a fleshed-out description and confirm it.

### When executing work

1. If the task corresponds to a Linear issue, read it first. The description and comments (`list_comments`) are context you should use.
2. Move the issue to `In Progress` when starting (before writing any code).
3. If you work on a branch, use the issue's `gitBranchName` from Linear (e.g. `francesco/sub-35-add-lazy-loading-and-pagination`) so Linear auto-links the branch and PR. Pushing directly to `main` is also allowed in this repo (see `AGENTS.md`).
4. Link the work to the issue:
   - PR: put `Fixes SUB-123` in the description, so Linear links it, moves the issue to `In Review`, and closes it on merge.
   - Direct commit to `main`: add `Fixes SUB-123` to the commit body. The subject stays a Conventional Commit (`fix(web): …`). As always, check with the developer before committing.
5. Leave a short comment on the issue when you make decisions that deviate from the described plan.
6. When the work lands, verify the issue reached `Done` (the link usually handles this; set it manually otherwise).

### What NOT to do

- Don't create issues for trivial one-off fixes done immediately in the same session (typos, small chores) unless asked.
- Don't close, cancel, or delete issues you didn't work on without asking.
- Don't assign issues to people other than the current user.

### Other guidelines

- As a general rule, each Linear issue should correspond to a PR (or a single commit on `main`). Use sub-issues to divide the work of a substantial group of commits or smaller stacked PRs (create sub-issues only when necessary to split up a large PR, not by default). If you need to group multiple independent PRs to achieve a single goal, use Projects instead.
- It is acceptable, and recommended, to create issues outside of an active Project if the issue can be addressed independently and would provide value whether or not the Project is ultimately completed.
- When appropriate, define relationships between issues, such as `Blocking ...`, `Related to ...`, etc.
