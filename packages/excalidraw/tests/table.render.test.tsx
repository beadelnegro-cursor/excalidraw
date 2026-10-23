import {
  DEFAULT_EXPORT_PADDING,
  arrayToMap,
  getVerticalOffset,
} from "@excalidraw/common";

import {
  ShapeCache,
  getCommonBounds,
  getLineHeightInPx,
  getTableCellAt,
  getTableLayout,
  hitElementBoundText,
  hitElementItself,
  isTableElement,
  isTextElement,
  newTableElement,
  relayoutTables,
} from "@excalidraw/element";

import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { exportScene } from "../scene/export";

type CanvasEvent = {
  type: string;
  transform: number[];
  props: Record<string, number | string | null>;
};

const round2 = (value: number) => Number(value.toFixed(2));

const applyMatrix = (transform: number[], x: number, y: number) => {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f] as const;
};

const pointKey = (x: number, y: number) => `${round2(x)},${round2(y)}`;

const canvasContext = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("export canvas has no 2d context");
  }
  return context as CanvasRenderingContext2D & {
    __getEvents: () => CanvasEvent[];
  };
};

const canvasPathPoints = (canvas: HTMLCanvasElement) => {
  const points: string[] = [];
  for (const event of canvasContext(canvas).__getEvents()) {
    if (event.type === "moveTo" || event.type === "lineTo") {
      const [x, y] = applyMatrix(
        event.transform,
        Number(event.props.x),
        Number(event.props.y),
      );
      points.push(pointKey(x, y));
    } else if (event.type === "bezierCurveTo") {
      const pairs = [
        [event.props.cpx1, event.props.cpy1],
        [event.props.cpx2, event.props.cpy2],
        [event.props.x, event.props.y],
      ];
      for (const [px, py] of pairs) {
        const [x, y] = applyMatrix(event.transform, Number(px), Number(py));
        points.push(pointKey(x, y));
      }
    }
  }
  return points.sort();
};

const canvasTexts = (canvas: HTMLCanvasElement) => {
  const texts: { text: string; x: number; y: number }[] = [];
  for (const event of canvasContext(canvas).__getEvents()) {
    if (event.type !== "fillText") {
      continue;
    }
    const [x, y] = applyMatrix(
      event.transform,
      Number(event.props.x),
      Number(event.props.y),
    );
    texts.push({ text: String(event.props.text), x: round2(x), y: round2(y) });
  }
  return texts.sort(
    (a, b) => a.text.localeCompare(b.text) || a.y - b.y || a.x - b.x,
  );
};

// SVG applies the transform list right to left.
const mapSvgTransform = (transform: string | null) => {
  const translate = transform
    ? /translate\(\s*([-\d.eE]+)[\s,]+([-\d.eE]+)\s*\)/.exec(transform)
    : null;
  const rotate = transform
    ? /rotate\(\s*([-\d.eE]+)(?:[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+))?\s*\)/.exec(
        transform,
      )
    : null;
  const tx = translate ? Number(translate[1]) : 0;
  const ty = translate ? Number(translate[2]) : 0;
  const degrees = rotate ? Number(rotate[1]) : 0;
  const cx = rotate?.[2] ? Number(rotate[2]) : 0;
  const cy = rotate?.[3] ? Number(rotate[3]) : 0;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return [
      cx + dx * cos - dy * sin + tx,
      cy + dx * sin + dy * cos + ty,
    ] as const;
  };
};

