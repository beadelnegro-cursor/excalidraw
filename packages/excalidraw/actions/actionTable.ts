import { pointFrom } from "@excalidraw/math";

import {
  CaptureUpdateAction,
  deleteTableColumn,
  deleteTableRow,
  fixBindingsAfterDeletion,
  getTableCellAt,
  getTableCellElements,
  insertTableColumn,
  insertTableRow,
  isTableCell,
  isTableElement,
} from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { register } from "./register";

import type { AppState } from "../types";

import type { Action, ActionName } from "./types";

/**
 * Right-click position wins. The cell being edited is the fallback when the
 * pointer is not on a table (S3 sets `editingTextElement`; this slice only
 * reads it).
 */
export const resolveActiveTableCell = ({
  elements,
  hit,
  point,
  editingTextElement,
}: {
  elements: readonly ExcalidrawElement[];
  hit: ExcalidrawElement | null;
  point: { readonly x: number; readonly y: number };
  editingTextElement: AppState["editingTextElement"];
}): AppState["activeTableCell"] => {
  if (hit && isTableCell(hit)) {
    return {
      tableId: hit.containerId,
      rowId: hit.tableCell.rowId,
      columnId: hit.tableCell.columnId,
    };
  }

  const edited =
    editingTextElement && isTableCell(editingTextElement)
      ? {
          tableId: editingTextElement.containerId,
          rowId: editingTextElement.tableCell.rowId,
          columnId: editingTextElement.tableCell.columnId,
        }
      : null;

  if (hit && isTableElement(hit)) {
    const address = getTableCellAt(
      hit,
      pointFrom<GlobalPoint>(point.x, point.y),
      elements,
    );
    if (address) {
      return { tableId: hit.id, ...address };
    }
    if (edited?.tableId === hit.id) {
      return edited;
    }
    return null;
  }

  return edited;
};

const getActionTarget = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
) => {
  const target = appState.activeTableCell;
  if (!target || appState.viewModeEnabled) {
    return null;
  }
  const table = elements.find(
    (element): element is ExcalidrawTableElement =>
      isTableElement(element) &&
      !element.isDeleted &&
      element.id === target.tableId,
  );
  if (!table || table.locked) {
    return null;
  }
  if (
    !table.rows.some((row) => row.id === target.rowId) ||
    !table.columns.some((column) => column.id === target.columnId)
  ) {
    return null;
  }
  const editingThisTable =
    !!appState.editingTextElement &&
    isTableCell(appState.editingTextElement) &&
    appState.editingTextElement.containerId === table.id;
  const selected =
    !!appState.selectedElementIds[table.id] ||
    editingThisTable ||
    elements.some(
      (element) =>
        isTableCell(element) &&
        !element.isDeleted &&
        element.containerId === table.id &&
        !!appState.selectedElementIds[element.id],
    );
  if (!selected) {
    return null;
  }
  return { table, target };
};

