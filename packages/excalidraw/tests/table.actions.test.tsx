import React from "react";

import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@excalidraw/common";

import { isTableCell } from "@excalidraw/element";

import type { ExcalidrawTableElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  cleanAppStateForExport,
  clearAppStateForLocalStorage,
} from "../appState";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const liveTables = () =>
  h.elements.filter(
    (element): element is ExcalidrawTableElement =>
      element.type === "table" && !element.isDeleted,
  );

const liveCells = (tableId: string) =>
  h.elements.filter(
    (element) =>
      isTableCell(element) &&
      !element.isDeleted &&
      element.containerId === tableId,
  );

const insertTableAt = (x: number, y: number) => {
  UI.clickTool("table");
  mouse.reset();
  mouse.click(x, y);
  return liveTables()[0];
};

describe("table tool", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    mouse.reset();
  });

  it("click inserts a 3×3 table centered on the pointer, as one undo", () => {
    const table = insertTableAt(300, 300);

    expect(liveTables()).toHaveLength(1);
    expect(table.rows).toHaveLength(3);
    expect(table.columns).toHaveLength(3);
    expect(liveCells(table.id)).toHaveLength(9);
    expect(table.width).toBe(DEFAULT_TABLE_WIDTH);
    expect(table.height).toBe(DEFAULT_TABLE_HEIGHT);
    expect(table.x).toBe(300 - DEFAULT_TABLE_WIDTH / 2);
    expect(table.y).toBe(300 - DEFAULT_TABLE_HEIGHT / 2);
    expect(h.state.activeTool.type).toBe("selection");
    expect(h.state.editingTextElement).toBeNull();
    expect(API.getUndoStack()).toHaveLength(1);

    Keyboard.undo();
    expect(liveTables()).toHaveLength(0);
    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
  });

  it("drag sets the overall size, split evenly across rows and columns", () => {
    UI.clickTool("table");
    mouse.reset();
    mouse.down(100, 100);
    mouse.up(300, 150);

    const table = liveTables()[0];
    expect(table).toMatchObject({ x: 100, y: 100, width: 300, height: 150 });
    expect(table.columns.map((column) => column.width)).toEqual([
      100, 100, 100,
    ]);
    expect(table.rows.map((row) => row.height)).toEqual([50, 50, 50]);
    expect(liveCells(table.id)).toHaveLength(9);
    expect(API.getUndoStack()).toHaveLength(1);
    expect(h.state.editingTextElement).toBeNull();
  });
});

describe("table row and column actions", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    mouse.reset();
  });

  it("context menu on a cell offers the six structure actions", () => {
    const table = insertTableAt(300, 300);
    mouse.rightClickAt(300, 300);

    expect(h.state.activeTableCell).toEqual({
      tableId: table.id,
      rowId: table.rows[1].id,
      columnId: table.columns[1].id,
    });
    const menu = UI.queryContextMenu();
    for (const name of [
      "insertTableRowAbove",
      "insertTableRowBelow",
      "insertTableColumnLeft",
      "insertTableColumnRight",
      "deleteTableRow",
      "deleteTableColumn",
    ]) {
      expect(menu?.querySelector(`[data-testid="${name}"]`)).not.toBeNull();
    }
  });

  it("does not offer table actions for a rectangle", () => {
    UI.clickTool("rectangle");
    mouse.reset();
    mouse.down(0, 0);
    mouse.up(10, 10);
    mouse.rightClickAt(5, 5);

    expect(h.state.activeTableCell).toBeNull();
    const menu = UI.queryContextMenu();
    expect(
      menu?.querySelector(`[data-testid="insertTableRowAbove"]`),
    ).toBeNull();
    expect(menu?.querySelector(`[data-testid="deleteTableColumn"]`)).toBeNull();
  });

  it("inserts and deletes a row and a column at the targeted cell, one undo each", () => {
    const table = insertTableAt(300, 300);
    const targetRowId = table.rows[1].id;
    const targetColumnId = table.columns[1].id;
    const keptColumnIds = table.columns
      .filter((column) => column.id !== targetColumnId)
      .map((column) => column.id);

    mouse.rightClickAt(300, 300);
    const beforeRow = API.getUndoStack().length;
    UI.clickOnTestId("insertTableRowBelow");

    const withRow = liveTables()[0];
    expect(withRow.rows).toHaveLength(4);
    expect(withRow.rows[1].id).toBe(targetRowId);
    expect(withRow.rows[2].id).not.toBe(targetRowId);
    expect(liveCells(withRow.id)).toHaveLength(12);
    expect(API.getUndoStack()).toHaveLength(beforeRow + 1);

    Keyboard.undo();
    expect(liveTables()[0].rows).toHaveLength(3);

    mouse.rightClickAt(300, 300);
    const beforeColumn = API.getUndoStack().length;
    UI.clickOnTestId("deleteTableColumn");

    const withColumn = liveTables()[0];
    expect(withColumn.columns.map((column) => column.id)).toEqual(
      keptColumnIds,
    );
    expect(liveCells(withColumn.id)).toHaveLength(6);
    // The undone inserted row also leaves a deleted cell in this column.
    // The delete itself removes the three original cells.
    const originalRowIds = table.rows.map((row) => row.id);
    expect(
      liveCells(withColumn.id).filter(
        (element) =>
          isTableCell(element) && element.tableCell.columnId === targetColumnId,
      ),
    ).toHaveLength(0);
    expect(
      h.elements.filter(
        (element) =>
          isTableCell(element) &&
          element.isDeleted &&
          element.tableCell.columnId === targetColumnId &&
          originalRowIds.includes(element.tableCell.rowId),
      ),
    ).toHaveLength(3);
    expect(API.getUndoStack()).toHaveLength(beforeColumn + 1);

    Keyboard.undo();
    expect(liveTables()[0].columns).toHaveLength(3);
    expect(liveCells(liveTables()[0].id)).toHaveLength(9);
  });

  it("deletes the table when the last row is deleted, one undo per step", () => {
    insertTableAt(300, 300);
    let undoEntries = API.getUndoStack().length;

    for (let remaining = 3; remaining >= 1; remaining--) {
      const table = liveTables()[0];
      expect(table.rows).toHaveLength(remaining);
      mouse.rightClickAt(table.x + 1, table.y + 1);
      UI.clickOnTestId("deleteTableRow");
      undoEntries += 1;
      expect(API.getUndoStack()).toHaveLength(undoEntries);
    }

    expect(liveTables()).toHaveLength(0);

    Keyboard.undo();
    const restored = liveTables()[0];
    expect(restored.rows).toHaveLength(1);
    expect(restored.columns).toHaveLength(3);
    expect(liveCells(restored.id)).toHaveLength(3);
  });
});

describe("activeTableCell", () => {
  it("is neither exported nor stored in the browser", () => {
    const cell = { tableId: "t", rowId: "r", columnId: "c" };
    expect(
      cleanAppStateForExport({ activeTableCell: cell }),
    ).not.toHaveProperty("activeTableCell");
    expect(
      clearAppStateForLocalStorage({ activeTableCell: cell }),
    ).not.toHaveProperty("activeTableCell");
  });
});
