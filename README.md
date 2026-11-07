# Git Graph Extension

An OpenChamber extension that displays the current project's commit graph in the Work Status panel.

## Purpose

Helps users quickly see branch structure, recent commits, and open a commit's details without leaving the chat context.

<img width=30% height=30% alt="CleanShot 2026-11-07 at 09 11 53" src="https://github.com/user-attachments/assets/a3686393-e9e5-4936-8cfc-bf218dd2e7f2" />


## Features

- Lane-based commit graph layout showing branch structure and merges.
- Three modes: current branch (auto), all branches, or manual ref list.
- Per-commit detail expansion with diff view integration.
- Commit preview popovers where the host supports them.
- Read-only service that never blocks the user's Git commands.

## Architecture

### Surface

Contributes a `statusSection` that appears as a Work Status section next to the chat. It uses a sandboxed iframe (`status/index.html` → `status/main.js`) and a host-bound local service (`service/main.js`).

### Service

The Node.js service runs on `127.0.0.1` with a Bearer token and exposes three read-only git endpoints:

- `GET /refs?directory=<path>` → returns branch, upstream, GitHub remote, and all refs.
- `GET /log?directory=<path>&mode=<auto|all|manual>&refs=<manual-list>&limit=<n>` → returns recent commits and uncommitted count.
- `GET /commit?directory=<path>&sha=<hash>` → returns commit detail (author, date, subject, body, files, insertions, deletions).

Git commands use `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0` so they never block the user's own Git commands.

### Frontend

`status/main.ts` coordinates:

- Parsing snapshots from the service with manual shape guards.
- Lane-based commit graph layout (`status/graph.ts`).
- SVG drawing of commit rows, connectors, and rails (`status/view.ts`).
- Mode selection and per-commit detail expansion.
- Commit preview popovers via `host.setPopover`.

### State Model

Commit records carry `hash`, `parents`, `author`, `when`, `date`, `subject`, `refs`. The layout algorithm maintains active lanes and merges parents as additional lanes.

### Layout Algorithm

Ported from OpenChamber's internal Git view:

1. Maintain an `active` array where each slot represents a lane's expected commit hash or `null`.
2. For each commit (newest first):
   - Find a waiting lane that points to this commit's hash; reuse it if found.
   - Otherwise allocate a new lane at the end.
   - Assign this commit's parents to the new/selected slot(s).
   - Emit connectors: `passing`, `commit-lane`, `top-stub`, `bottom-stub`, `branch-out`, `merge-in`.
3. Trim trailing empty lanes.

## Quick Start

```bash
cd /Users/wclin/openchamber/openchamber_git
bun install
bun run build
```

## Package Structure

```
openchamber_git/
├── package.json
├── tsconfig.json
├── status/
│   ├── index.html
│   ├── main.ts
│   ├── graph.ts
│   ├── view.ts
│   └── commit-popover.ts
├── service/
│   └── main.ts
├── scripts/
│   └── build.ts
└── doc/
    ├── design.md
    └── handover.md
```

## Build Output

- `status/main.js` → sandboxed iframe that renders the commit graph in the Work Status section.
- `service/main.js` → Node.js local service that reads git history.

Commit both source and built outputs when publishing to the Extensions catalog.

## Adding to OpenChamber

1. Publish this folder as a Git package (e.g. GitHub, local file URL).
2. In OpenChamber → Settings → Extensions, add the repository URL.
3. OpenChamber installs the extension and runs the service when the section is visible.

## Permissions

The `statusSection` is `requiresProject: true`, so it only appears when a project is open. The service requires the `exec` permission for the `git` CLI.

## Updating

- Increment `version` in `package.json`.
- Rebuild with `bun run build`.
- Commit, push, and the extension updates in OpenChamber.

## Known Limits

- The frontend does not use Zod; it validates JSON with manual type guards.
- Popover anchors are a no-op unless the host supports `popovers`.
- The service is read-only and does not modify the working tree.
- Errors: `not-a-repo`, `no-git`, `unknown-commit`, `git-failed`.
