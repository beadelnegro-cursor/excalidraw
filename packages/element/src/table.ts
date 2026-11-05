import {
  arrayToMap,
  DEFAULT_TABLE_COLUMN_WIDTH,
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_ROW_HEIGHT,
  DEFAULT_TABLE_WIDTH,
  getFontString,
  randomId,
  TABLE_CELL_PADDING,
  TABLE_DEFAULT_COLUMN_COUNT,
  TABLE_DEFAULT_ROW_COUNT,
  TABLE_MIN_COLUMN_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
  TEXT_ALIGN,
  VERTICAL_ALIGN,
} from "@excalidraw/common";

import { pointFrom, pointRotateRads, type GlobalPoint } from "@excalidraw/math";

import type { Radians } from "@excalidraw/math";

import { newElementWith } from "./mutateElement";
import { newTextElement } from "./newElement";
import {
  getPositionAfterHeightChange,
  type VerticalResizeAnchor,
} from "./sizeHelpers";
import { measureText } from "./textMeasurements";
import { wrapText } from "./textWrapping";
import { isTableCell, isTableElement, isTextElement } from "./typeChecks";

import type { RenderEnvironment } from "./renderEnvironment";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
  NonDeleted,
  TableColumn,
  TableRow,
} from "./types";

export type TableCellAddress = Readonly<{
  rowId: string;
  columnId: string;
}>;

/** Unrotated cell rectangle, origin at the table's top-left. */
export type TableGridCell = Readonly<{
  rowId: string;
  columnId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type TableCellUpdate = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  angle: Radians;
}>;

export type TableLayout = Readonly<{
  table: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    rows?: readonly TableRow[];
    columns?: readonly TableColumn[];
  }>;
  cellUpdates: ReadonlyMap<string, TableCellUpdate>;
  /** Effective row heights, same order as `table.rows`. */
  rowHeights: readonly number[];
  columnWidths: readonly number[];
  grid: readonly TableGridCell[];
}>;

export type TableStructureChange = {
  table: ExcalidrawTableElement;
  addedCells: readonly ExcalidrawTextElement[];
  deletedCells: readonly ExcalidrawTextElement[];
};

const HIT_EPSILON = 1e-6;

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampSize = (value: unknown, min: number, fallback: number) =>
  Math.max(finiteOr(value, fallback), min);

export const sanitizeTableCell = (value: unknown): TableCellAddress | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rowId = (value as { rowId?: unknown }).rowId;
  const columnId = (value as { columnId?: unknown }).columnId;
  if (typeof rowId !== "string" || !rowId) {
    return null;
  }
  if (typeof columnId !== "string" || !columnId) {
    return null;
  }
  return { rowId, columnId };
};

export const sanitizeTableRows = (value: unknown): readonly TableRow[] => {
  if (!Array.isArray(value)) {
    return [{ id: randomId(), height: DEFAULT_TABLE_ROW_HEIGHT }];
  }
  const seen = new Set<string>();
  const rows: TableRow[] = [];
  let changed = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      changed = true;
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || !id || seen.has(id)) {
      changed = true;
      continue;
    }
    seen.add(id);
    const height = clampSize(
      (entry as { height?: unknown }).height,
      TABLE_MIN_ROW_HEIGHT,
      DEFAULT_TABLE_ROW_HEIGHT,
    );
    if ((entry as TableRow).height === height) {
      rows.push(entry as TableRow);
    } else {
      changed = true;
      rows.push({ id, height });
    }
  }
  if (!rows.length) {
    return [{ id: randomId(), height: DEFAULT_TABLE_ROW_HEIGHT }];
  }
  return !changed && rows.length === value.length
    ? (value as readonly TableRow[])
    : rows;
};

export const sanitizeTableColumns = (
  value: unknown,
): readonly TableColumn[] => {
  if (!Array.isArray(value)) {
    return [{ id: randomId(), width: DEFAULT_TABLE_COLUMN_WIDTH }];
  }
  const seen = new Set<string>();
  const columns: TableColumn[] = [];
  let changed = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      changed = true;
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || !id || seen.has(id)) {
      changed = true;
      continue;
    }
    seen.add(id);
    const width = clampSize(
      (entry as { width?: unknown }).width,
      TABLE_MIN_COLUMN_WIDTH,
      DEFAULT_TABLE_COLUMN_WIDTH,
    );
    if ((entry as TableColumn).width === width) {
      columns.push(entry as TableColumn);
    } else {
      changed = true;
      columns.push({ id, width });
    }
  }
  if (!columns.length) {
    return [{ id: randomId(), width: DEFAULT_TABLE_COLUMN_WIDTH }];
  }
  return !changed && columns.length === value.length
    ? (value as readonly TableColumn[])
    : columns;
};

