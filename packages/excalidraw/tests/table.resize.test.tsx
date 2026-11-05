import React from "react";

import {
  arrayToMap,
  TABLE_CELL_PADDING,
  TABLE_MIN_COLUMN_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
} from "@excalidraw/common";
import { fireEvent, queryByTestId } from "@testing-library/react";

import {
  getTableCellElements,
  getTableLayout,
  getTransformHandles,
  isTableElement,
  newTableElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  actionFlipHorizontal,
  actionFlipVertical,
} from "../actions/actionFlip";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import {
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
} from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

const HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const;

const liveTable = () => {
  const table = h.elements.find(isTableElement);
  if (!table || table.isDeleted) {
    throw new Error("missing table");
  }
  return table as NonDeleted<ExcalidrawTableElement>;
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

const geometry = () => {
  const table = liveTable();
  return {
    x: table.x,
    y: table.y,
    width: table.width,
    height: table.height,
    angle: table.angle,
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
    })),
  };
};

const liveById = (id: string) => {
  const element = h.elements.find((entry) => entry.id === id);
  if (!element || element.isDeleted) {
    throw new Error(`missing ${id}`);
  }
  return element as NonDeleted<ExcalidrawElement>;
};

const mount = async (
  opts?: {
    rows?: number | readonly { id: string; height: number }[];
    columns?: number | readonly { id: string; width: number }[];
  },
  extra: readonly {
    id?: string;
    type: "rectangle";
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [],
) => {
  const built = newTableElement({
    type: "table",
    x: 120,
    y: 80,
    ...opts,
  });
  const others = extra.map((element) => API.createElement(element));
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={{ elements: [built.table, ...built.cells, ...others] }}
    />,
  );
  return built.table.id;
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

const editCell = async (row: number, column: number, value: string) => {
  const center = cellCenter(row, column);
  mouse.doubleClickAt(center.x, center.y);
  const editor = await getTextEditor();
  updateTextEditor(editor, value);
  Keyboard.exitTextEditor(editor);
  expect(h.state.editingTextElement).toBeNull();
};

const expectCellsMatchLayout = () => {
  const table = liveTable();
  const layout = getTableLayout(table, h.elements);
  for (const cell of liveCells()) {
    const update = layout.cellUpdates.get(cell.id);
    expect(update).toBeDefined();
    expect(cell.x).toBeCloseTo(update!.x);
    expect(cell.y).toBeCloseTo(update!.y);
    if (cell.originalText.trim()) {
      const rowHeight =
        layout.rowHeights[
          table.rows.findIndex((row) => row.id === cell.tableCell.rowId)
        ] ?? 0;
      expect(cell.y + cell.height).toBeLessThanOrEqual(
        table.y +
          layout.rowHeights
            .slice(
              0,
              table.rows.findIndex((row) => row.id === cell.tableCell.rowId) +
                1,
            )
            .reduce((sum, size) => sum + size, 0) +
          0.01,
      );
      expect(rowHeight).toBeGreaterThanOrEqual(
        cell.height + TABLE_CELL_PADDING * 2 - 0.01,
      );
    }
  }
};

describe("table resize", () => {
  it.each(HANDLES)("resizes from the %s handle", async (handle) => {
    await mount();
    const before = liveTable();
    const start = {
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      columns: before.columns.map((column) => column.width),
      rows: before.rows.map((row) => row.height),
    };
    const dx = handle.includes("w") ? -90 : handle.includes("e") ? 90 : 0;
    const dy = handle.includes("n") ? -36 : handle.includes("s") ? 36 : 0;

    UI.resize(before, handle, [dx, dy]);

    const after = liveTable();
    const changesWidth = handle.includes("e") || handle.includes("w");
    const changesHeight = handle.includes("n") || handle.includes("s");

    if (changesWidth) {
      expect(after.width).toBeCloseTo(start.width + Math.abs(dx));
      after.columns.forEach((column, index) => {
        expect(column.width).toBeCloseTo(
          start.columns[index] * (after.width / start.width),
        );
      });
    } else {
      expect(after.width).toBeCloseTo(start.width);
      expect(after.columns.map((column) => column.width)).toEqual(
        start.columns,
      );
    }
    if (changesHeight) {
      expect(after.height).toBeCloseTo(start.height + Math.abs(dy));
      after.rows.forEach((row, index) => {
        expect(row.height).toBeCloseTo(
          start.rows[index] * (after.height / start.height),
        );
      });
    } else {
      expect(after.height).toBeCloseTo(start.height);
      expect(after.rows.map((row) => row.height)).toEqual(start.rows);
    }

    const anchorsLeft =
      handle.includes("e") || handle === "n" || handle === "s";
    const anchorsRight =
      handle.includes("w") || handle === "n" || handle === "s";
    const anchorsTop = handle.includes("s") || handle === "e" || handle === "w";
    const anchorsBottom =
      handle.includes("n") || handle === "e" || handle === "w";
    if (anchorsLeft) {
      expect(after.x).toBeCloseTo(start.x);
    }
    if (anchorsRight) {
      expect(after.x + after.width).toBeCloseTo(start.x + start.width);
    }
    if (anchorsTop) {
      expect(after.y).toBeCloseTo(start.y);
    }
    if (anchorsBottom) {
      expect(after.y + after.height).toBeCloseTo(start.y + start.height);
    }
    expect(after.columns.map((column) => column.id)).toEqual(
      before.columns.map((column) => column.id),
    );
    expect(after.rows.map((row) => row.id)).toEqual(
      before.rows.map((row) => row.id),
    );
    expectCellsMatchLayout();
  });

  it("scales unequal columns and base row heights by the same factor", async () => {
    await mount({
      columns: [
        { id: "c0", width: 80 },
        { id: "c1", width: 160 },
      ],
      rows: [
        { id: "r0", height: 40 },
        { id: "r1", height: 80 },
      ],
    });
    const before = liveTable();

    UI.resize(before, "e", [120, 0]);
    let after = liveTable();
    expect(after.width).toBeCloseTo(360);
    expect(after.columns.map((column) => column.width)).toEqual([120, 240]);
    expect(after.rows.map((row) => row.height)).toEqual([40, 80]);
    expect(after.x).toBeCloseTo(before.x);

    UI.resize(after, "s", [0, 60]);
    after = liveTable();
    expect(after.height).toBeCloseTo(180);
    expect(after.rows.map((row) => row.height)).toEqual([60, 120]);
    expect(after.columns.map((column) => column.width)).toEqual([120, 240]);
    expect(after.y).toBeCloseTo(before.y);
    expectCellsMatchLayout();
  });

  it("keeps the aspect ratio when shift is held", async () => {
    await mount();
    const before = liveTable();
    const start = {
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
    };
    const ratio = start.width / start.height;

    UI.resize(before, "se", [90, 0], { shift: true });
    let after = liveTable();
    expect(after.width).toBeGreaterThan(start.width);
    expect(after.height / after.width).toBeCloseTo(1 / ratio);
    expect(after.width / start.width).toBeCloseTo(after.height / start.height);
    expect(after.x).toBeCloseTo(start.x);
    expect(after.y).toBeCloseTo(start.y);

    const widened = {
      x: after.x,
      y: after.y,
      width: after.width,
      height: after.height,
    };
    UI.resize(after, "e", [60, 0], { shift: true });
    after = liveTable();
    expect(after.width).toBeGreaterThan(widened.width);
    expect(after.height / after.width).toBeCloseTo(1 / ratio);
    expect(after.y + after.height / 2).toBeCloseTo(
      widened.y + widened.height / 2,
    );
    expectCellsMatchLayout();
  });

  it("does not shrink a row below its text", async () => {
    await mount();
    await editCell(0, 0, "a\nb\nc\nd\ne\nf");
    const grown = liveTable();
    const grownHeight = grown.height;
    const textHeight = cellAt(0, 0).height;
    expect(grownHeight).toBeGreaterThan(
      grown.rows.reduce((sum, row) => sum + row.height, 0),
    );
    expect(grown.rows[0].height).toBe(48);

    UI.resize(grown, "s", [0, -grownHeight]);

    const after = liveTable();
    const rowHeight = getTableLayout(after, h.elements).rowHeights[0];
    expect(after.height).toBeGreaterThan(
      TABLE_MIN_ROW_HEIGHT * after.rows.length,
    );
    expect(rowHeight).toBeGreaterThanOrEqual(
      textHeight + TABLE_CELL_PADDING * 2 - 0.01,
    );
    expect(rowHeight).toBeGreaterThan(after.rows[0].height);
    expect(after.rows[0].height).toBe(TABLE_MIN_ROW_HEIGHT);
    expect(cellAt(0, 0).originalText).toBe("a\nb\nc\nd\ne\nf");
    expect(cellAt(0, 0).y).toBeGreaterThanOrEqual(after.y);
    expect(cellAt(0, 0).y + cellAt(0, 0).height).toBeLessThanOrEqual(
      after.y + after.height + 0.01,
    );
    expectCellsMatchLayout();
  });

  it("stops at the minimum column width and row height", async () => {
    await mount();
    const before = liveTable();

    // Stay short of the opposite edge so the drag shrinks instead of flipping.
    UI.resize(before, "e", [-(before.width - TABLE_MIN_COLUMN_WIDTH), 0]);
    let after = liveTable();
    expect(after.width).toBeCloseTo(
      TABLE_MIN_COLUMN_WIDTH * before.columns.length,
    );
    expect(
      after.columns.every((column) => column.width === TABLE_MIN_COLUMN_WIDTH),
    ).toBe(true);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.rows.map((row) => row.height)).toEqual(
      before.rows.map((row) => row.height),
    );

    UI.resize(after, "s", [0, -(after.height - TABLE_MIN_ROW_HEIGHT)]);
    after = liveTable();
    expect(after.height).toBeCloseTo(TABLE_MIN_ROW_HEIGHT * before.rows.length);
    expect(after.rows.every((row) => row.height === TABLE_MIN_ROW_HEIGHT)).toBe(
      true,
    );
    expect(after.y).toBeCloseTo(before.y);
  });

  it("scales a table inside a multi-selection", async () => {
    await mount({}, [
      { id: "rect", type: "rectangle", x: 560, y: 80, width: 80, height: 80 },
    ]);
    const table = liveTable();
    const rect = h.elements.find((element) => element.id === "rect")!;
    const neighborX = cellAt(0, 1).x;
    const belowY = cellAt(1, 0).y;
    const startWidth = table.width;
    const startRectWidth = rect.width;

    UI.resize([table, rect], "se", [112, 36]);

    const after = liveTable();
    const afterRect = h.elements.find((element) => element.id === "rect")!;
    expect(after.width).toBeGreaterThan(startWidth);
    expect(afterRect.width).toBeGreaterThan(startRectWidth);
    expect(after.width / startWidth).toBeCloseTo(
      afterRect.width / startRectWidth,
    );
    expect(cellAt(0, 1).x).toBeGreaterThan(neighborX);
    expect(cellAt(1, 0).y).toBeGreaterThan(belowY);
    expect(cellAt(0, 0).x).toBeGreaterThanOrEqual(after.x);
    expect(cellAt(0, 1).x).toBeGreaterThan(cellAt(0, 0).x);
    expectCellsMatchLayout();
  });

  it("moves a flipped table without mirroring its grid", async () => {
    const built = newTableElement({ type: "table", x: 100, y: 100 });
    const cells = built.cells.map((cell, index) =>
      index === 0
        ? { ...cell, originalText: "L", text: "L" }
        : index === 1
        ? { ...cell, originalText: "R", text: "R" }
        : cell,
    );
    const rect = API.createElement({
      type: "rectangle",
      id: "rect",
      x: 520,
      y: 300,
      width: 100,
      height: 80,
    });
    await render(
      <Excalidraw initialData={{ elements: [built.table, ...cells, rect] }} />,
    );
    const before = geometry();
    const rectBefore = liveById("rect");
    const centerX =
      (Math.min(before.x, rectBefore.x) +
        Math.max(before.x + before.width, rectBefore.x + rectBefore.width)) /
      2;

    API.setSelectedElements([liveTable(), rectBefore]);
    API.executeAction(actionFlipHorizontal);

    const flipped = liveTable();
    expect(flipped.x).toBeCloseTo(2 * centerX - before.x - before.width);
    expect(flipped.x).not.toBeCloseTo(before.x);
    expect(flipped.columns.map((column) => column.id)).toEqual(
      before.columns.map((column) => column.id),
    );
    expect(flipped.columns.map((column) => column.width)).toEqual(
      before.columns.map((column) => column.width),
    );
    expect(flipped.rows.map((row) => row.height)).toEqual(
      before.rows.map((row) => row.height),
    );
    expect(cellAt(0, 0).originalText).toBe("L");
    expect(cellAt(0, 1).originalText).toBe("R");
    expect(cellAt(0, 0).x).toBeLessThan(cellAt(0, 1).x);
    expect(cellAt(0, 0).x - flipped.x).toBeCloseTo(
      before.cells[0].x - before.x,
    );
    expect(flipped.angle).toBe(0);

    const rectNow = liveById("rect");
    const midY =
      (Math.min(flipped.y, rectNow.y) +
        Math.max(flipped.y + flipped.height, rectNow.y + rectNow.height)) /
      2;
    const yBeforeVertical = flipped.y;
    const heightBeforeVertical = flipped.height;
    const rowIds = flipped.rows.map((row) => row.id);
    API.setSelectedElements([flipped, rectNow]);
    API.executeAction(actionFlipVertical);
    const vertical = liveTable();
    expect(vertical.y).not.toBeCloseTo(yBeforeVertical);
    expect(vertical.y).toBeCloseTo(
      2 * midY - yBeforeVertical - heightBeforeVertical,
    );
    expect(cellAt(0, 0).y).toBeLessThan(cellAt(1, 0).y);
    expect(cellAt(0, 0).originalText).toBe("L");
    expect(vertical.rows.map((row) => row.id)).toEqual(rowIds);
    expectCellsMatchLayout();
  });

  it("has no rotation handle", async () => {
    await mount({}, [
      { id: "rect", type: "rectangle", x: 560, y: 80, width: 80, height: 40 },
    ]);
    const table = liveTable();
    const handles = getTransformHandles(
      table,
      h.state.zoom,
      arrayToMap(h.elements),
      "mouse",
      {},
    );
    expect(handles.rotation).toBeUndefined();
    expect(handles.se).toBeDefined();
    expect(handles.e).toBeDefined();

    const rect = h.elements.find((element) => element.id === "rect")!;
    expect(() => UI.rotate([table, rect], [40, -60])).toThrow(/rotation/);
    expect(liveTable().angle).toBe(0);
    expect(h.elements.find((element) => element.id === "rect")!.angle).toBe(0);
  });

  it("restores the size and cell positions on undo", async () => {
    await mount();
    const before = geometry();

    UI.resize(liveTable(), "se", [90, 36]);
    const after = geometry();
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.cells[1].x).not.toBe(before.cells[1].x);
    expect(after.cells[3].y).not.toBe(before.cells[3].y);

    Keyboard.undo();
    expect(geometry()).toEqual(before);

    Keyboard.redo();
    expect(geometry()).toEqual(after);
  });
});

