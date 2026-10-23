import React from "react";
import { vi } from "vitest";

import { DEFAULT_GRID_SIZE, KEYS } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  duplicateElements,
  isNonDeletedElement,
  isTableCell,
  isTableElement,
  newElementWith,
  newTableElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  actionAddToLibrary,
  actionAlignLeft,
  actionBringForward,
  actionDuplicateSelection,
  actionGroup,
  actionSendToBack,
  actionToggleElementLock,
  actionUngroup,
  distributeHorizontally,
} from "../actions";
import {
  actionRemoveAllElementsFromFrame,
  actionWrapSelectionInFrame,
} from "../actions/actionFrame";
import { createPasteEvent, serializeAsClipboardJSON } from "../clipboard";
import {
  convertElementTypes,
  getConversionTypeFromElements,
} from "../components/ConvertElementTypePopup";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  act,
  assertSelectedElements,
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

vi.mock("@excalidraw/common", async (importOriginal) => {
  const module = await importOriginal<typeof import("@excalidraw/common")>();
  const { mockThrottleRAF } = await import("./helpers/mocks");

  return {
    __esmodule: true,
    ...module,
    isDarwin: false,
    KEYS: {
      ...module.KEYS,
      CTRL_OR_CMD: "ctrlKey",
    },
    throttleRAF: mockThrottleRAF,
  };
});

const { h } = window;
const mouse = new Pointer("mouse");

const createTable = (x = 40, y = 40) => {
  const { table, cells } = newTableElement({ type: "table", x, y });
  return { table, cells: [...cells] };
};

const elementById = (id: string) => {
  const element = h.elements.find((candidate) => candidate.id === id);
  if (!element) {
    throw new Error(`missing element ${id}`);
  }
  return element;
};

const cellById = (id: string) => {
  const element = elementById(id);
  if (!isTableCell(element)) {
    throw new Error(`expected a table cell ${id}`);
  }
  return element;
};

const nonDeletedById = (id: string) => {
  const element = elementById(id);
  if (!isNonDeletedElement(element)) {
    throw new Error(`expected a live element ${id}`);
  }
  return element;
};

const liveCells = (tableId: string) =>
  h.elements.filter(
    (
      element,
    ): element is ExcalidrawTextElement & {
      tableCell: { rowId: string; columnId: string };
      containerId: string;
    } =>
      !element.isDeleted &&
      isTableCell(element) &&
      element.containerId === tableId,
  );

const cellLayout = (table: ExcalidrawElement) => {
  const current = elementById(table.id);
  if (!isTableElement(current)) {
    throw new Error("expected a table");
  }

  return {
    width: current.width,
    height: current.height,
    angle: current.angle,
    rows: current.rows.map((row) => ({ id: row.id, height: row.height })),
    columns: current.columns.map((column) => ({
      id: column.id,
      width: column.width,
    })),
    cells: liveCells(current.id)
      .map((cell) => ({
        rowId: cell.tableCell.rowId,
        columnId: cell.tableCell.columnId,
        dx: cell.x - current.x,
        dy: cell.y - current.y,
        width: cell.width,
        height: cell.height,
        text: cell.text,
        angle: cell.angle,
      }))
      .sort(
        (left, right) =>
          left.rowId.localeCompare(right.rowId) ||
          left.columnId.localeCompare(right.columnId),
      ),
  };
};

const expectCellsStackedAbove = (
  tableId: string,
  cellIds: readonly string[],
) => {
  const order = h.elements.map((element) => element.id);
  const tableIndex = order.indexOf(tableId);
  const cellIndices = cellIds.map((id) => order.indexOf(id));
  expect(Math.min(...cellIndices)).toBe(tableIndex + 1);
  expect(Math.max(...cellIndices)).toBe(tableIndex + cellIds.length);
};

const pasteWithCtrlV = (text: string) => {
  Keyboard.withModifierKeys({ ctrl: true }, () => {
    Keyboard.keyPress(KEYS.V);
    document.dispatchEvent(
      createPasteEvent({
        types: {
          "text/plain": text,
        },
      }),
    );
  });
};

