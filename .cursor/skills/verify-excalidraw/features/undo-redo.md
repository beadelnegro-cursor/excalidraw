# Undo and redo

## Sub-features

- Undo and redo of element changes: create, move, restyle, delete.
- Buttons in the bottom-left bar and the keyboard shortcuts.

## How to get to it (user POV)

Bottom-left undo and redo buttons, or `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z`.

## Driving it with control.mjs

```bash
node $C open --fresh
node $C draw rectangle
node $C click --testid "color-top-pick-#e03131"
node $C elements                       # strokeColor is #e03131
node $C press ControlOrMeta+z
node $C elements                       # strokeColor is back to #1e1e1e
node $C click --testid button-redo
node $C elements                       # #e03131 again
```

## Gotchas

- Compare `elements` before and after each step; a screenshot alone can hide a change to an element off screen.
- App state changes such as the current tool are not part of history.
