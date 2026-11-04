# Git Graph Extension Handover

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
