import {
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_ROW_HEIGHT,
  DEFAULT_TABLE_WIDTH,
  TABLE_CELL_PADDING,
  TABLE_DEFAULT_COLUMN_COUNT,
  TABLE_DEFAULT_ROW_COUNT,
  TABLE_MIN_COLUMN_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
  TEXT_ALIGN,
  VERTICAL_ALIGN,
  arrayToMap,
  getFontString,
} from "@excalidraw/common";

import { pointFrom, pointRotateRads, type GlobalPoint } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";

import { newElementWith } from "../mutateElement";
import { newElement, newTableElement, newTextElement } from "../newElement";
import { isInvisiblySmallElement } from "../sizeHelpers";
import {
  deleteTableColumn,
  deleteTableRow,
  getTableCellAt,
  getTableCellElements,
  getTableLayout,
  insertTableColumn,
  insertTableRow,
  relayoutTables,
} from "../table";
import {
  getBoundTextElement,
  getBoundTextElements,
  getBoundTextMaxHeight,
} from "../textElement";
import { wrapText } from "../textWrapping";
import { isTableCell, isTableElement } from "../typeChecks";

import type { ExcalidrawTextElement } from "../types";

const cellAt = (
  cells: readonly ExcalidrawTextElement[],
  rowId: string,
  columnId: string,
) =>
  cells.find(
    (cell) =>
      isTableCell(cell) &&
      cell.tableCell.rowId === rowId &&
      cell.tableCell.columnId === columnId,
  );

describe("table element model", () => {
  it("creates a 3×3 grid with one text element per cell", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 10,
      y: 20,
      groupIds: ["g1"],
      frameId: "frame-1",
      locked: true,
      angle: (Math.PI / 2) as Radians,
    });

    expect(isTableElement(table)).toBe(true);
    expect(table.rows).toHaveLength(TABLE_DEFAULT_ROW_COUNT);
    expect(table.columns).toHaveLength(TABLE_DEFAULT_COLUMN_COUNT);
    expect(table.width).toBe(DEFAULT_TABLE_WIDTH);
    expect(table.height).toBe(DEFAULT_TABLE_HEIGHT);
    expect(cells).toHaveLength(9);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(9);
    expect(new Set(table.rows.map((row) => row.id)).size).toBe(3);
    expect(new Set(table.columns.map((column) => column.id)).size).toBe(3);

    const boundIds = table.boundElements?.map((binding) => binding.id);
    expect(boundIds).toEqual(cells.map((cell) => cell.id));

    for (const row of table.rows) {
      expect(row.height).toBe(DEFAULT_TABLE_ROW_HEIGHT);
      for (const column of table.columns) {
        const cell = cellAt(cells, row.id, column.id);
        expect(cell).toBeDefined();
        expect(cell?.containerId).toBe(table.id);
        expect(cell?.text).toBe("");
        expect(cell?.originalText).toBe("");
        expect(cell?.groupIds).toEqual(["g1"]);
        expect(cell?.frameId).toBe("frame-1");
        expect(cell?.locked).toBe(true);
        expect(cell?.angle).toBe(table.angle);
      }
    }
    expect(table.columns.every((column) => column.width === 120)).toBe(true);
  });

  it("splits a dragged size evenly and keeps the last track exact", () => {
    const { table } = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      rows: 3,
      columns: 3,
      width: 300,
      height: 150,
    });

    expect(table.columns.map((column) => column.width)).toEqual([
      100, 100, 100,
    ]);
    expect(table.rows.map((row) => row.height)).toEqual([50, 50, 50]);
    expect(table.width).toBe(300);
    expect(table.height).toBe(150);
  });

  it("does not let a column or row start below the minimum", () => {
    const { table } = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      rows: 2,
      columns: 2,
      width: 20,
      height: 10,
    });

    expect(
      table.columns.every((column) => column.width === TABLE_MIN_COLUMN_WIDTH),
    ).toBe(true);
    expect(table.rows.every((row) => row.height === TABLE_MIN_ROW_HEIGHT)).toBe(
      true,
    );
    expect(table.width).toBe(TABLE_MIN_COLUMN_WIDTH * 2);
    expect(table.height).toBe(TABLE_MIN_ROW_HEIGHT * 2);
  });

  it("treats the table as having no single label and lists every cell", () => {
    const { table, cells } = newTableElement({ type: "table", x: 0, y: 0 });
    const elementsMap = arrayToMap([table, ...cells]);

    expect(getBoundTextElement(table, elementsMap)).toBeNull();
    expect(
      getBoundTextElements(table, elementsMap).map((cell) => cell.id),
    ).toEqual(cells.map((cell) => cell.id));
  });

  it("does not treat an empty cell as invisibly small", () => {
    const { cells } = newTableElement({ type: "table", x: 0, y: 0 });
    const empty = {
      ...cells[0],
      width: 0,
      height: 0,
    };

    expect(isInvisiblySmallElement(empty)).toBe(false);
    expect(
      isInvisiblySmallElement(
        newElement({ type: "rectangle", x: 0, y: 0, width: 0, height: 0 }),
      ),
    ).toBe(true);
  });
});

