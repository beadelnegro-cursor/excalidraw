# Drawing shapes and text

## Sub-features

- Rectangle, diamond, ellipse: drag to size.
- Arrow and line: drag from start to end.
- Text: click to place, type, Escape to finish.
- After drawing, the tool returns to selection and the new element is selected.

## How to get to it (user POV)

Pick a tool in the top toolbar (or press its letter: R, D, O, A, L, T), then drag or click on the canvas.

## Driving it with control.mjs

```bash
node $C open --fresh
node $C draw rectangle --x 400 --y 300 --w 220 --h 140
node $C draw ellipse --x 700 --y 300
node $C draw text --x 400 --y 550 --text "hola"
node $C elements    # one entry per shape, with type, bounds and text
node $C screenshot
```

## Gotchas

- `draw` fails if no element was added. Check `console` and a screenshot before retrying.
- Text elements report a `y` a little above the click point; the click sets the text's vertical center.
- Use `open --fresh` for a clean canvas. Without it, the scene saved in the browser profile comes back.