describe("table stats resize", () => {
  beforeAll(() => {
    mockBoundingClientRect();
  });
  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  const openStats = () => {
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 1,
      clientY: 1,
    });
    const contextMenu = UI.queryContextMenu();
    fireEvent.click(queryByTestId(contextMenu!, "stats")!);
  };
  const statsInput = (label: string) =>
    UI.queryStatsProperty(label)?.querySelector(
      ".drag-input",
    ) as HTMLInputElement;

  it("edits width and height through the resize path and hides angle", async () => {
    await mount();
    openStats();
    API.setSelectedElements([liveTable()]);

    expect(UI.queryStatsProperty("A")).toBeNull();

    const width = statsInput("W");
    expect(width.value).toBe(String(liveTable().width));
    UI.updateInput(width, "480");
    let table = liveTable();
    expect(table.width).toBe(480);
    expect(table.columns.map((column) => column.width)).toEqual([
      160, 160, 160,
    ]);
    expect(table.rows.map((row) => row.height)).toEqual([48, 48, 48]);
    expect(table.height).toBe(144);
    expectCellsMatchLayout();

    const height = statsInput("H");
    UI.updateInput(height, "240");
    table = liveTable();
    expect(table.height).toBe(240);
    expect(table.rows.map((row) => row.height)).toEqual([80, 80, 80]);
    expect(table.columns.map((column) => column.width)).toEqual([
      160, 160, 160,
    ]);
    expect(table.x).toBe(120);
    expect(table.y).toBe(80);
    expectCellsMatchLayout();
  });

  it("grows back when the stats height is below the text", async () => {
    await mount();
    await editCell(0, 0, "a\nb\nc\nd\ne\nf");
    openStats();
    API.setSelectedElements([liveTable()]);

    UI.updateInput(statsInput("H"), "40");

    const after = liveTable();
    const rowHeight = getTableLayout(after, h.elements).rowHeights[0];
    expect(after.height).toBeGreaterThan(40);
    expect(rowHeight).toBeGreaterThan(after.rows[0].height);
    expect(rowHeight).toBeGreaterThanOrEqual(
      cellAt(0, 0).height + TABLE_CELL_PADDING * 2 - 0.01,
    );
    expect(cellAt(0, 0).originalText).toBe("a\nb\nc\nd\ne\nf");
    expectCellsMatchLayout();
  });
});