const splitExtent = (total: number, count: number, min: number) => {
  const safeCount = Math.max(1, Math.floor(count) || 1);
  const safeTotal =
    Number.isFinite(total) && total > 0 ? total : min * safeCount;
  const even = safeTotal / safeCount;
  if (even < min) {
    return Array.from({ length: safeCount }, () => min);
  }
  const sizes = Array.from({ length: safeCount }, () => even);
  sizes[safeCount - 1] = safeTotal - even * (safeCount - 1);
  return sizes;
};

export const buildTableGrid = (opts: {
  rows?: number | readonly TableRow[];
  columns?: number | readonly TableColumn[];
  width?: number;
  height?: number;
}): { rows: readonly TableRow[]; columns: readonly TableColumn[] } => {
  const rowSpec = opts.rows;
  const columnSpec = opts.columns;
  const rows =
    typeof rowSpec === "number" || rowSpec == null
      ? splitExtent(
          opts.height ?? DEFAULT_TABLE_HEIGHT,
          rowSpec ?? TABLE_DEFAULT_ROW_COUNT,
          TABLE_MIN_ROW_HEIGHT,
        ).map((height) => ({ id: randomId(), height }))
      : sanitizeTableRows(rowSpec);
  const columns =
    typeof columnSpec === "number" || columnSpec == null
      ? splitExtent(
          opts.width ?? DEFAULT_TABLE_WIDTH,
          columnSpec ?? TABLE_DEFAULT_COLUMN_COUNT,
          TABLE_MIN_COLUMN_WIDTH,
        ).map((width) => ({ id: randomId(), width }))
      : sanitizeTableColumns(columnSpec);
  return { rows, columns };
};

const slotKey = (slot: TableCellAddress) => `${slot.rowId}\0${slot.columnId}`;

const asElements = (
  elements: readonly ExcalidrawElement[] | ElementsMap,
): readonly ExcalidrawElement[] =>
  elements instanceof Map ? Array.from(elements.values()) : elements;

export type TableCellElement = ExcalidrawTextElement & {
  tableCell: TableCellAddress;
  containerId: string;
};

/**
 * Non-deleted cells of `table`, one per occupied slot, in row-major order.
 * A slot with no element is omitted (it is drawn empty and created on edit).
 */
