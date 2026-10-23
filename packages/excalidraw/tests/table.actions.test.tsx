import React from "react";

import { act } from "@testing-library/react";

import {
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_WIDTH,
  FONT_FAMILY,
  STROKE_WIDTH,
} from "@excalidraw/common";

import { getTargetElements, isTableCell } from "@excalidraw/element";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  actionChangeBackgroundColor,
  actionChangeFontFamily,
  actionChangeFontSize,
  actionChangeOpacity,
  actionChangeStrokeColor,
  actionChangeStrokeWidth,
  actionChangeTextAlign,
} from "../actions";
import {
  actionChangeSloppiness,
  actionChangeStrokeStyle,
} from "../actions/actionProperties";
import {
  cleanAppStateForExport,
  clearAppStateForLocalStorage,
} from "../appState";
import { getShapeActionPredicates } from "../components/shapeActionPredicates";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render } from "./test-utils";

const { h } = window;

const mouse = new Pointer("mouse");

const liveTables = () =>
  h.elements.filter(
    (element): element is NonDeleted<ExcalidrawTableElement> =>
      element.type === "table" && !element.isDeleted,
  );

const liveCells = (tableId: string) =>
  h.elements.filter(
    (element): element is ExcalidrawTextElement =>
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

describe("table styles", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    mouse.reset();
  });

  it("applies stroke, background, and font to the selected table and its cells, and undo restores them", () => {
    const table = insertTableAt(300, 300);
    API.setSelectedElements([table]);
    const cellsBefore = liveCells(table.id).map((cell) => ({
      id: cell.id,
      x: cell.x,
      y: cell.y,
      strokeWidth: cell.strokeWidth,
      backgroundColor: cell.backgroundColor,
      fontSize: cell.fontSize,
      fontFamily: cell.fontFamily,
      textAlign: cell.textAlign,
      opacity: cell.opacity,
    }));
    const original = {
      strokeColor: table.strokeColor,
      backgroundColor: table.backgroundColor,
      strokeWidth: table.strokeWidth,
      strokeStyle: table.strokeStyle,
      roughness: table.roughness,
      opacity: table.opacity,
      width: table.width,
      height: table.height,
    };

    const predicates = getShapeActionPredicates(
      h.state,
      getTargetElements(h.elements, h.state),
      h.app.scene.getNonDeletedElementsMap(),
      h.app,
    );
    expect(predicates.strokeColor).toBe(true);
    expect(predicates.backgroundColor).toBe(true);
    expect(predicates.strokeWidth).toBe(true);
    expect(predicates.strokeStyle).toBe(true);
    expect(predicates.sloppiness).toBe(true);
    expect(predicates.text).toBe(true);
    expect(predicates.textAlign).toBe(true);

    let undoEntries = API.getUndoStack().length;
    const apply = (
      action: Parameters<typeof h.app.actionManager.executeAction>[0],
      value: Parameters<typeof h.app.actionManager.executeAction>[2],
    ) => {
      act(() => {
        h.app.actionManager.executeAction(action, "ui", value);
      });
      undoEntries += 1;
      expect(API.getUndoStack()).toHaveLength(undoEntries);
    };

    apply(actionChangeStrokeColor, { color: "#ff0000" });
    apply(actionChangeBackgroundColor, { color: "#fab005" });
    apply(actionChangeStrokeWidth, "bold");
    apply(actionChangeStrokeStyle, "dashed");
    apply(actionChangeSloppiness, 0);
    apply(actionChangeOpacity, 40);
    apply(actionChangeFontSize, 36);
    apply(actionChangeFontFamily, {
      currentItemFontFamily: FONT_FAMILY.Helvetica,
    });
    apply(actionChangeTextAlign, "center");

    const styled = liveTables()[0];
    expect(styled.strokeColor).toBe("#ff0000");
    expect(styled.backgroundColor).toBe("#fab005");
    expect(styled.strokeWidth).toBe(STROKE_WIDTH.bold);
    expect(styled.strokeStyle).toBe("dashed");
    expect(styled.roughness).toBe(0);
    expect(styled.opacity).toBe(40);
    expect(styled.width).toBe(original.width);
    expect(styled.height).toBe(original.height);

    const styledCells = liveCells(table.id);
    expect(styledCells).toHaveLength(cellsBefore.length);
    for (const cell of styledCells) {
      const before = cellsBefore.find((item) => item.id === cell.id)!;
      expect(cell.strokeColor).toBe("#ff0000");
      expect(cell.backgroundColor).toBe(before.backgroundColor);
      expect(cell.strokeWidth).toBe(before.strokeWidth);
      expect(cell.opacity).toBe(40);
      expect(cell.fontSize).toBe(36);
      expect(cell.fontFamily).toBe(FONT_FAMILY.Helvetica);
      expect(cell.textAlign).toBe("center");
      expect(cell.x).toBe(before.x);
      expect(cell.y).toBe(before.y);
    }

    Keyboard.undo();
    expect(liveCells(table.id).every((cell) => cell.textAlign === "left")).toBe(
      true,
    );
    expect(liveCells(table.id).every((cell) => cell.fontSize === 36)).toBe(
      true,
    );

    for (let step = 0; step < 8; step++) {
      Keyboard.undo();
    }

    const restored = liveTables()[0];
    expect(restored.strokeColor).toBe(original.strokeColor);
    expect(restored.backgroundColor).toBe(original.backgroundColor);
    expect(restored.strokeWidth).toBe(original.strokeWidth);
    expect(restored.strokeStyle).toBe(original.strokeStyle);
    expect(restored.roughness).toBe(original.roughness);
    expect(restored.opacity).toBe(original.opacity);
    for (const cell of liveCells(table.id)) {
      const before = cellsBefore.find((item) => item.id === cell.id)!;
      expect(cell.strokeColor).toBe(original.strokeColor);
      expect(cell.fontSize).toBe(before.fontSize);
      expect(cell.fontFamily).toBe(before.fontFamily);
      expect(cell.textAlign).toBe(before.textAlign);
      expect(cell.opacity).toBe(before.opacity);
    }
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