const svgPathPoints = (svg: SVGSVGElement) => {
  const points: string[] = [];
  for (const path of svg.querySelectorAll("path")) {
    const map = mapSvgTransform(
      path.getAttribute("transform") ??
        path.parentElement?.getAttribute("transform") ??
        null,
    );
    const tokens = [
      ...(path.getAttribute("d") ?? "").matchAll(
        /[MLC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi,
      ),
    ].map((match) => match[0]);
    let command = "";
    for (let index = 0; index < tokens.length; ) {
      const token = tokens[index];
      if (/^[MLC]$/i.test(token)) {
        command = token.toUpperCase();
        index += 1;
        continue;
      }
      const count = command === "C" ? 6 : 2;
      const values = tokens.slice(index, index + count).map(Number);
      index += count;
      for (let pair = 0; pair < values.length; pair += 2) {
        const [x, y] = map(values[pair], values[pair + 1]);
        points.push(pointKey(x, y));
      }
    }
  }
  return points.sort();
};

const svgTexts = (svg: SVGSVGElement) => {
  const texts: { text: string; x: number; y: number }[] = [];
  for (const node of svg.querySelectorAll("text")) {
    const map = mapSvgTransform(
      node.parentElement?.getAttribute("transform") ?? null,
    );
    const [x, y] = map(
      Number(node.getAttribute("x")),
      Number(node.getAttribute("y")),
    );
    texts.push({
      text: node.textContent ?? "",
      x: round2(x),
      y: round2(y),
    });
  }
  return texts.sort(
    (a, b) => a.text.localeCompare(b.text) || a.y - b.y || a.x - b.x,
  );
};

const buildScene = () => {
  const { table, cells } = newTableElement({
    id: "table",
    x: 40,
    y: 50,
    seed: 1,
    roughness: 0,
    backgroundColor: "#ffec99",
    strokeColor: "#1e1e1e",
    width: 240,
    height: 96,
    rows: 2,
    columns: 2,
  });
  const copies = ["Hello", "World", "Ada", ""];
  const renamedCells = cells.map((cell, index) => ({
    ...cell,
    id: `cell-${index}`,
    originalText: copies[index],
    text: copies[index],
  }));
  const renamedTable = {
    ...table,
    boundElements: renamedCells.map((cell) => ({
      type: "text" as const,
      id: cell.id,
    })),
  };
  return relayoutTables(
    [renamedTable, ...renamedCells],
    new Set([renamedTable.id]),
  );
};

const exportData = (elements: readonly NonDeletedExcalidrawElement[]) => ({
  elements,
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

describe("table rendering", () => {
  it("draws the same grid and cell text on canvas and in SVG", async () => {
    const elements = buildScene();
    const table = elements.find(isTableElement)!;
    const config = {
      canvasBackgroundColor: false as const,
      skipInliningFonts: true as const,
    };

    const canvas = await exportScene({
      type: "canvas",
      data: exportData(elements),
      config,
    });
    const svg = await exportScene({
      type: "svg",
      data: exportData(elements),
      config,
    });

    const pathPoints = canvasPathPoints(canvas);
    expect(pathPoints.length).toBeGreaterThan(0);
    expect(svgPathPoints(svg)).toEqual(pathPoints);

    const texts = canvasTexts(canvas);
    expect(texts.map((entry) => entry.text)).toEqual(
      expect.arrayContaining(["Hello", "World", "Ada"]),
    );
    expect(svgTexts(svg)).toEqual(texts);

    const [minX, minY] = getCommonBounds(elements);
    const layout = getTableLayout(table, elements);
    const toExport = (x: number, y: number) =>
      pointKey(
        x - minX + DEFAULT_EXPORT_PADDING,
        y - minY + DEFAULT_EXPORT_PADDING,
      );
    const verticalX = table.x + layout.columnWidths[0];
    const horizontalY = table.y + layout.rowHeights[0];
    for (const point of [
      toExport(verticalX, table.y),
      toExport(verticalX, table.y + table.height),
      toExport(table.x, horizontalY),
      toExport(table.x + table.width, horizontalY),
    ]) {
      expect(pathPoints).toContain(point);
    }

    const hello = elements
      .filter(isTextElement)
      .find((element) => element.text === "Hello")!;
    const lineHeightPx = getLineHeightInPx(hello.fontSize, hello.lineHeight);
    const baseline = getVerticalOffset(
      hello.fontFamily,
      hello.fontSize,
      lineHeightPx,
    );
    expect(texts).toContainEqual({
      text: "Hello",
      x: round2(hello.x - minX + DEFAULT_EXPORT_PADDING),
      y: round2(hello.y - minY + DEFAULT_EXPORT_PADDING + baseline),
    });
  }, 30_000);

  it("matches the SVG snapshot", async () => {
    const svg = await exportScene({
      type: "svg",
      data: exportData(buildScene()),
      config: {
        canvasBackgroundColor: false,
        skipInliningFonts: true,
      },
    });
    expect(svg.outerHTML).toMatchSnapshot();
  }, 30_000);

  it("includes the table in PNG export bounds", async () => {
    const elements = buildScene();
    const table = elements.find(isTableElement)!;
    const [minX, minY, maxX, maxY] = getCommonBounds(elements);

    expect(minX).toBeLessThanOrEqual(table.x);
    expect(minY).toBeLessThanOrEqual(table.y);
    expect(maxX).toBeGreaterThanOrEqual(table.x + table.width);
    expect(maxY).toBeGreaterThanOrEqual(table.y + table.height);

    const canvas = await exportScene({
      type: "canvas",
      data: exportData(elements),
    });
    expect(canvas.width).toBe(
      Math.max(1, Math.round(maxX - minX + DEFAULT_EXPORT_PADDING * 2)),
    );
    expect(canvas.height).toBe(
      Math.max(1, Math.round(maxY - minY + DEFAULT_EXPORT_PADDING * 2)),
    );

    const png = await exportScene({
      type: "png",
      data: exportData(elements),
    });
    expect(png).toBeInstanceOf(Blob);
    expect(png.type).toBe("image/png");
    expect(png.size).toBe(canvas.width * canvas.height * 4);
  }, 30_000);

  it("hits inside every cell, including a transparent rotated table", () => {
    const elements = buildScene();
    const table = elements.find(isTableElement)!;
    const transparent = { ...table, backgroundColor: "transparent" };
    const elementsMap = arrayToMap(elements);
    const layout = getTableLayout(transparent, elements);

    for (const cell of layout.grid) {
      const point = pointFrom<GlobalPoint>(
        transparent.x + cell.x + cell.width / 2,
        transparent.y + cell.y + cell.height / 2,
      );
      expect(
        hitElementItself({
          point,
          element: transparent,
          threshold: 0,
          elementsMap,
        }),
      ).toBe(true);
      expect(getTableCellAt(transparent, point, elements)).toEqual({
        rowId: cell.rowId,
        columnId: cell.columnId,
      });
    }

    const hello = elements
      .filter(isTextElement)
      .find((element) => element.originalText === "Hello")!;
    expect(
      hitElementBoundText(
        pointFrom(hello.x + hello.width / 2, hello.y + hello.height / 2),
        transparent,
        elementsMap,
      ),
    ).toBe(true);

    expect(
      hitElementItself({
        point: pointFrom(transparent.x - 30, transparent.y + 8),
        element: transparent,
        threshold: 1,
        elementsMap,
      }),
    ).toBe(false);
    expect(
      getTableCellAt(
        transparent,
        pointFrom(transparent.x - 30, transparent.y + 8),
        elements,
      ),
    ).toBeNull();

    const rotated = newTableElement({
      x: 10,
      y: 20,
      angle: (Math.PI / 2) as Radians,
      backgroundColor: "transparent",
      roughness: 0,
    });
    const rotatedElements = [rotated.table, ...rotated.cells];
    const rotatedMap = arrayToMap(rotatedElements);
    const rotatedLayout = getTableLayout(rotated.table, rotatedElements);
    const middle = rotatedLayout.grid[4];
    const center = pointFrom<GlobalPoint>(
      rotated.table.x + rotated.table.width / 2,
      rotated.table.y + rotated.table.height / 2,
    );
    const point = pointRotateRads(
      pointFrom<GlobalPoint>(
        rotated.table.x + middle.x + middle.width / 2,
        rotated.table.y + middle.y + middle.height / 2,
      ),
      center,
      rotated.table.angle,
    );
    expect(
      hitElementItself({
        point,
        element: rotated.table,
        threshold: 0,
        elementsMap: rotatedMap,
      }),
    ).toBe(true);
    expect(getTableCellAt(rotated.table, point, rotatedElements)).toEqual({
      rowId: middle.rowId,
      columnId: middle.columnId,
    });
  });

  it("reuses the roughjs shape until the table version or cell text changes", () => {
    const elements = buildScene();
    const table = elements.find(isTableElement)!;
    const elementsMap = arrayToMap(elements);
    const shape = ShapeCache.generateElementShape(table, null, elementsMap);
    expect(ShapeCache.generateElementShape(table, null, elementsMap)).toBe(
      shape,
    );
    expect(shape).toHaveLength(1 + 1 + 1);

    const edited = elements.map((element) =>
      isTextElement(element) && element.id === "cell-0"
        ? { ...element, originalText: "Hello there", text: "Hello there" }
        : element,
    );
    const next = ShapeCache.generateElementShape(
      table,
      null,
      arrayToMap(edited),
    );
    expect(next).not.toBe(shape);

    (table as { version: number }).version += 1;
    expect(
      ShapeCache.generateElementShape(table, null, arrayToMap(edited)),
    ).not.toBe(next);
  });
});