export const getTableCellElements = (
  table: ExcalidrawTableElement,
  elements: readonly ExcalidrawElement[] | ElementsMap,
): NonDeleted<TableCellElement>[] => {
  const rowIndex = new Map(table.rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(
    table.columns.map((column, index) => [column.id, index]),
  );
  const bySlot = new Map<string, NonDeleted<TableCellElement>>();
  for (const element of asElements(elements)) {
    if (
      !isTableCell(element) ||
      element.isDeleted ||
      element.containerId !== table.id ||
      !rowIndex.has(element.tableCell.rowId) ||
      !columnIndex.has(element.tableCell.columnId)
    ) {
      continue;
    }
    const key = slotKey(element.tableCell);
    if (!bySlot.has(key)) {
      bySlot.set(key, element as NonDeleted<TableCellElement>);
    }
  }
  const ordered: NonDeleted<TableCellElement>[] = [];
  for (const row of table.rows) {
    for (const column of table.columns) {
      const cell = bySlot.get(slotKey({ rowId: row.id, columnId: column.id }));
      if (cell) {
        ordered.push(cell);
      }
    }
  }
  return ordered;
};

const alignOffset = (
  align:
    | ExcalidrawTextElement["textAlign"]
    | ExcalidrawTextElement["verticalAlign"],
  content: number,
  size: number,
) => {
  if (align === TEXT_ALIGN.CENTER || align === VERTICAL_ALIGN.MIDDLE) {
    return (content - size) / 2;
  }
  if (align === TEXT_ALIGN.RIGHT || align === VERTICAL_ALIGN.BOTTOM) {
    return content - size;
  }
  return 0;
};

/**
 * Pure geometry of a table: column widths sum to `width`, each row is the
 * larger of its base height and its tallest cell plus padding, and cell text
 * is wrapped to the column and placed inside its cell. Blank cells do not
 * grow the row. Elements that already match are left for the caller to keep.
 */
export const getTableLayout = (
  table: ExcalidrawTableElement,
  elements: readonly ExcalidrawElement[] | ElementsMap,
  opts?: {
    renderEnvironment?: RenderEnvironment;
    /**
     * Which edge stays put when content makes the table taller than
     * `table.height`. Resize passes the edge the gesture holds still.
     * Defaults to the top, which is what typing and restore want.
     */
    anchor?: VerticalResizeAnchor;
  },
): TableLayout => {
  const rows = sanitizeTableRows(table.rows);
  const columns = sanitizeTableColumns(table.columns);
  const columnWidths = columns.map((column) => column.width);
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(
    columns.map((column, index) => [column.id, index]),
  );
  const contentHeight = rows.map(() => 0);
  const measured = new Map<
    string,
    { text: string; width: number; height: number }
  >();

  for (const element of getTableCellElements(
    { ...table, rows, columns },
    elements,
  )) {
    const row = rowIndex.get(element.tableCell.rowId)!;
    const column = columnIndex.get(element.tableCell.columnId)!;
    const maxWidth = Math.max(columnWidths[column] - TABLE_CELL_PADDING * 2, 1);
    const blank = !element.originalText.trim();
    const font = getFontString(element);
    const text = blank
      ? ""
      : wrapText(element.originalText, font, maxWidth, opts?.renderEnvironment);
    const metrics = measureText(
      text,
      font,
      element.lineHeight,
      opts?.renderEnvironment,
    );
    measured.set(element.id, {
      text,
      width: metrics.width,
      height: metrics.height,
    });
    if (!blank) {
      contentHeight[row] = Math.max(
        contentHeight[row],
        metrics.height + TABLE_CELL_PADDING * 2,
      );
    }
  }

  const rowHeights = rows.map((row, index) =>
    Math.max(row.height, contentHeight[index]),
  );
  const width = columnWidths.reduce((sum, size) => sum + size, 0);
  const height = rowHeights.reduce((sum, size) => sum + size, 0);
  const position = getPositionAfterHeightChange(
    table,
    height,
    opts?.anchor ?? "top",
  );
  const columnLefts: number[] = [];
  const rowTops: number[] = [];
  let cursorX = 0;
  let cursorY = 0;
  for (const size of columnWidths) {
    columnLefts.push(cursorX);
    cursorX += size;
  }
  for (const size of rowHeights) {
    rowTops.push(cursorY);
    cursorY += size;
  }

  const grid: TableGridCell[] = [];
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < columns.length; column++) {
      grid.push({
        rowId: rows[row].id,
        columnId: columns[column].id,
        x: columnLefts[column],
        y: rowTops[row],
        width: columnWidths[column],
        height: rowHeights[row],
      });
    }
  }

  const center = pointFrom<GlobalPoint>(
    position.x + width / 2,
    position.y + height / 2,
  );
  const cellUpdates = new Map<string, TableCellUpdate>();
  for (const element of getTableCellElements(
    { ...table, rows, columns },
    elements,
  )) {
    const metrics = measured.get(element.id);
    if (!metrics) {
      continue;
    }
    const row = rowIndex.get(element.tableCell.rowId)!;
    const column = columnIndex.get(element.tableCell.columnId)!;
    const contentWidth = Math.max(
      columnWidths[column] - TABLE_CELL_PADDING * 2,
      0,
    );
    const contentHeightInCell = Math.max(
      rowHeights[row] - TABLE_CELL_PADDING * 2,
      0,
    );
    let x =
      position.x +
      columnLefts[column] +
      TABLE_CELL_PADDING +
      alignOffset(element.textAlign, contentWidth, metrics.width);
    let y =
      position.y +
      rowTops[row] +
      TABLE_CELL_PADDING +
      alignOffset(element.verticalAlign, contentHeightInCell, metrics.height);
    if (table.angle) {
      const rotated = pointRotateRads(
        pointFrom<GlobalPoint>(x + metrics.width / 2, y + metrics.height / 2),
        center,
        table.angle,
      );
      x = rotated[0] - metrics.width / 2;
      y = rotated[1] - metrics.height / 2;
    }
    cellUpdates.set(element.id, {
      x,
      y,
      width: metrics.width,
      height: metrics.height,
      text: metrics.text,
      angle: table.angle,
    });
  }

  return {
    table: {
      x: position.x,
      y: position.y,
      width,
      height,
      ...(rows !== table.rows ? { rows } : {}),
      ...(columns !== table.columns ? { columns } : {}),
    },
    cellUpdates,
    rowHeights,
    columnWidths,
    grid,
  };
};

