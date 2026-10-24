import React from "react";

import {
  DEFAULT_EXPORT_PADDING,
  FONT_SIZES,
  MIME_TYPES,
  TABLE_CELL_PADDING,
  getVerticalOffset,
} from "@excalidraw/common";
import { act } from "@testing-library/react";

import {
  getCommonBounds,
  getLineHeightInPx,
  getTableCellElements,
  getTableLayout,
  isTableCell,
  isTableElement,
} from "@excalidraw/element";

import type {
  ExcalidrawTableElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { actionChangeFontSize } from "../actions";
import { exportScene } from "../scene/export";
import { loadFromBlob } from "../data/blob";
import { serializeAsJSON } from "../data/json";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { render } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

const round2 = (value: number) => Number(value.toFixed(2));

const pointKey = (x: number, y: number) => `${round2(x)},${round2(y)}`;

type CanvasEvent = {
  type: string;
  transform: number[];
  props: Record<string, number | string | null>;
};

const applyMatrix = (transform: number[], x: number, y: number) => {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f] as const;
};

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

const canvasPathPoints = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d") as CanvasRenderingContext2D & {
    __getEvents: () => CanvasEvent[];
  };
  const points: string[] = [];
  for (const event of context.__getEvents()) {
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

const liveTable = () => {
  const table = h.elements.find(
    (element): element is NonDeleted<ExcalidrawTableElement> =>
      isTableElement(element) && !element.isDeleted,
  );
  if (!table) {
    throw new Error("missing table");
  }
  return table;
};

const liveCells = () => getTableCellElements(liveTable(), h.elements);

const cellAt = (row: number, column: number) => {
  const table = liveTable();
  const cell = liveCells().find(
    (candidate) =>
      candidate.tableCell.rowId === table.rows[row].id &&
      candidate.tableCell.columnId === table.columns[column].id,
  );
  if (!cell) {
    throw new Error(`missing cell ${row},${column}`);
  }
  return cell;
};

const cellCenter = (row: number, column: number) => {
  const table = liveTable();
  const cell = cellAt(row, column);
  const slot = getTableLayout(table, h.elements).grid.find(
    (entry) =>
      entry.rowId === cell.tableCell.rowId &&
      entry.columnId === cell.tableCell.columnId,
  );
  if (!slot) {
    throw new Error(`missing slot ${row},${column}`);
  }
  return {
    x: table.x + slot.x + slot.width / 2,
    y: table.y + slot.y + slot.height / 2,
  };
};

const geometry = () => {
  const table = liveTable();
  return {
    x: table.x,
    y: table.y,
    width: table.width,
    height: table.height,
    rows: table.rows.map((row) => ({ id: row.id, height: row.height })),
    columns: table.columns.map((column) => ({
      id: column.id,
      width: column.width,
    })),
    cells: liveCells().map((cell) => ({
      id: cell.id,
      originalText: cell.originalText,
      text: cell.text,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      fontSize: cell.fontSize,
    })),
  };
};

const editCell = async (row: number, column: number, value: string) => {
  const center = cellCenter(row, column);
  mouse.doubleClickAt(center.x, center.y);
  const editor = await getTextEditor();
  expect(h.state.editingTextElement?.id).toBe(cellAt(row, column).id);
  updateTextEditor(editor, value);
  Keyboard.exitTextEditor(editor);
  expect(h.state.editingTextElement).toBeNull();
};

const structureAction = (row: number, column: number, testId: string) => {
  API.setSelectedElements([liveTable()]);
  const center = cellCenter(row, column);
  mouse.rightClickAt(center.x, center.y);
  const before = API.getUndoStack().length;
  UI.clickOnTestId(testId);
  expect(API.getUndoStack()).toHaveLength(before + 1);
};

const visibleElements = (
  elements: readonly { isDeleted: boolean }[],
): NonDeletedExcalidrawElement[] =>
  elements.filter(
    (element): element is NonDeletedExcalidrawElement => !element.isDeleted,
  );

const exportData = (elements: readonly NonDeletedExcalidrawElement[]) => ({
  elements,
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const exportConfig = {
  canvasBackgroundColor: false as const,
  skipInliningFonts: true as const,
};

const layoutExportPoints = (
  table: ExcalidrawTableElement,
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  const layout = getTableLayout(table, elements);
  const [minX, minY] = getCommonBounds(elements);
  const toExport = (x: number, y: number) =>
    pointKey(
      x - minX + DEFAULT_EXPORT_PADDING,
      y - minY + DEFAULT_EXPORT_PADDING,
    );
  const points: string[] = [];
  let x = table.x;
  points.push(
    toExport(table.x, table.y),
    toExport(table.x + table.width, table.y),
  );
  points.push(
    toExport(table.x, table.y + table.height),
    toExport(table.x + table.width, table.y + table.height),
  );
  for (const width of layout.columnWidths.slice(0, -1)) {
    x += width;
    points.push(toExport(x, table.y), toExport(x, table.y + table.height));
  }
  let y = table.y;
  for (const height of layout.rowHeights.slice(0, -1)) {
    y += height;
    points.push(toExport(table.x, y), toExport(table.x + table.width, y));
  }
  return { layout, points, minX, minY };
};

const expectSvgMatchesLayout = (
  svg: SVGSVGElement,
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  const table = elements.find(isTableElement);
  if (!table) {
    throw new Error("export has no table");
  }
  const { layout, points, minX, minY } = layoutExportPoints(table, elements);
  const pathPoints = svgPathPoints(svg);
  expect(pathPoints.length).toBeGreaterThan(0);
  for (const point of points) {
    expect(pathPoints).toContain(point);
  }

  const texts = svgTexts(svg);
  for (const cell of elements.filter(isTableCell)) {
    const update = layout.cellUpdates.get(cell.id);
    expect(update).toBeDefined();
    expect(cell.x).toBeCloseTo(update!.x);
    expect(cell.y).toBeCloseTo(update!.y);
    expect(cell.width).toBeCloseTo(update!.width);
    expect(cell.height).toBeCloseTo(update!.height);
    if (!cell.text) {
      continue;
    }
    const lineHeightPx = getLineHeightInPx(cell.fontSize, cell.lineHeight);
    const baseline = getVerticalOffset(
      cell.fontFamily,
      cell.fontSize,
      lineHeightPx,
    );
    cell.text.split("\n").forEach((line, index) => {
      expect(texts).toContainEqual({
        text: line,
        x: round2(cell.x - minX + DEFAULT_EXPORT_PADDING),
        y: round2(
          cell.y -
            minY +
            DEFAULT_EXPORT_PADDING +
            baseline +
            index * lineHeightPx,
        ),
      });
    });
  }
};

describe("table end to end", () => {
  beforeEach(async () => {
    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        initialData={{ appState: { currentItemRoughness: 0 } }}
      />,
    );
    mouse.reset();
  });

  it("inserts, edits, restructures, resizes, undoes, and round-trips", async () => {
    UI.clickTool("table");
    mouse.click(300, 300);
    expect(API.getUndoStack()).toHaveLength(1);
    expect(liveTable().rows).toHaveLength(3);
    expect(liveTable().columns).toHaveLength(3);
    expect(liveCells()).toHaveLength(9);
    const inserted = geometry();

    await editCell(0, 0, "alpha");
    expect(API.getUndoStack()).toHaveLength(2);
    await editCell(1, 1, "beta\ngamma");
    expect(API.getUndoStack()).toHaveLength(3);
    expect(cellAt(0, 0).originalText).toBe("alpha");
    expect(cellAt(1, 1).originalText).toBe("beta\ngamma");
    expect(liveTable().height).toBeGreaterThan(inserted.height);
    const edited = geometry();

    const rowId = liveTable().rows[0].id;
    structureAction(0, 0, "insertTableRowBelow");
    expect(liveTable().rows).toHaveLength(4);
    expect(liveTable().rows[0].id).toBe(rowId);
    expect(liveTable().rows[1].id).not.toBe(rowId);
    expect(liveCells()).toHaveLength(12);
    expect(cellAt(0, 0).originalText).toBe("alpha");
    const withRow = geometry();

    const columnId = liveTable().columns[2].id;
    structureAction(0, 2, "deleteTableColumn");
    expect(liveTable().columns).toHaveLength(2);
    expect(liveTable().columns.map((column) => column.id)).not.toContain(
      columnId,
    );
    expect(liveCells()).toHaveLength(8);
    expect(
      liveCells().some((cell) => cell.originalText === "beta\ngamma"),
    ).toBe(true);
    const withoutColumn = geometry();

    const beforeResize = {
      width: liveTable().width,
      height: liveTable().height,
    };
    UI.resize(liveTable(), "se", [90, 36]);
    expect(API.getUndoStack()).toHaveLength(6);
    expect(liveTable().width).toBeGreaterThan(beforeResize.width);
    expect(liveTable().height).toBeGreaterThan(beforeResize.height);
    const resized = geometry();

    Keyboard.undo();
    expect(geometry()).toEqual(withoutColumn);
    Keyboard.undo();
    expect(geometry()).toEqual(withRow);
    Keyboard.undo();
    expect(geometry()).toEqual(edited);
    Keyboard.undo();
    expect(cellAt(0, 0).originalText).toBe("alpha");
    expect(cellAt(1, 1).originalText).toBe("");
    Keyboard.undo();
    expect(geometry()).toEqual(inserted);
    Keyboard.undo();
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);

    Keyboard.redo();
    expect(geometry()).toEqual(inserted);
    Keyboard.redo();
    expect(cellAt(0, 0).originalText).toBe("alpha");
    Keyboard.redo();
    expect(geometry()).toEqual(edited);
    Keyboard.redo();
    expect(geometry()).toEqual(withRow);
    Keyboard.redo();
    expect(geometry()).toEqual(withoutColumn);
    Keyboard.redo();
    expect(geometry()).toEqual(resized);

    const scene = h.elements.map((element) => ({ ...element }));
    const visible = visibleElements(h.elements);
    const svg = await exportScene({
      type: "svg",
      data: exportData(visible),
      config: exportConfig,
    });
    expectSvgMatchesLayout(svg, visible);

    const canvas = await exportScene({
      type: "canvas",
      data: exportData(visible),
      config: exportConfig,
    });
    const png = await exportScene({
      type: "png",
      data: exportData(visible),
      config: exportConfig,
    });
    expect(png).toBeInstanceOf(Blob);
    expect(png.type).toBe("image/png");
    expect(png.size).toBe(canvas.width * canvas.height * 4);
    expect(canvasPathPoints(canvas)).toEqual(svgPathPoints(svg));

    const json = serializeAsJSON(h.elements, h.state, {}, "local");
    const file = new Blob([json], { type: MIME_TYPES.excalidraw });
    const loaded = await loadFromBlob(file, null, null);
    expect(loaded.elements).toEqual(scene);

    const reloaded = visibleElements(loaded.elements);
    const reloadedSvg = await exportScene({
      type: "svg",
      data: exportData(reloaded),
      config: exportConfig,
    });
    expect(svgPathPoints(reloadedSvg)).toEqual(svgPathPoints(svg));
    expect(svgTexts(reloadedSvg)).toEqual(svgTexts(svg));
    const reloadedCanvas = await exportScene({
      type: "canvas",
      data: exportData(reloaded),
      config: exportConfig,
    });
    expect(canvasPathPoints(reloadedCanvas)).toEqual(canvasPathPoints(canvas));
  }, 30_000);

  it("grows a row when a larger font would clip the cell", async () => {
    UI.clickTool("table");
    mouse.click(300, 300);
    await editCell(0, 0, "Hello");

    const before = geometry();
    const nextRowY = cellAt(1, 0).y;
    const contentBox = before.rows[0].height - TABLE_CELL_PADDING * 2;
    expect(cellAt(0, 0).height).toBeLessThanOrEqual(contentBox);

    API.setSelectedElements([liveTable()]);
    const undoEntries = API.getUndoStack().length;
    act(() => {
      h.app.actionManager.executeAction(
        actionChangeFontSize,
        "ui",
        FONT_SIZES.xl,
      );
    });
    expect(API.getUndoStack()).toHaveLength(undoEntries + 1);

    const after = liveTable();
    const cell = cellAt(0, 0);
    const layout = getTableLayout(after, h.elements);
    expect(cell.fontSize).toBe(FONT_SIZES.xl);
    expect(cell.height).toBeGreaterThan(contentBox);
    expect(after.rows[0].height).toBe(before.rows[0].height);
    expect(layout.rowHeights[0]).toBeGreaterThan(before.rows[0].height);
    expect(layout.rowHeights[0]).toBeGreaterThanOrEqual(
      cell.height + TABLE_CELL_PADDING * 2 - 0.01,
    );
    expect(after.height).toBeGreaterThan(before.height);
    expect(cell.y + cell.height).toBeLessThanOrEqual(
      after.y + layout.rowHeights[0] - TABLE_CELL_PADDING + 0.01,
    );
    expect(cellAt(1, 0).y).toBeGreaterThan(nextRowY);
    expect(cell.x).toBeCloseTo(layout.cellUpdates.get(cell.id)!.x);
    expect(cell.y).toBeCloseTo(layout.cellUpdates.get(cell.id)!.y);

    Keyboard.undo();
    expect(geometry()).toEqual(before);
  });
});