describe("table layout", () => {
  it("is idempotent for a table that is already laid out", () => {
    const { table, cells } = newTableElement({ type: "table", x: 40, y: 50 });
    const elements = [table, ...cells];
    const ids = new Set(elements.map((element) => element.id));

    expect(relayoutTables(elements, ids)).toBe(elements);
    expect(relayoutTables(elements, new Set())).toBe(elements);
  });

  it("grows a row to fit its tallest cell and leaves the base height", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      width: DEFAULT_TABLE_WIDTH,
      height: DEFAULT_TABLE_HEIGHT,
    });
    const target = cells[0];
    const originalText = "a\nb\nc\nd";
    const edited = newElementWith(target, { originalText, text: originalText });
    const elements = [table, edited, ...cells.slice(1)];
    const laidOut = relayoutTables(elements, new Set([edited.id]));
    const nextTable = laidOut.find(isTableElement)!;
    const nextCell = laidOut.find((element) => element.id === edited.id)!;

    const layout = getTableLayout(table, [edited, ...cells.slice(1)]);
    const expectedRow = Math.max(
      table.rows[0].height,
      layout.cellUpdates.get(edited.id)!.height + TABLE_CELL_PADDING * 2,
    );

    expect(nextTable.rows[0].height).toBe(table.rows[0].height);
    expect(nextTable.rows[0].id).toBe(table.rows[0].id);
    expect(layout.rowHeights[0]).toBe(expectedRow);
    expect(layout.rowHeights[1]).toBe(table.rows[1].height);
    expect(nextTable.height).toBe(
      expectedRow + table.rows[1].height + table.rows[2].height,
    );
    expect(nextCell).toMatchObject({
      text: originalText,
      height: layout.cellUpdates.get(edited.id)!.height,
    });
    expect(nextTable.height).toBeGreaterThan(table.height);
    if (!isTableElement(nextTable) || !isTableCell(nextCell)) {
      throw new Error("expected the grown cell");
    }
    // Base-row max height would clip this; relayout must keep the grown text.
    expect(nextCell.height).toBeGreaterThan(
      getBoundTextMaxHeight(nextTable, nextCell),
    );

    const again = relayoutTables(laidOut, new Set([nextTable.id]));
    expect(again).toBe(laidOut);
  });

  it("marks orphan cells deleted and is idempotent afterwards", () => {
    const { table, cells } = newTableElement({ type: "table", x: 0, y: 0 });
    const orphan = newTextElement({
      x: 0,
      y: 0,
      text: "gone",
      originalText: "gone",
      containerId: table.id,
      tableCell: { rowId: "missing-row", columnId: table.columns[0].id },
    });
    const duplicate = newElementWith(cells[0], {});
    const elements = [
      table,
      ...cells,
      orphan,
      { ...duplicate, id: "dup-cell" },
    ];
    const ids = new Set(elements.map((element) => element.id));

    const laidOut = relayoutTables(elements, ids);
    expect(laidOut.find((element) => element.id === orphan.id)?.isDeleted).toBe(
      true,
    );
    expect(
      laidOut.find((element) => element.id === "dup-cell")?.isDeleted,
    ).toBe(true);
    expect(laidOut.find((element) => element.id === table.id)).toBe(table);
    expect(laidOut.find((element) => element.id === cells[0].id)).toBe(
      cells[0],
    );

    expect(
      relayoutTables(laidOut, new Set(laidOut.map((element) => element.id))),
    ).toBe(laidOut);
  });

  it("wraps text to the column and does not grow a row for a blank cell", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      rows: [{ id: "r1", height: TABLE_MIN_ROW_HEIGHT }],
      columns: [{ id: "c1", width: TABLE_MIN_COLUMN_WIDTH }],
    });
    const originalText = "abcdefghij";
    const edited = newElementWith(cells[0], {
      originalText,
      text: originalText,
    });
    const layout = getTableLayout(table, [edited]);
    const maxWidth = TABLE_MIN_COLUMN_WIDTH - TABLE_CELL_PADDING * 2;
    const wrapped = wrapText(originalText, getFontString(edited), maxWidth);
    const update = layout.cellUpdates.get(edited.id)!;

    expect(wrapped.includes("\n")).toBe(true);
    expect(update.text).toBe(wrapped);
    expect(layout.rowHeights[0]).toBeGreaterThan(TABLE_MIN_ROW_HEIGHT);
    expect(table.rows[0].height).toBe(TABLE_MIN_ROW_HEIGHT);

    const blank = newElementWith(edited, { originalText: "   ", text: "   " });
    const blankLayout = getTableLayout(
      { ...table, height: layout.table.height },
      [blank],
    );
    expect(blankLayout.rowHeights[0]).toBe(TABLE_MIN_ROW_HEIGHT);
    expect(blankLayout.cellUpdates.get(blank.id)?.text).toBe("");
  });

  it("places a centered cell in the middle of its column", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 100,
      y: 200,
      rows: [{ id: "r1", height: 80 }],
      columns: [{ id: "c1", width: 200 }],
    });
    const edited = newElementWith(cells[0], {
      originalText: "ab",
      text: "ab",
      textAlign: TEXT_ALIGN.CENTER,
      verticalAlign: VERTICAL_ALIGN.MIDDLE,
    });
    const layout = getTableLayout(table, [edited]);
    const update = layout.cellUpdates.get(edited.id)!;
    const contentLeft = table.x + TABLE_CELL_PADDING;
    const contentWidth = 200 - TABLE_CELL_PADDING * 2;

    expect(update.x).toBeCloseTo(
      contentLeft + (contentWidth - update.width) / 2,
    );
    expect(update.y).toBeCloseTo(
      table.y +
        TABLE_CELL_PADDING +
        (80 - TABLE_CELL_PADDING * 2 - update.height) / 2,
    );
  });

  it("finds the cell under a scene point, including when the table is rotated", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 100,
      y: 200,
      width: 360,
      height: 144,
    });

    expect(
      getTableCellAt(table, pointFrom<GlobalPoint>(100, 200), cells),
    ).toEqual({
      rowId: table.rows[0].id,
      columnId: table.columns[0].id,
    });
    expect(
      getTableCellAt(table, pointFrom<GlobalPoint>(400, 270), cells),
    ).toEqual({
      rowId: table.rows[1].id,
      columnId: table.columns[2].id,
    });
    expect(
      getTableCellAt(table, pointFrom<GlobalPoint>(50, 50), cells),
    ).toBeNull();

    const rotated = { ...table, angle: Math.PI as Radians };
    const local = pointFrom<GlobalPoint>(110, 210);
    const center = pointFrom<GlobalPoint>(
      rotated.x + rotated.width / 2,
      rotated.y + rotated.height / 2,
    );
    const scenePoint = pointRotateRads(local, center, rotated.angle);
    expect(getTableCellAt(rotated, scenePoint, cells)).toEqual({
      rowId: table.rows[0].id,
      columnId: table.columns[0].id,
    });
    expect(
      getTableCellAt(rotated, pointFrom<GlobalPoint>(0, 0), cells),
    ).toBeNull();
  });
});