/**
 * Scene point to a cell, using effective row heights when `elements` is
 * passed. Returns null outside the table. The table's rotation is undone
 * around its center before the grid is tested.
 */
export const getTableCellAt = (
  table: ExcalidrawTableElement,
  point: GlobalPoint,
  elements?: readonly ExcalidrawElement[] | ElementsMap,
): TableCellAddress | null => {
  const layout = getTableLayout(table, elements ?? []);
  const width = layout.table.width;
  const height = layout.table.height;
  const center = pointFrom<GlobalPoint>(
    layout.table.x + width / 2,
    layout.table.y + height / 2,
  );
  const local = table.angle
    ? pointRotateRads(point, center, -table.angle as Radians)
    : point;
  const x = local[0] - layout.table.x;
  const y = local[1] - layout.table.y;
  if (
    x < -HIT_EPSILON ||
    y < -HIT_EPSILON ||
    x > width + HIT_EPSILON ||
    y > height + HIT_EPSILON
  ) {
    return null;
  }
  const column = indexAt(layout.columnWidths, x);
  const row = indexAt(layout.rowHeights, y);
  if (column < 0 || row < 0) {
    return null;
  }
  return {
    rowId: (layout.table.rows ?? table.rows)[row].id,
    columnId: (layout.table.columns ?? table.columns)[column].id,
  };
};

/**
 * Next or previous cell in row-major order, wrapping at the ends.
 * The same address comes back when the table has a single cell.
 */
export const getAdjacentTableCellAddress = (
  table: ExcalidrawTableElement,
  slot: TableCellAddress,
  direction: 1 | -1,
): TableCellAddress => {
  const columnCount = table.columns.length;
  const count = table.rows.length * columnCount;
  const rowIndex = table.rows.findIndex((row) => row.id === slot.rowId);
  const columnIndex = table.columns.findIndex(
    (column) => column.id === slot.columnId,
  );
  if (rowIndex < 0 || columnIndex < 0 || count === 0) {
    return slot;
  }
  const next =
    (rowIndex * columnCount + columnIndex + direction + count) % count;
  return {
    rowId: table.rows[Math.floor(next / columnCount)].id,
    columnId: table.columns[next % columnCount].id,
  };
};

const indexAt = (sizes: readonly number[], offset: number) => {
  let cursor = 0;
  for (let index = 0; index < sizes.length; index++) {
    const end = cursor + sizes[index];
    const last = index === sizes.length - 1;
    if (
      offset >= cursor &&
      (last ? offset <= end + HIT_EPSILON : offset < end)
    ) {
      return index;
    }
    cursor = end;
  }
  return -1;
};

const layoutInputsChanged = (
  table: ExcalidrawTableElement,
  cells: readonly TableCellElement[],
  prevElementsMap: ElementsMap,
) => {
  const prevTable = prevElementsMap.get(table.id);
  if (!prevTable || !isTableElement(prevTable)) {
    return true;
  }
  if (
    prevTable.x !== table.x ||
    prevTable.y !== table.y ||
    prevTable.angle !== table.angle ||
    prevTable.rows.length !== table.rows.length ||
    prevTable.columns.length !== table.columns.length
  ) {
    return true;
  }
  for (let index = 0; index < table.rows.length; index++) {
    if (
      prevTable.rows[index].id !== table.rows[index].id ||
      prevTable.rows[index].height !== table.rows[index].height
    ) {
      return true;
    }
  }
  for (let index = 0; index < table.columns.length; index++) {
    if (
      prevTable.columns[index].id !== table.columns[index].id ||
      prevTable.columns[index].width !== table.columns[index].width
    ) {
      return true;
    }
  }
  const prevCells = getTableCellElements(prevTable, prevElementsMap);
  if (prevCells.length !== cells.length) {
    return true;
  }
  const prevById = new Map(prevCells.map((cell) => [cell.id, cell]));
  return cells.some((cell) => {
    const prev = prevById.get(cell.id);
    return (
      !prev ||
      prev.originalText !== cell.originalText ||
      prev.fontSize !== cell.fontSize ||
      prev.fontFamily !== cell.fontFamily ||
      prev.lineHeight !== cell.lineHeight ||
      prev.textAlign !== cell.textAlign ||
      prev.verticalAlign !== cell.verticalAlign ||
      prev.tableCell?.rowId !== cell.tableCell?.rowId ||
      prev.tableCell?.columnId !== cell.tableCell?.columnId
    );
  });
};

