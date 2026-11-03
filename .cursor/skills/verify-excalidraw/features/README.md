# Feature map

One file per user-facing feature. Each file says how a user reaches the feature, how to drive it with `control.mjs`, and what has bitten verification before.

| Feature | File | Touches |
| --- | --- | --- |
| Drawing shapes and text | `draw-shapes.md` | toolbar, canvas, text editing |
| Stroke color quick picks and palette | `stroke-color.md` | color picker, `packages/common/src/colors.ts` |
| Export image (PNG/SVG) | `export-image.md` | export dialog, downloads |
| Undo and redo | `undo-redo.md` | history, undo/redo buttons and shortcuts |

When a change touches a feature with no file, add one with the same four sections: Sub-features, How to get to it (user POV), Driving it with control.mjs, Gotchas.
