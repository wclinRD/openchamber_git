# Git Graph Extension Design

## Purpose

An OpenChamber extension that displays the current project's commit graph in the Work Status panel. It helps users quickly see branch structure, recent commits, and open a commit's details without leaving the chat context.

## Architecture

### `statusSection` Surface

The extension contributes only a `statusSection`, meaning it appears as a Work Status section next to the chat. It uses a sandboxed iframe (`status/index.html` → `status/main.js`) and a host-bound local service (`service/main.js`).

### Service

The Node.js service runs on `127.0.0.1` with a Bearer token. It exposes three read-only git endpoints:

- `GET /refs?directory=<path>` → returns branch, upstream, GitHub remote, and all refs.
- `GET /log?directory=<path>&mode=<auto|all|manual>&refs=<manual-list>&limit=<n>` → returns recent commits and uncommitted count.
- `GET /commit?directory=<path>&sha=<hash>` → returns a single commit's detail (author, date, subject, body, files, insertions, deletions).

Git commands run with `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0` so they never block the user's own Git commands.

### Frontend

`status/main.ts` coordinates:

- Parsing snapshots from the service with shape guards.
- Lane-based commit graph layout (`status/graph.ts`).
- SVG drawing of commit rows, connectors, and rails (`status/view.ts`).
- Mode selection (auto/current branch, all, manual).
- Per-commit detail expansion with diff view integration (`host.openCommit`).
- Commit preview popovers via `host.setPopover` when available.

### State Model

Commit records carry `hash`, `parents`, `author`, `when`, `date`, `subject`, `refs`. The layout algorithm maintains active lanes and merges parents as additional lanes.

## Layout Algorithm

The lane algorithm is ported from OpenChamber's internal Git view:

1. Maintain an `active` array where each slot represents a lane's expected commit hash or `null`.
2. For each commit (newest first):
   - Find a waiting lane that points to this commit's hash; reuse it if found.
   - Otherwise allocate a new lane at the end.
   - Assign this commit's parents to the new/selected slot(s).
   - Emit connectors: `passing`, `commit-lane`, `top-stub`, `bottom-stub`, `branch-out`, `merge-in`.
3. Trim trailing empty lanes.

## Error Handling

- `not-a-repo`: project directory is not a git repository.
- `no-git`: `git` CLI unavailable on host.
- `unknown-commit`: requested commit no longer exists in history.
- `git-failed`: generic git execution failure.