const textBindingsFor = (
  rows: readonly TableRow[],
  columns: readonly TableColumn[],
  cells: readonly ExcalidrawTextElement[],
) => {
  const bySlot = new Map<string, ExcalidrawTextElement>();
  for (const cell of cells) {
    if (isTableCell(cell) && !cell.isDeleted) {
      bySlot.set(slotKey(cell.tableCell), cell);
    }
  }
  const bindings: { type: "text"; id: string }[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const cell = bySlot.get(slotKey({ rowId: row.id, columnId: column.id }));
      if (cell) {
        bindings.push({ type: "text", id: cell.id });
      }
    }
  }
  return bindings;
};

const bindingsMatch = (
  left: ExcalidrawElement["boundElements"],
  right: readonly { id: string; type: string }[],
) => {
  if (!left) {
    return right.length === 0;
  }
  return (
    left.length === right.length &&
    left.every(
      (binding, index) =>
        binding.id === right[index]?.id && binding.type === right[index]?.type,
    )
  );
};

/**
 * Live cells that occupy a slot, plus every other live text bound to the
 * table (duplicate slot, missing slot, or no `tableCell`).
 */
const partitionTableTexts = (
  table: ExcalidrawTableElement,
  elements: readonly ExcalidrawElement[] | ElementsMap,
) => {
  const kept = getTableCellElements(table, elements);
  const keptIds = new Set(kept.map((cell) => cell.id));
  const orphans: ExcalidrawTextElement[] = [];
  for (const element of asElements(elements)) {
    if (
      isTextElement(element) &&
      !element.isDeleted &&
      element.containerId === table.id &&
      !keptIds.has(element.id)
    ) {
      orphans.push(element);
    }
  }
  return { kept, orphans };
};

/**
 * Applies `getTableLayout` to the tables in `affectedIds` (and tables whose
 * cells are). Elements that do not change keep their identity. With
 * `prevElementsMap`, tables whose inputs did not change are not measured.
 *
 * Row growth is measured here, not via `getBoundTextMaxHeight`. That helper
 * reports the base row, so using it would clip a row that has already grown.
 * Cells that no longer belong to a live slot are marked deleted.
 */
export const relayoutTables = <T extends ExcalidrawElement>(
  elements: readonly T[],
  affectedIds: ReadonlySet<ExcalidrawElement["id"]>,
  opts?: {
    prevElementsMap?: ElementsMap;
    renderEnvironment?: RenderEnvironment;
  },
): readonly T[] => {
  if (!affectedIds.size) {
    return elements;
  }
  const elementsMap = arrayToMap(elements);
  const tableIds = new Set<ExcalidrawElement["id"]>();
  const replacements = new Map<ExcalidrawElement["id"], T>();
  const deleteElement = (element: ExcalidrawElement) => {
    const next = newElementWith(element, { isDeleted: true });
    if (next !== element) {
      replacements.set(element.id, next as unknown as T);
    }
  };

  for (const id of affectedIds) {
    const element = elementsMap.get(id);
    if (!element || element.isDeleted) {
      continue;
    }
    if (isTableElement(element)) {
      tableIds.add(element.id);
      continue;
    }
    if (!isTextElement(element) || !element.containerId) {
      continue;
    }
    const container = elementsMap.get(element.containerId);
    if (container && isTableElement(container)) {
      if (container.isDeleted) {
        deleteElement(element);
      } else {
        tableIds.add(container.id);
      }
      continue;
    }
    // A cell has to point at a table. A non-cell whose container is absent
    // stays, so a partial update can omit unchanged elements.
    if (isTableCell(element)) {
      deleteElement(element);
    }
  }
  if (!tableIds.size && !replacements.size) {
    return elements;
  }

  for (const id of tableIds) {
    const table = elementsMap.get(id);
    if (!table || !isTableElement(table) || table.isDeleted) {
      continue;
    }
    const { kept, orphans } = partitionTableTexts(table, elementsMap);
    const nextBindings = [
      ...textBindingsFor(table.rows, table.columns, kept),
      ...(table.boundElements ?? []).filter(
        (binding) => binding.type !== "text",
      ),
    ];
    const bindingsChanged = !bindingsMatch(table.boundElements, nextBindings);
    if (
      !orphans.length &&
      !bindingsChanged &&
      opts?.prevElementsMap &&
      !layoutInputsChanged(table, kept, opts.prevElementsMap)
    ) {
      continue;
    }
    const layout = getTableLayout(table, elementsMap, {
      renderEnvironment: opts?.renderEnvironment,
    });
    const nextTable = newElementWith(table as ExcalidrawTableElement, {
      x: layout.table.x,
      y: layout.table.y,
      width: layout.table.width,
      height: layout.table.height,
      ...(layout.table.rows ? { rows: layout.table.rows } : {}),
      ...(layout.table.columns ? { columns: layout.table.columns } : {}),
      ...(bindingsChanged ? { boundElements: nextBindings } : {}),
    });
    if (nextTable !== table) {
      replacements.set(id, nextTable as unknown as T);
    }
    for (const cell of kept) {
      const update = layout.cellUpdates.get(cell.id);
      if (!update) {
        continue;
      }
      const nextCell = newElementWith(cell, update);
      if (nextCell !== cell) {
        replacements.set(cell.id, nextCell as unknown as T);
      }
    }
    for (const orphan of orphans) {
      deleteElement(orphan);
    }
  }
  if (!replacements.size) {
    return elements;
  }
  return elements.map((element) => replacements.get(element.id) ?? element);
};

