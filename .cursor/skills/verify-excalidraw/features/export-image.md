# Export image

## Sub-features

- Export to PNG or SVG, or copy PNG to the clipboard.
- Options: only selected, background, dark mode, embed scene, scale.

## How to get to it (user POV)

Main menu (top left) → Export image..., or `Cmd/Ctrl+Shift+E`. Pick options, then PNG or SVG.

## Driving it with control.mjs

```bash
node $C open --fresh
node $C draw rectangle
node $C press ControlOrMeta+Shift+e
node $C screenshot export-dialog.png
node $C click --role button --name "Export to PNG" --download
node $C click --role button --name "Export to SVG" --download
```

`--download` returns the saved file's path and size. A file of a few bytes, or no download, is a failure.

## Gotchas

- Headless Chromium cancels the native save picker, so the app logs an `AbortError` from `showSaveFilePicker` and downloads nothing. `open` starts the browser with the File System Access API off, which makes the app fall back to a plain download. If you see that AbortError, the browser was started some other way: run `stop`, then `open`.
- The buttons show "PNG" and "SVG"; their accessible names are "Export to PNG" and "Export to SVG".
- "Only selected" is on when something is selected, so the export holds only the selection.
