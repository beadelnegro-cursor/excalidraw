import React from "react";

import { KEYS, TABLE_CELL_PADDING } from "@excalidraw/common";
import { fireEvent } from "@testing-library/react";

import {
  getTableCellElements,
  getTableLayout,
  isTableCell,
  isTableElement,
  newTableElement,
} from "@excalidraw/element";

import type {
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { getTextEditor, updateTextEditor } from "./queries/dom";
import { render } from "./test-utils";

const { h } = window;
const mouse = new Pointer("mouse");

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
      isDeleted: cell.isDeleted,
    })),
  };
};

const mount = async (opts?: { rows?: number; columns?: number }) => {
  const built = newTableElement({
    type: "table",
    x: 120,
    y: 80,
    ...opts,
  });
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={{ elements: [built.table, ...built.cells] }}
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
  const targetId = cellAt(row, column).id;
  const center = cellCenter(row, column);
  mouse.doubleClickAt(center.x, center.y);
  const editor = await getTextEditor();
  expect(h.state.editingTextElement?.id).toBe(targetId);
  updateTextEditor(editor, value);
  Keyboard.exitTextEditor(editor);
  expect(h.state.editingTextElement).toBeNull();
  return targetId;
};

describe("table cell text", () => {
  it("edits several cells in their own slots", async () => {
    await mount();
    const firstId = await editCell(0, 0, "alpha");
    const secondId = await editCell(1, 2, "beta");

    const table = liveTable();
    const first = h.elements.find((element) => element.id === firstId) as
      | ExcalidrawTextElement
      | undefined;
    const second = h.elements.find((element) => element.id === secondId) as
      | ExcalidrawTextElement
      | undefined;
    expect(first?.originalText).toBe("alpha");
    expect(second?.originalText).toBe("beta");
    expect(cellAt(0, 1).originalText).toBe("");

    const layout = getTableLayout(table, h.elements);
    expect(first!.x).toBeCloseTo(layout.cellUpdates.get(firstId)!.x);
    expect(first!.y).toBeCloseTo(layout.cellUpdates.get(firstId)!.y);
    expect(second!.x).toBeCloseTo(layout.cellUpdates.get(secondId)!.x);
    expect(second!.y).toBeCloseTo(layout.cellUpdates.get(secondId)!.y);

    const centeredX = table.x + (table.width - first!.width) / 2;
    expect(Math.abs(first!.x - centeredX)).toBeGreaterThan(1);
    expect(first!.x).toBeGreaterThanOrEqual(table.x);
    expect(first!.x).toBeLessThan(table.x + table.columns[0].width);
    expect(second!.x).toBeGreaterThanOrEqual(
      table.x + table.columns[0].width + table.columns[1].width,
    );
    expect(first!.y).toBeCloseTo(table.y + TABLE_CELL_PADDING);
  });

  it("grows a row to fit text and shrinks it back, keeping the empty cell", async () => {
    await mount();
    const original = geometry();
    const targetId = cellAt(0, 0).id;

    await editCell(0, 0, "a\nb\nc\nd");

    const grown = liveTable();
    const grownCell = h.elements.find(
      (element) => element.id === targetId,
    ) as ExcalidrawTextElement;
    expect(grown.rows[0].height).toBe(original.rows[0].height);
    expect(grown.rows[0].id).toBe(original.rows[0].id);
    expect(grown.height).toBeGreaterThan(original.height);
    expect(grownCell.originalText).toBe("a\nb\nc\nd");
    expect(grownCell.text).toBe("a\nb\nc\nd");
    expect(cellAt(1, 0).y).toBeGreaterThan(original.cells[3].y);

    await editCell(0, 0, "");

    const shrunk = liveTable();
    const emptied = h.elements.find((element) => element.id === targetId);
    expect(shrunk.height).toBe(original.height);
    expect(shrunk.rows.map((row) => row.height)).toEqual(
      original.rows.map((row) => row.height),
    );
    expect(emptied && !emptied.isDeleted).toBe(true);
    expect(isTableCell(emptied)).toBe(true);
    expect((emptied as ExcalidrawTextElement).originalText).toBe("");
    expect((emptied as ExcalidrawTextElement).containerId).toBe(shrunk.id);
    expect(liveCells()).toHaveLength(original.cells.length);
    expect(
      shrunk.boundElements?.filter((binding) => binding.type === "text"),
    ).toHaveLength(original.cells.length);
    expect(cellAt(1, 0).y).toBeCloseTo(original.cells[3].y);
  });

  it("moves between cells with tab and shift+tab", async () => {
    await mount();
    API.setSelectedElements([liveTable()]);
    Keyboard.keyPress(KEYS.ENTER);

    const first = await getTextEditor();
    expect(h.state.editingTextElement?.id).toBe(cellAt(0, 0).id);
    updateTextEditor(first, "one");
    fireEvent.keyDown(first, { key: KEYS.TAB });

    const second = await getTextEditor();
    expect(h.state.editingTextElement?.id).toBe(cellAt(0, 1).id);
    expect(second.value).toBe("");
    updateTextEditor(second, "two");
    fireEvent.keyDown(second, { key: KEYS.TAB, shiftKey: true });

    const back = await getTextEditor();
    expect(h.state.editingTextElement?.id).toBe(cellAt(0, 0).id);
    expect(back.value).toBe("one");
    fireEvent.keyDown(back, { key: KEYS.TAB, shiftKey: true });

    const last = await getTextEditor();
    expect(h.state.editingTextElement?.id).toBe(cellAt(2, 2).id);
    expect(last.value).toBe("");
    Keyboard.exitTextEditor(last);

    expect(cellAt(0, 0).originalText).toBe("one");
    expect(cellAt(0, 1).originalText).toBe("two");
    expect(cellAt(0, 2).originalText).toBe("");
    expect(cellAt(2, 2).isDeleted).toBe(false);
    expect(liveCells()).toHaveLength(9);
  });

  it("does not indent when tab is pressed in the only cell", async () => {
    await mount({ rows: 1, columns: 1 });
    API.setSelectedElements([liveTable()]);
    Keyboard.keyPress(KEYS.ENTER);
    const editor = await getTextEditor();
    updateTextEditor(editor, "only");
    fireEvent.keyDown(editor, { key: KEYS.TAB });

    expect(h.state.editingTextElement?.id).toBe(cellAt(0, 0).id);
    const still = await getTextEditor();
    expect(still.value).toBe("only");
    Keyboard.exitTextEditor(still);
    expect(cellAt(0, 0).originalText).toBe("only");
  });

  it("starts the clicked cell on double-click and the first cell on enter", async () => {
    await mount();
    const center = cellCenter(1, 1);
    mouse.doubleClickAt(center.x, center.y);
    expect((await getTextEditor()) && h.state.editingTextElement?.id).toBe(
      cellAt(1, 1).id,
    );
    Keyboard.exitTextEditor(await getTextEditor());

    API.setSelectedElements([liveTable()]);
    Keyboard.keyPress(KEYS.ENTER);
    expect((await getTextEditor()) && h.state.editingTextElement?.id).toBe(
      cellAt(0, 0).id,
    );
  });

  it("restores text and geometry on undo and redo of each edit", async () => {
    await mount();
    const initial = geometry();

    await editCell(0, 0, "alpha");
    const afterFirst = geometry();
    expect(afterFirst.cells[0].originalText).toBe("alpha");
    expect(afterFirst.height).toBe(initial.height);

    await editCell(0, 1, "a\nb\nc\nd");
    const afterSecond = geometry();
    expect(afterSecond.height).toBeGreaterThan(afterFirst.height);
    expect(afterSecond.rows[0].height).toBe(initial.rows[0].height);
    expect(afterSecond.cells[0].originalText).toBe("alpha");
    expect(afterSecond.cells[1].originalText).toBe("a\nb\nc\nd");

    await editCell(0, 1, "");
    const afterThird = geometry();
    expect(afterThird.height).toBe(initial.height);
    expect(afterThird.cells[0].originalText).toBe("alpha");
    expect(afterThird.cells[1].originalText).toBe("");
    expect(afterThird.cells[1].isDeleted).toBe(false);

    Keyboard.undo();
    expect(geometry()).toEqual(afterSecond);
    Keyboard.undo();
    expect(geometry()).toEqual(afterFirst);
    Keyboard.undo();
    expect(geometry()).toEqual(initial);

    Keyboard.redo();
    expect(geometry()).toEqual(afterFirst);
    Keyboard.redo();
    expect(geometry()).toEqual(afterSecond);
    Keyboard.redo();
    expect(geometry()).toEqual(afterThird);
  });
});