export const createTableCellElement = (
  table: Pick<
    ExcalidrawTableElement,
    | "id"
    | "x"
    | "y"
    | "angle"
    | "strokeColor"
    | "groupIds"
    | "frameId"
    | "locked"
  >,
  slot: TableCellAddress,
  template?: Pick<
    ExcalidrawTextElement,
    | "fontSize"
    | "fontFamily"
    | "textAlign"
    | "verticalAlign"
    | "lineHeight"
    | "strokeColor"
  > | null,
): NonDeleted<ExcalidrawTextElement> => {
  return newTextElement({
    x: table.x,
    y: table.y,
    text: "",
    originalText: "",
    fontSize: template?.fontSize,
    fontFamily: template?.fontFamily,
    textAlign: template?.textAlign ?? TEXT_ALIGN.LEFT,
    verticalAlign: template?.verticalAlign ?? VERTICAL_ALIGN.TOP,
    lineHeight: template?.lineHeight,
    strokeColor: template?.strokeColor ?? table.strokeColor,
    backgroundColor: "transparent",
    autoResize: false,
    boundElements: [],
    angle: table.angle,
    groupIds: table.groupIds,
    frameId: table.frameId,
    locked: table.locked,
    containerId: table.id,
    tableCell: { rowId: slot.rowId, columnId: slot.columnId },
  });
};

const liveCells = (
  cells: readonly ExcalidrawTextElement[],
): TableCellElement[] =>
  cells.filter(
    (cell): cell is TableCellElement => !cell.isDeleted && isTableCell(cell),
  );

const commitStructure = (
  table: ExcalidrawTableElement,
  rows: readonly TableRow[],
  columns: readonly TableColumn[],
  cells: readonly ExcalidrawTextElement[],
  addedCells: ExcalidrawTextElement[],
  removed: readonly ExcalidrawTextElement[],
): TableStructureChange => {
  const removedIds = new Set(removed.map((cell) => cell.id));
  const kept = cells.filter((cell) => !removedIds.has(cell.id));
  const all = [...kept, ...addedCells];
  const boundElements = [
    ...textBindingsFor(rows, columns, all),
    ...(table.boundElements ?? []).filter((binding) => binding.type !== "text"),
  ];
  const draft: ExcalidrawTableElement = {
    ...table,
    rows,
    columns,
    boundElements,
  };
  const layout = getTableLayout(draft, all);
  const nextTable = newElementWith(table, {
    rows: layout.table.rows ?? rows,
    columns: layout.table.columns ?? columns,
    boundElements,
    x: layout.table.x,
    y: layout.table.y,
    width: layout.table.width,
    height: layout.table.height,
  });
  return {
    table: nextTable,
    addedCells: addedCells.map((cell) => {
      const update = layout.cellUpdates.get(cell.id);
      return update ? { ...cell, ...update } : cell;
    }),
    deletedCells: removed.map((cell) =>
      cell.isDeleted ? cell : newElementWith(cell, { isDeleted: true }),
    ),
  };
};

