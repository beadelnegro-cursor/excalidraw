# Stroke color

## Sub-features

- Five quick-pick swatches in the Stroke row of the properties panel.
- The full palette, opened from the larger swatch at the end of the row.
- Picking a color changes the selected elements and the color for the next element (`currentItemStrokeColor`).

## How to get to it (user POV)

Select an element, or pick a drawing tool. The properties panel on the left shows Stroke with the quick picks. The last swatch opens the full palette.

## Driving it with control.mjs

```bash
node $C open --fresh
node $C draw rectangle
node $C snapshot                                  # the Stroke row lists one button per quick pick, named by hex
node $C click --testid "color-top-pick-#e03131"   # quick pick by hex
node $C state currentItemStrokeColor
node $C elements                                  # strokeColor of the selected element
node $C click --role button --name "Stroke"       # open the full palette
node $C screenshot picker.png --selector ".App-menu__left"
```

## Gotchas

- The quick picks are defined in `DEFAULT_ELEMENT_STROKE_PICKS` in `packages/common/src/colors.ts`. Their names there are palette names, not what the swatch looks like: the last pick is `yellow[4]`, `#f08c00`, which reads as orange.
- Quick-pick test ids contain the hex, so they change when the picks change. Find the current ids with `snapshot` instead of hardcoding them.
- The panel only shows when something is selected or a drawing tool is active.