const applyStructureChange = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  table: ExcalidrawTableElement,
  change: {
    table: ExcalidrawTableElement;
    addedCells: readonly ExcalidrawTextElement[];
    deletedCells: readonly ExcalidrawTextElement[];
  },
) => {
  if (
    change.table === table &&
    change.addedCells.length === 0 &&
    change.deletedCells.length === 0
  ) {
    return false;
  }

  const deletedById = new Map(
    change.deletedCells.map((cell) => [cell.id, cell]),
  );
  const next: ExcalidrawElement[] = [];
  for (const element of elements) {
    if (element.id === table.id) {
      next.push(change.table);
      continue;
    }
    const deleted = deletedById.get(element.id);
    next.push(deleted ?? element);
  }

  if (change.addedCells.length) {
    let insertAt = next.findIndex((element) => element.id === change.table.id);
    for (let index = insertAt + 1; index < next.length; index++) {
      const element = next[index];
      if (
        isTableCell(element) &&
        !element.isDeleted &&
        element.containerId === change.table.id
      ) {
        insertAt = index;
      }
    }
    next.splice(insertAt + 1, 0, ...change.addedCells);
  }

  if (change.table.isDeleted) {
    fixBindingsAfterDeletion(next, [change.table, ...change.deletedCells]);
  }

  const selectedElementIds = { ...appState.selectedElementIds };
  for (const cell of change.deletedCells) {
    delete selectedElementIds[cell.id];
  }
  if (change.table.isDeleted) {
    delete selectedElementIds[change.table.id];
  }

  const target = appState.activeTableCell;
  const activeTableCell =
    !target ||
    change.table.isDeleted ||
    !change.table.rows.some((row) => row.id === target.rowId) ||
    !change.table.columns.some((column) => column.id === target.columnId)
      ? null
      : target;

  const editing = appState.editingTextElement;
  const editingTextElement =
    editing && !change.table.isDeleted && !deletedById.has(editing.id)
      ? editing
      : null;

  return {
    elements: next,
    appState: {
      ...appState,
      selectedElementIds,
      activeTableCell,
      editingTextElement,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  };
};

const performOnTarget = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  changeFor: (
    table: ExcalidrawTableElement,
    cells: readonly ExcalidrawTextElement[],
    target: NonNullable<AppState["activeTableCell"]>,
  ) => {
    table: ExcalidrawTableElement;
    addedCells: readonly ExcalidrawTextElement[];
    deletedCells: readonly ExcalidrawTextElement[];
  },
) => {
  const found = getActionTarget(elements, appState);
  if (!found) {
    return false;
  }
  const cells = getTableCellElements(found.table, elements);
  return applyStructureChange(
    elements,
    appState,
    found.table,
    changeFor(found.table, cells, found.target),
  );
};

const tableAction = (
  name: ActionName,
  label: string,
  keywords: string[],
  changeFor: (
    table: ExcalidrawTableElement,
    cells: readonly ExcalidrawTextElement[],
    target: NonNullable<AppState["activeTableCell"]>,
  ) => {
    table: ExcalidrawTableElement;
    addedCells: readonly ExcalidrawTextElement[];
    deletedCells: readonly ExcalidrawTextElement[];
  },
): Action =>
  register({
    name,
    label,
    keywords,
    trackEvent: { category: "element" },
    predicate: (elements, appState) =>
      getActionTarget(elements, appState) !== null,
    perform: (elements, appState) =>
      performOnTarget(elements, appState, changeFor),
  });

export const actionInsertTableRowAbove = tableAction(
  "insertTableRowAbove",
  "labels.insertTableRowAbove",
  ["table", "row"],
  (table, cells, target) =>
    insertTableRow(table, cells, { rowId: target.rowId, position: "above" }),
);

export const actionInsertTableRowBelow = tableAction(
  "insertTableRowBelow",
  "labels.insertTableRowBelow",
  ["table", "row"],
  (table, cells, target) =>
    insertTableRow(table, cells, { rowId: target.rowId, position: "below" }),
);

export const actionInsertTableColumnLeft = tableAction(
  "insertTableColumnLeft",
  "labels.insertTableColumnLeft",
  ["table", "column"],
  (table, cells, target) =>
    insertTableColumn(table, cells, {
      columnId: target.columnId,
      position: "left",
    }),
);

export const actionInsertTableColumnRight = tableAction(
  "insertTableColumnRight",
  "labels.insertTableColumnRight",
  ["table", "column"],
  (table, cells, target) =>
    insertTableColumn(table, cells, {
      columnId: target.columnId,
      position: "right",
    }),
);

export const actionDeleteTableRow = tableAction(
  "deleteTableRow",
  "labels.deleteTableRow",
  ["table", "row"],
  (table, cells, target) => deleteTableRow(table, cells, target.rowId),
);

export const actionDeleteTableColumn = tableAction(
  "deleteTableColumn",
  "labels.deleteTableColumn",
  ["table", "column"],
  (table, cells, target) => deleteTableColumn(table, cells, target.columnId),
);