const deleteWholeTable = (
  table: ExcalidrawTableElement,
  cells: readonly ExcalidrawTextElement[],
): TableStructureChange => ({
  table: newElementWith(table, {
    isDeleted: true,
    boundElements: (table.boundElements ?? []).filter(
      (binding) => binding.type !== "text",
    ),
  }),
  addedCells: [],
  deletedCells: cells
    .filter((cell) => !cell.isDeleted)
    .map((cell) => newElementWith(cell, { isDeleted: true })),
});

const unchanged = (table: ExcalidrawTableElement): TableStructureChange => ({
  table,
  addedCells: [],
  deletedCells: [],
});

export const insertTableRow = (
  table: ExcalidrawTableElement,
  cells: readonly ExcalidrawTextElement[],
  opts: { rowId: string; position: "above" | "below" },
): TableStructureChange => {
  if (table.isDeleted) {
    return unchanged(table);
  }
  const index = table.rows.findIndex((row) => row.id === opts.rowId);
  if (index < 0) {
    return unchanged(table);
  }
  const reference = table.rows[index];
  const row: TableRow = {
    id: randomId(),
    height: Math.max(reference.height, TABLE_MIN_ROW_HEIGHT),
  };
  const at = opts.position === "above" ? index : index + 1;
  const rows = [...table.rows.slice(0, at), row, ...table.rows.slice(at)];
  const living = liveCells(cells);
  const addedCells = table.columns.map((column) => {
    const template = living.find(
      (cell) =>
        cell.tableCell.columnId === column.id &&
        cell.tableCell.rowId === reference.id,
    );
    return createTableCellElement(
      table,
      { rowId: row.id, columnId: column.id },
      template,
    );
  });
  return commitStructure(table, rows, table.columns, living, addedCells, []);
};

export const insertTableColumn = (
  table: ExcalidrawTableElement,
  cells: readonly ExcalidrawTextElement[],
  opts: { columnId: string; position: "left" | "right" },
): TableStructureChange => {
  if (table.isDeleted) {
    return unchanged(table);
  }
  const index = table.columns.findIndex(
    (column) => column.id === opts.columnId,
  );
  if (index < 0) {
    return unchanged(table);
  }
  const reference = table.columns[index];
  const column: TableColumn = {
    id: randomId(),
    width: Math.max(reference.width, TABLE_MIN_COLUMN_WIDTH),
  };
  const at = opts.position === "left" ? index : index + 1;
  const columns = [
    ...table.columns.slice(0, at),
    column,
    ...table.columns.slice(at),
  ];
  const living = liveCells(cells);
  const addedCells = table.rows.map((row) => {
    const template = living.find(
      (cell) =>
        cell.tableCell.rowId === row.id &&
        cell.tableCell.columnId === reference.id,
    );
    return createTableCellElement(
      table,
      { rowId: row.id, columnId: column.id },
      template,
    );
  });
  return commitStructure(table, table.rows, columns, living, addedCells, []);
};

export const deleteTableRow = (
  table: ExcalidrawTableElement,
  cells: readonly ExcalidrawTextElement[],
  rowId: string,
): TableStructureChange => {
  if (table.isDeleted || !table.rows.some((row) => row.id === rowId)) {
    return unchanged(table);
  }
  const living = liveCells(cells);
  if (table.rows.length === 1) {
    return deleteWholeTable(table, living);
  }
  const rows = table.rows.filter((row) => row.id !== rowId);
  const removed = living.filter((cell) => cell.tableCell.rowId === rowId);
  return commitStructure(table, rows, table.columns, living, [], removed);
};

export const deleteTableColumn = (
  table: ExcalidrawTableElement,
  cells: readonly ExcalidrawTextElement[],
  columnId: string,
): TableStructureChange => {
  if (
    table.isDeleted ||
    !table.columns.some((column) => column.id === columnId)
  ) {
    return unchanged(table);
  }
  const living = liveCells(cells);
  if (table.columns.length === 1) {
    return deleteWholeTable(table, living);
  }
  const columns = table.columns.filter((column) => column.id !== columnId);
  const removed = living.filter((cell) => cell.tableCell.columnId === columnId);
  return commitStructure(table, table.rows, columns, living, [], removed);
};
