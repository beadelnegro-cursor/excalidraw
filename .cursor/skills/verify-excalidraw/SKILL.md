---
name: verify-excalidraw
description: Verify a change to the Excalidraw app by driving the running dev app the way a user does and returning evidence (screenshots, scene elements, app state, downloads, console). Use after any change to the editor UI, tools, colors, export, or undo/redo, and before opening a PR.
---

# Verify Excalidraw

Prove a change works in the real app, not just in tests. Drive the dev app through `control.mjs`, read what the scene and app state say, and attach the evidence.

Every command prints one JSON object and exits non-zero on failure. Failures name the next command to run in `fix`.

```bash
C=.cursor/skills/verify-excalidraw/control.mjs
node $C --help            # all commands
node $C <command> --help  # one command
```

## Launch

First time in a checkout, install the CLI's browser:

```bash
npm install --prefix .cursor/skills/verify-excalidraw
npx --prefix .cursor/skills/verify-excalidraw playwright install chromium
```

Then start the app and a headless browser on it:

```bash
node $C launch          # yarn start on port 3001, waits until it serves (about 1 minute cold)
node $C open --fresh    # headless Chromium on the app, empty canvas
```

`launch` refuses a port it did not start. To run a second copy, set `VERIFY_PORT=<port>` on every command.

## Doctor

```bash
node $C doctor
```

Read-only. Reports whether the server is up and ours, whether the browser is on the app, whether the dev hooks (`window.h`) are present, and the git revision under test. Run it whenever a command fails before guessing.

## Drive

Use the CLI, not ad hoc scripts. Prefer stable handles: `data-testid`, then ARIA role and name, then `title`.

```bash
node $C draw rectangle --x 400 --y 300 --w 220 --h 140
node $C draw text --x 700 --y 300 --text "hola"
node $C click --testid toolbar-ellipse
node $C click --testid "color-top-pick-#e03131"
node $C click --role button --name "Export to PNG" --download
node $C press ControlOrMeta+z
node $C type "hola"
node $C snapshot          # ARIA tree: find roles and names here
```

Feature-specific steps live in `features/`. Read `features/README.md` to find the right file.

## Evidence

Check the outcome in data first, then show it.

```bash
node $C elements                        # live elements with type, colors, bounds, text
node $C state currentItemStrokeColor    # any app state keys
node $C screenshot                      # full page PNG under artifacts/
node $C screenshot out.png --selector ".App-menu__left"
node $C console                         # console warnings, errors, page errors since open
```

A change is verified when the data shows the expected result and a screenshot shows it to a person. Attach the screenshot to the PR. Call out any console errors, even unrelated ones.

## Cleanup

```bash
node $C stop --dry-run   # what would stop
node $C stop             # stops only the server and browser this CLI started
```

Artifacts in `artifacts/` (gitignored) survive `stop`.

## Helpers

- `artifacts/`: screenshots and downloads. Override with `VERIFY_ARTIFACTS_DIR`.
- Run state (pids, log, browser profile) lives in the OS temp folder under `verify-excalidraw-<port>/`. The server log is `server.log` there.
- `window.h` (dev and test builds only) exposes `elements`, `state`, `setState`, `app`, `history` and `scene`. The CLI reads it for evidence; drive through the UI, not `setState`, so the check covers what a user does.
