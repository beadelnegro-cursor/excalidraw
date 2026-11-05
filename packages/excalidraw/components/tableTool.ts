import {
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_WIDTH,
  DRAGGING_THRESHOLD,
  getGridPoint,
  TABLE_DEFAULT_COLUMN_COUNT,
  TABLE_DEFAULT_ROW_COUNT,
  TABLE_MIN_COLUMN_WIDTH,
  TABLE_MIN_ROW_HEIGHT,
} from "@excalidraw/common";

import {
  getTableLayout,
  isTableCell,
  newElementWith,
  newTableElement,
} from "@excalidraw/element";

import type { ElementConstructorOpts } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTableElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import type { NullableGridSize } from "../types";

/**
 * Even split of `total` into `count` parts, each at least `min`.
 * The last part absorbs the rounding remainder so the parts sum to the
 * clamped total.
 */
export const evenSizes = (total: number, count: number, min: number) => {
  const countSafe = Math.max(1, count);
  const safe = Math.max(
    Number.isFinite(total) && total > 0 ? total : 0,
    min * countSafe,
  );
  const even = safe / countSafe;
  if (even < min) {
    return Array.from({ length: countSafe }, () => min);
  }
  const sizes = Array.from({ length: countSafe }, () => even);
  sizes[countSafe - 1] = safe - even * (countSafe - 1);
  return sizes;
};

/** Column widths and row heights that sum to the table's current box. No minimum. */
export const distributeTableExtent = (
  table: Pick<ExcalidrawTableElement, "width" | "height" | "rows" | "columns">,
): Pick<ExcalidrawTableElement, "rows" | "columns"> => {
  const widths = evenSizes(table.width, table.columns.length, 0);
  const heights = evenSizes(table.height, table.rows.length, 0);
  return {
    columns: table.columns.map((column, index) => ({
      id: column.id,
      width: widths[index],
    })),
    rows: table.rows.map((row, index) => ({
      id: row.id,
      height: heights[index],
    })),
  };
};

type TableBox = { x: number; y: number; width: number; height: number };

/**
 * Click → default 3×3 centered on the pointer (then grid-snapped).
 * Drag → the dragged box, grown out to the per-cell minimum away from the
 * origin corner.
 */
export const resolveNewTableBox = (args: {
  table: Pick<
    ExcalidrawTableElement,
    "x" | "y" | "width" | "height" | "rows" | "columns"
  >;
  originX: number;
  originY: number;
  originInGridX: number;
  originInGridY: number;
  zoom: number;
  gridSize: NullableGridSize;
}): TableBox => {
  const { table } = args;
  const isClick =
    table.width * args.zoom < DRAGGING_THRESHOLD &&
    table.height * args.zoom < DRAGGING_THRESHOLD;
  if (isClick) {
    const width = DEFAULT_TABLE_WIDTH;
    const height = DEFAULT_TABLE_HEIGHT;
    const [x, y] = getGridPoint(
      args.originX - width / 2,
      args.originY - height / 2,
      args.gridSize,
    );
    return { x, y, width, height };
  }

  const minWidth = TABLE_MIN_COLUMN_WIDTH * table.columns.length;
  const minHeight = TABLE_MIN_ROW_HEIGHT * table.rows.length;
  let { x, y, width, height } = table;
  if (width < minWidth) {
    x = x < args.originInGridX ? args.originInGridX - minWidth : x;
    width = minWidth;
  }
  if (height < minHeight) {
    y = y < args.originInGridY ? args.originInGridY - minHeight : y;
    height = minHeight;
  }
  return { x, y, width, height };
};

/**
 * A 3×3 table plus its cells. The draft is 0×0: `newTableElement` clamps a
 * zero box up to the minimum cell size, which would make a click look like
 * a drag. Pointer-up replaces this with the real box.
 */
export const createDraftTable = (
  opts: { x: number; y: number } & Partial<ElementConstructorOpts>,
) => {
  const { table, cells } = newTableElement({
    type: "table",
    rows: TABLE_DEFAULT_ROW_COUNT,
    columns: TABLE_DEFAULT_COLUMN_COUNT,
    width: 0,
    height: 0,
    ...opts,
  });
  const draft = newElementWith(table, {
    width: 0,
    height: 0,
    rows: table.rows.map((row) => ({ id: row.id, height: 0 })),
    columns: table.columns.map((column) => ({ id: column.id, width: 0 })),
  });
  return { table: draft, cells };
};

/** Resize `table` to `box`, splitting rows and columns evenly, and relayout cells. */
export const layoutTableBox = (
  table: ExcalidrawTableElement,
  cells: readonly ExcalidrawTextElement[],
  box: TableBox,
): {
  table: ExcalidrawTableElement;
  cells: ExcalidrawTextElement[];
} => {
  const widths = evenSizes(
    box.width,
    table.columns.length,
    TABLE_MIN_COLUMN_WIDTH,
  );
  const heights = evenSizes(
    box.height,
    table.rows.length,
    TABLE_MIN_ROW_HEIGHT,
  );
  const width = widths.reduce((sum, size) => sum + size, 0);
  const height = heights.reduce((sum, size) => sum + size, 0);
  const living = cells.filter((cell) => !cell.isDeleted && isTableCell(cell));
  const draft: ExcalidrawTableElement = {
    ...table,
    x: box.x,
    y: box.y,
    width,
    height,
    rows: table.rows.map((row, index) => ({
      id: row.id,
      height: heights[index],
    })),
    columns: table.columns.map((column, index) => ({
      id: column.id,
      width: widths[index],
    })),
    boundElements: [
      ...living.map((cell) => ({ type: "text" as const, id: cell.id })),
      ...(table.boundElements ?? []).filter(
        (binding) => binding.type !== "text",
      ),
    ],
  };
  const layout = getTableLayout(draft, living);
  const nextTable = newElementWith(table, {
    x: layout.table.x,
    y: layout.table.y,
    width: layout.table.width,
    height: layout.table.height,
    rows: layout.table.rows ?? draft.rows,
    columns: layout.table.columns ?? draft.columns,
    boundElements: draft.boundElements,
  });
  const nextCells = living.map((cell) => {
    const update = layout.cellUpdates.get(cell.id);
    return update ? newElementWith(cell, update) : cell;
  });
  return { table: nextTable, cells: nextCells };
};

export const replaceTableElements = <T extends ExcalidrawElement>(
  elements: readonly T[],
  next: {
    table: ExcalidrawTableElement;
    cells: readonly ExcalidrawTextElement[];
  },
): T[] => {
  const cells = new Map(next.cells.map((cell) => [cell.id, cell]));
  return elements.map((element) => {
    if (element.id === next.table.id) {
      return next.table as unknown as T;
    }
    return (cells.get(element.id) as T | undefined) ?? element;
  });
};