describe("table element behavior", () => {
  beforeEach(async () => {
    unmountComponent();
    localStorage.clear();
    mouse.reset();

    await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
    API.setAppState({ width: 1920, height: 1080 });
    Object.assign(document, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  it("locks and unlocks the table and its cells together", () => {
    const { table, cells } = createTable();
    API.setElements([table, ...cells]);
    API.setSelectedElements([table]);

    API.executeAction(actionToggleElementLock);

    expect(elementById(table.id).locked).toBe(true);
    for (const cell of cells) {
      expect(cellById(cell.id).locked).toBe(true);
      expect(cellById(cell.id).originalText).toBe("");
    }

    const centerX = table.x + table.width / 2;
    const centerY = table.y + table.height / 2;
    mouse.rightClickAt(centerX, centerY);
    expect(API.getSelectedElements().map((element) => element.id)).toContain(
      table.id,
    );

    Keyboard.keyPress(KEYS.ENTER);
    expect(
      h.state.editingTextElement == null ||
        !isTableCell(h.state.editingTextElement),
    ).toBe(true);

    mouse.doubleClickAt(centerX, centerY);
    expect(
      h.state.editingTextElement == null ||
        !isTableCell(h.state.editingTextElement),
    ).toBe(true);
    for (const cell of cells) {
      expect(cellById(cell.id).originalText).toBe("");
      expect(cellById(cell.id).locked).toBe(true);
    }

    if (h.state.editingTextElement) {
      Keyboard.keyPress(KEYS.ESCAPE);
    }
    // The double-click may leave a free text at the center. The top edge
    // is still the locked table, which is what unlock has to select.
    mouse.rightClickAt(table.x + table.width / 2, table.y + 1);
    expect(API.getSelectedElements().map((element) => element.id)).toContain(
      table.id,
    );
    API.executeAction(actionToggleElementLock);

    expect(elementById(table.id).locked).toBe(false);
    for (const cell of cells) {
      expect(elementById(cell.id).locked).toBe(false);
    }
  });

  it("groups, edits inside the group, and ungroups the table with its cells", () => {
    const { table, cells } = createTable();
    const rectangle = API.createElement({
      type: "rectangle",
      x: 500,
      y: 0,
      width: 80,
      height: 80,
    });
    API.setElements([table, ...cells, rectangle]);
    API.setSelectedElements([table, rectangle]);

    API.executeAction(actionGroup);

    const groupId = elementById(table.id).groupIds[0];
    expect(groupId).toBeTruthy();
    expect(elementById(rectangle.id).groupIds).toEqual([groupId]);
    for (const cell of cells) {
      expect(elementById(cell.id).groupIds).toEqual([groupId]);
    }

    mouse.doubleClickOn(elementById(table.id));
    expect(h.state.editingGroupId).toBe(groupId);
    assertSelectedElements(table.id);

    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.editingGroupId).toBeNull();
    expect(h.state.selectedGroupIds[groupId]).toBe(true);

    API.executeAction(actionUngroup);

    expect(elementById(table.id).groupIds).toEqual([]);
    expect(elementById(rectangle.id).groupIds).toEqual([]);
    for (const cell of cells) {
      expect(elementById(cell.id).groupIds).toEqual([]);
    }
  });

  it("adds the table to a frame and removes it with its cells", () => {
    const { table, cells } = createTable();
    API.setElements([table, ...cells]);
    API.setSelectedElements([table]);

    API.executeAction(actionWrapSelectionInFrame);

    const frameId = elementById(table.id).frameId;
    expect(frameId).toBeTruthy();
    for (const cell of cells) {
      expect(elementById(cell.id).frameId).toBe(frameId);
    }

    API.setSelectedElements([nonDeletedById(frameId!)]);
    API.executeAction(actionRemoveAllElementsFromFrame);

    expect(elementById(table.id).frameId).toBeNull();
    for (const cell of cells) {
      expect(elementById(cell.id).frameId).toBeNull();
    }
  });

  it("pastes and duplicates a table with new ids and the same layout", async () => {
    const { table, cells } = createTable(80, 60);
    const labeled = newElementWith(cells[0], {
      text: "A1",
      originalText: "A1",
    });
    const nextCells = [labeled, ...cells.slice(1)];
    API.setElements([table, ...nextCells]);
    API.setSelectedElements([table]);

    const selected = API.getSelectedElements(true, true).filter(
      isNonDeletedElement,
    );
    expect(selected.map((element) => element.id).sort()).toEqual(
      [table.id, ...nextCells.map((cell) => cell.id)].sort(),
    );

    const before = cellLayout(table);
    const clipboardJSON = await serializeAsClipboardJSON({
      elements: selected,
      files: null,
    });
    pasteWithCtrlV(clipboardJSON);

    await waitFor(() => {
      expect(
        h.elements.filter((element) => isTableElement(element)),
      ).toHaveLength(2);
    });

    const pasted = h.elements.find(
      (element) => isTableElement(element) && element.id !== table.id,
    )!;
    const pastedCells = liveCells(pasted.id);
    expect(pasted.id).not.toBe(table.id);
    expect(pastedCells).toHaveLength(nextCells.length);
    expect(new Set(pastedCells.map((cell) => cell.id))).not.toEqual(
      new Set(nextCells.map((cell) => cell.id)),
    );
    expect(cellLayout(pasted)).toEqual(before);
    expect(pasted.boundElements?.map((binding) => binding.id).sort()).toEqual(
      pastedCells.map((cell) => cell.id).sort(),
    );
    expect(elementById(table.id).id).toBe(table.id);

    const countBeforeDuplicate = h.elements.length;
    API.setSelectedElements([table]);
    API.executeAction(actionDuplicateSelection);

    const duplicated = h.elements.filter(
      (element) =>
        isTableElement(element) &&
        element.id !== table.id &&
        element.id !== pasted.id,
    );
    expect(duplicated).toHaveLength(1);
    expect(h.elements).toHaveLength(
      countBeforeDuplicate + 1 + nextCells.length,
    );
    expect(cellLayout(duplicated[0])).toEqual(before);
    expect(duplicated[0].x).toBeCloseTo(table.x + DEFAULT_GRID_SIZE / 2);
    expect(duplicated[0].y).toBeCloseTo(table.y + DEFAULT_GRID_SIZE / 2);
    expect(elementById(table.id).x).toBe(table.x);
  });

  it("deletes the table and its cells, then restores them on undo", () => {
    const { table, cells } = createTable();
    act(() => {
      h.app.updateScene({
        elements: [table, ...cells],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    API.setSelectedElements([table]);

    Keyboard.keyPress(KEYS.DELETE);

    expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(0);
    expect(elementById(table.id).isDeleted).toBe(true);
    for (const cell of cells) {
      expect(elementById(cell.id).isDeleted).toBe(true);
    }

    Keyboard.undo();

    expect(elementById(table.id).isDeleted).toBe(false);
    for (const cell of cells) {
      expect(cellById(cell.id).isDeleted).toBe(false);
      expect(cellById(cell.id).containerId).toBe(table.id);
    }
    expectCellsStackedAbove(
      table.id,
      cells.map((cell) => cell.id),
    );
  });

  it("keeps cells immediately above the table when the z-order changes", () => {
    const { table, cells } = createTable(100, 100);
    const rectangle = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    });
    API.setElements([rectangle, table, ...cells]);
    API.setSelectedElements([rectangle]);

    API.executeAction(actionBringForward);

    expectCellsStackedAbove(
      table.id,
      cells.map((cell) => cell.id),
    );
    const order = h.elements.map((element) => element.id);
    expect(order.indexOf(rectangle.id)).toBeGreaterThan(
      order.indexOf(cells[cells.length - 1].id),
    );

    API.setElements([rectangle, table, ...cells]);
    API.setSelectedElements([table]);
    API.executeAction(actionSendToBack);

    expectCellsStackedAbove(
      table.id,
      cells.map((cell) => cell.id),
    );
    expect(h.elements[h.elements.length - 1].id).toBe(rectangle.id);
  });

  it("drags cells by the same offset as the table", () => {
    const { table, cells } = createTable(30, 30);
    API.setElements([table, ...cells]);

    const startX = table.x;
    const startY = table.y;
    const cellStarts = cells.map((cell) => ({
      id: cell.id,
      x: cell.x,
      y: cell.y,
    }));

    mouse.downAt(table.x + 40, table.y + 24);
    mouse.moveTo(table.x + 90, table.y + 74);
    mouse.upAt(table.x + 90, table.y + 74);

    const dx = elementById(table.id).x - startX;
    const dy = elementById(table.id).y - startY;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(10);
    for (const start of cellStarts) {
      expect(elementById(start.id).x - start.x).toBeCloseTo(dx);
      expect(elementById(start.id).y - start.y).toBeCloseTo(dy);
    }
  });

  it("aligns and distributes cells with the table", () => {
    const { table, cells } = createTable(200, 80);
    const left = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    });
    const right = API.createElement({
      type: "rectangle",
      x: 800,
      y: 0,
      width: 40,
      height: 40,
    });
    API.setElements([left, table, ...cells, right]);
    API.setSelectedElements([left, table]);

    const tableX = table.x;
    const cellStarts = cells.map((cell) => ({ id: cell.id, x: cell.x }));
    API.executeAction(actionAlignLeft);

    const dx = elementById(table.id).x - tableX;
    expect(dx).not.toBe(0);
    for (const start of cellStarts) {
      expect(elementById(start.id).x - start.x).toBeCloseTo(dx);
    }

    const distributedTableX = elementById(table.id).x;
    const distributedStarts = cells.map((cell) => ({
      id: cell.id,
      x: elementById(cell.id).x,
    }));
    API.setSelectedElements([left, table, right]);
    API.executeAction(distributeHorizontally);

    const distributedDx = elementById(table.id).x - distributedTableX;
    expect(distributedDx).not.toBe(0);
    for (const start of distributedStarts) {
      expect(elementById(start.id).x - start.x).toBeCloseTo(distributedDx);
    }
  });

  it("erases the table and every cell in one stroke", () => {
    const { table, cells } = createTable(20, 20);
    const bystander = API.createElement({
      type: "rectangle",
      x: 700,
      y: 700,
      width: 30,
      height: 30,
    });
    API.setElements([table, ...cells, bystander]);

    act(() => {
      h.app.setActiveTool({ type: "eraser" });
    });
    mouse.downAt(table.x + 20, table.y + 20);
    mouse.moveTo(table.x + table.width - 20, table.y + table.height - 20);
    mouse.upAt(table.x + table.width - 20, table.y + table.height - 20);

    expect(elementById(table.id).isDeleted).toBe(true);
    for (const cell of cells) {
      expect(elementById(cell.id).isDeleted).toBe(true);
    }
    expect(elementById(bystander.id).isDeleted).toBe(false);
  });

  it("binds an arrow to the table the way it binds to a rectangle", async () => {
    const { table, cells } = createTable(100, 100);
    API.setElements([table, ...cells]);

    UI.clickTool("arrow");
    mouse.downAt(table.x + 50, table.y + 40);
    mouse.upAt(table.x + table.width + 180, table.y + 40);

    await waitFor(() => {
      const arrow = h.elements.find((element) => element.type === "arrow");
      expect(arrow && "startBinding" in arrow && arrow.startBinding).toEqual(
        expect.objectContaining({ elementId: table.id }),
      );
    });

    const arrow = h.elements.find((element) => element.type === "arrow")!;
    const boundId =
      arrow && "startBinding" in arrow ? arrow.startBinding?.elementId : null;
    expect(cells.map((cell) => cell.id)).not.toContain(boundId);
  });

  it("stores the table and its cells as one library item", async () => {
    const { table, cells } = createTable();
    API.setElements([table, ...cells]);
    API.setSelectedElements([table]);

    await act(async () => {
      await h.app.library.resetLibrary();
    });
    API.executeAction(actionAddToLibrary);

    await waitFor(async () => {
      const items = await h.app.library.getLatestLibrary();
      expect(items).toHaveLength(1);
      expect(items[0].elements.filter(isTableElement)).toHaveLength(1);
      expect(items[0].elements.filter(isTableCell)).toHaveLength(cells.length);
    });

    const [item] = await h.app.library.getLatestLibrary();
    const storedTable = item.elements.find(isTableElement)!;
    expect(
      item.elements.filter(
        (element) =>
          isTableCell(element) && element.containerId === storedTable.id,
      ),
    ).toHaveLength(cells.length);

    const { duplicatedElements } = duplicateElements({
      type: "everything",
      elements: item.elements,
      randomizeSeed: true,
      preserveFrameChildrenOrder: true,
    });
    const inserted = duplicatedElements.find(isTableElement)!;
    const insertedCells = duplicatedElements.filter(isTableCell);
    expect(inserted.id).not.toBe(storedTable.id);
    expect(insertedCells).toHaveLength(cells.length);
    expect(
      insertedCells.every(
        (cell) =>
          cell.containerId === inserted.id &&
          cell.tableCell.rowId &&
          cell.tableCell.columnId,
      ),
    ).toBe(true);
    expect(cellLayoutFrom(inserted, insertedCells)).toEqual(
      cellLayoutFrom(storedTable, item.elements.filter(isTableCell)),
    );

    await act(async () => {
      await h.app.library.resetLibrary();
    });
  });

  it("does not offer shape conversion for a table or its cells", () => {
    const { table, cells } = createTable();
    const rectangle = API.createElement({
      type: "rectangle",
      x: 600,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([table, ...cells, rectangle]);

    expect(getConversionTypeFromElements([table, ...cells])).toBeNull();
    expect(getConversionTypeFromElements([table, rectangle])).toBe("generic");

    API.setSelectedElements([table, rectangle]);
    act(() => {
      convertElementTypes(h.app, {
        conversionType: "generic",
        nextType: "ellipse",
      });
    });

    expect(elementById(table.id).type).toBe("table");
    expect(elementById(rectangle.id).type).toBe("ellipse");
    expect(liveCells(table.id)).toHaveLength(cells.length);
  });
});

const cellLayoutFrom = (
  table: ExcalidrawElement,
  cells: readonly ExcalidrawElement[],
) => {
  if (!isTableElement(table)) {
    throw new Error("expected a table");
  }
  return cells
    .filter(isTableCell)
    .map((cell) => ({
      rowId: cell.tableCell.rowId,
      columnId: cell.tableCell.columnId,
      dx: cell.x - table.x,
      dy: cell.y - table.y,
      width: cell.width,
      height: cell.height,
      text: cell.text,
    }))
    .sort(
      (left, right) =>
        left.rowId.localeCompare(right.rowId) ||
        left.columnId.localeCompare(right.columnId),
    );
};