describe("table structure", () => {
  it("inserts a row and a column with fresh ids and one new cell each", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    });
    const rowChange = insertTableRow(table, cells, {
      rowId: table.rows[0].id,
      position: "below",
    });

    expect(rowChange.table).not.toBe(table);
    expect(rowChange.table.rows).toHaveLength(4);
    expect(rowChange.table.rows[1].id).not.toBe(table.rows[0].id);
    expect(rowChange.table.rows[0]).toBe(table.rows[0]);
    expect(rowChange.addedCells).toHaveLength(3);
    expect(rowChange.deletedCells).toEqual([]);
    expect(rowChange.table.height).toBe(table.height + table.rows[0].height);
    expect(rowChange.table.width).toBe(table.width);
    for (const cell of rowChange.addedCells) {
      expect(isTableCell(cell)).toBe(true);
      expect(cell.tableCell?.rowId).toBe(rowChange.table.rows[1].id);
      expect(cell.containerId).toBe(table.id);
      expect(cell.text).toBe("");
      expect(cells.some((existing) => existing.id === cell.id)).toBe(false);
    }
    expect(rowChange.table.boundElements?.map((binding) => binding.id)).toEqual(
      expect.arrayContaining(rowChange.addedCells.map((cell) => cell.id)),
    );

    const columnChange = insertTableColumn(
      rowChange.table,
      [...cells, ...rowChange.addedCells],
      {
        columnId: table.columns[1].id,
        position: "left",
      },
    );
    expect(columnChange.table.columns).toHaveLength(4);
    expect(columnChange.addedCells).toHaveLength(4);
    expect(columnChange.table.width).toBe(
      rowChange.table.width + table.columns[1].width,
    );
    expect(
      new Set(columnChange.addedCells.map((cell) => cell.tableCell?.columnId)),
    ).toEqual(new Set([columnChange.table.columns[1].id]));

    expect(
      insertTableRow(table, cells, { rowId: "missing", position: "above" })
        .table,
    ).toBe(table);
  });

  it("deletes a column's cells and deletes the table with its last row", () => {
    const { table, cells } = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      rows: 2,
      columns: 2,
      width: 200,
      height: 100,
    });
    const removedColumn = table.columns[0].id;
    const columnChange = deleteTableColumn(table, cells, removedColumn);

    expect(columnChange.table.columns.map((column) => column.id)).toEqual([
      table.columns[1].id,
    ]);
    expect(
      columnChange.deletedCells.map((cell) => cell.tableCell?.columnId),
    ).toEqual([removedColumn, removedColumn]);
    expect(columnChange.deletedCells.every((cell) => cell.isDeleted)).toBe(
      true,
    );
    expect(columnChange.addedCells).toEqual([]);
    expect(
      columnChange.table.boundElements?.some((binding) =>
        columnChange.deletedCells.some((cell) => cell.id === binding.id),
      ),
    ).toBe(false);

    const oneColumn = columnChange.table;
    const remaining = cells.filter(
      (cell) =>
        !columnChange.deletedCells.some((deleted) => deleted.id === cell.id),
    );
    const removed = deleteTableColumn(
      oneColumn,
      remaining,
      oneColumn.columns[0].id,
    );
    expect(removed.table.isDeleted).toBe(true);
    expect(removed.deletedCells).toHaveLength(2);
    expect(removed.deletedCells.every((cell) => cell.isDeleted)).toBe(true);

    const single = newTableElement({
      type: "table",
      x: 0,
      y: 0,
      rows: 1,
      columns: 2,
      width: 200,
      height: 80,
    });
    const deleted = deleteTableRow(
      single.table,
      single.cells,
      single.table.rows[0].id,
    );
    expect(deleted.table.isDeleted).toBe(true);
    expect(deleted.deletedCells).toHaveLength(2);
    expect(getTableCellElements(deleted.table, deleted.deletedCells)).toEqual(
      [],
    );
  });

  it("new cells copy the font of the neighboring cell", () => {
    const { table, cells } = newTableElement({ type: "table", x: 0, y: 0 });
    const styled = newElementWith(cells[0], {
      fontSize: 32,
      textAlign: TEXT_ALIGN.RIGHT,
      verticalAlign: VERTICAL_ALIGN.BOTTOM,
    });
    const change = insertTableRow(table, [styled, ...cells.slice(1)], {
      rowId: table.rows[0].id,
      position: "below",
    });
    const copied = change.addedCells.find(
      (cell) => cell.tableCell?.columnId === table.columns[0].id,
    );
    expect(copied).toMatchObject({
      fontSize: 32,
      textAlign: TEXT_ALIGN.RIGHT,
      verticalAlign: VERTICAL_ALIGN.BOTTOM,
    });
  });
});

describe("getTableCellElements", () => {
  it("ignores cells whose slot is not in the grid", () => {
    const { table, cells } = newTableElement({ type: "table", x: 0, y: 0 });
    const orphan = newTextElement({
      x: 0,
      y: 0,
      text: "nope",
      containerId: table.id,
      tableCell: { rowId: "missing", columnId: table.columns[0].id },
    });

    expect(getTableCellElements(table, [table, ...cells, orphan])).toHaveLength(
      cells.length,
    );
    expect(
      getTableCellElements(table, [table, ...cells, orphan]).some(
        (cell) => cell.id === orphan.id,
      ),
    ).toBe(false);
  });
});
