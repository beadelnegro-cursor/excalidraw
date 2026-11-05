import {
  deleteTableColumn,
  getBoundTextMaxHeight,
  insertTableColumn,
  insertTableRow,
  isTableCell,
  isTableElement,
  isTextElement,
  newElementWith,
  newTableElement,
  relayoutTables,
  syncInvalidIndices,
} from "@excalidraw/element";

import { randomInteger, cloneJSON } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import { restoreElements } from "../../data/restore";

import { reconcileElements } from "../../data/reconcile";

import type { RemoteExcalidrawElement } from "../../data/reconcile";

import type { AppState } from "../../types";

type Id = string;
type ElementLike = {
  id: string;
  version: number;
  versionNonce: number;
  index: string;
};

type Cache = Record<string, ExcalidrawElement | undefined>;

const createElement = (opts: { uid: string } | ElementLike) => {
  let uid: string;
  let id: string;
  let version: number | null;
  let versionNonce: number | null = null;
  if ("uid" in opts) {
    const match = opts.uid.match(/^(\w+)(?::(\d+))?$/)!;
    id = match[1];
    version = match[2] ? parseInt(match[2]) : null;
    uid = version ? `${id}:${version}` : id;
  } else {
    ({ id, version, versionNonce } = opts);
    uid = id;
  }
  return {
    uid,
    id,
    version,
    versionNonce: versionNonce || randomInteger(),
  };
};

const idsToElements = (ids: (Id | ElementLike)[], cache: Cache = {}) => {
  return syncInvalidIndices(
    ids.reduce((acc, _uid) => {
      const { uid, id, version, versionNonce } = createElement(
        typeof _uid === "string" ? { uid: _uid } : _uid,
      );
      const cached = cache[uid];
      const elem = {
        id,
        version: version ?? 0,
        versionNonce,
        ...cached,
      } as ExcalidrawElement;
      // @ts-ignore
      cache[uid] = elem;
      acc.push(elem);
      return acc;
    }, [] as ExcalidrawElement[]),
  );
};

const test = <U extends `${string}:${"L" | "R"}`>(
  local: (Id | ElementLike)[],
  remote: (Id | ElementLike)[],
  target: U[],
) => {
  const cache: Cache = {};
  const _local = idsToElements(local, cache);
  const _remote = idsToElements(remote, cache);

  const reconciled = reconcileElements(
    cloneJSON(_local),
    cloneJSON(_remote) as RemoteExcalidrawElement[],
    {} as AppState,
  );

  const reconciledIds = reconciled.map((x) => x.id);
  const reconciledIndices = reconciled.map((x) => x.index);

  expect(target.length).toEqual(reconciled.length);
  expect(reconciledIndices.length).toEqual(
    new Set([...reconciledIndices]).size,
  ); // expect no duplicated indices
  assert.deepEqual(
    reconciledIds,
    target.map((uid) => {
      const [, id, source] = uid.match(/^(\w+):([LR])$/)!;
      const element = (source === "L" ? _local : _remote).find(
        (e) => e.id === id,
      )!;

      return element.id;
    }),
    "remote reconciliation",
  );

  // convergent reconciliation on the remote client
  try {
    assert.deepEqual(
      reconcileElements(
        cloneJSON(_remote),
        cloneJSON(_local as RemoteExcalidrawElement[]),
        {} as AppState,
      ).map((x) => x.id),
      reconciledIds,
      "convergent reconciliation",
    );
  } catch (error: any) {
    console.error("local original", _remote);
    console.error("remote original", _local);
    throw error;
  }

  // bidirectional re-reconciliation on remote client
  try {
    assert.deepEqual(
      reconcileElements(
        cloneJSON(_remote),
        cloneJSON(reconciled as unknown as RemoteExcalidrawElement[]),
        {} as AppState,
      ).map((x) => x.id),
      reconciledIds,
      "local re-reconciliation",
    );
  } catch (error: any) {
    console.error("local original", _remote);
    console.error("remote reconciled", reconciled);
    throw error;
  }
};

describe("elements reconciliation", () => {
  it("reconcileElements()", () => {
    // -------------------------------------------------------------------------
    //
    // in following tests, we pass:
    //  (1) an array of local elements and their version (:1, :2...)
    //  (2) an array of remote elements and their version (:1, :2...)
    //  (3) expected reconciled elements
    //
    // in the reconciled array:
    //  :L means local element was resolved
    //  :R means remote element was resolved
    //
    // if versions are missing, it defaults to version 0
    // -------------------------------------------------------------------------

    test(["A:1", "B:1", "C:1"], ["B:2"], ["A:L", "B:R", "C:L"]);
    test(["A:1", "B:1", "C"], ["B:2", "A:2"], ["B:R", "A:R", "C:L"]);
    test(["A:2", "B:1", "C"], ["B:2", "A:1"], ["A:L", "B:R", "C:L"]);
    test(["A:1", "C:1"], ["B:1"], ["A:L", "B:R", "C:L"]);
    test(["A", "B"], ["A:1"], ["A:R", "B:L"]);
    test(["A"], ["A", "B"], ["A:L", "B:R"]);
    test(["A"], ["A:1", "B"], ["A:R", "B:R"]);
    test(["A:2"], ["A:1", "B"], ["A:L", "B:R"]);
    test(["A:2"], ["B", "A:1"], ["A:L", "B:R"]);
    test(["A:1"], ["B", "A:2"], ["B:R", "A:R"]);
    test(["A"], ["A:1"], ["A:R"]);
    test(["A", "B:1", "D"], ["B", "C:2", "A"], ["C:R", "A:R", "B:L", "D:L"]);

    // some of the following tests are kinda arbitrary and they're less
    // likely to happen in real-world cases
    test(["A", "B"], ["B:1", "A:1"], ["B:R", "A:R"]);
    test(["A:2", "B:2"], ["B:1", "A:1"], ["A:L", "B:L"]);
    test(["A", "B", "C"], ["A", "B:2", "G", "C"], ["A:L", "B:R", "G:R", "C:L"]);
    test(["A", "B", "C"], ["A", "B:2", "G"], ["A:R", "B:R", "C:L", "G:R"]);
    test(
      ["A:2", "B:2", "C"],
      ["D", "B:1", "A:3"],
      ["D:R", "B:L", "A:R", "C:L"],
    );
    test(
      ["A:2", "B:2", "C"],
      ["D", "B:2", "A:3", "C"],
      ["D:R", "B:L", "A:R", "C:L"],
    );
    test(
      ["A", "B", "C", "D", "E", "F"],
      ["A", "B:2", "X", "E:2", "F", "Y"],
      ["A:L", "B:R", "X:R", "C:L", "E:R", "D:L", "F:L", "Y:R"],
    );

    // fractional elements (previously annotated)
    test(
      ["A", "B", "C"],
      ["A", "B", "X", "Y", "Z"],
      ["A:R", "B:R", "C:L", "X:R", "Y:R", "Z:R"],
    );

    test(["A"], ["X", "Y"], ["A:L", "X:R", "Y:R"]);
    test(["A"], ["X", "Y", "Z"], ["A:L", "X:R", "Y:R", "Z:R"]);
    test(["A", "B"], ["C", "D", "F"], ["A:L", "C:R", "B:L", "D:R", "F:R"]);

    test(
      ["A", "B", "C", "D"],
      ["C:1", "B", "D:1"],
      ["A:L", "C:R", "B:L", "D:R"],
    );
    test(
      ["A", "B", "C"],
      ["X", "A", "Y", "B", "Z"],
      ["X:R", "A:R", "Y:R", "B:L", "C:L", "Z:R"],
    );
    test(
      ["B", "A", "C"],
      ["X", "A", "Y", "B", "Z"],
      ["X:R", "A:R", "C:L", "Y:R", "B:R", "Z:R"],
    );
    test(["A", "B"], ["A", "X", "Y"], ["A:R", "B:L", "X:R", "Y:R"]);
    test(
      ["A", "B", "C", "D", "E"],
      ["A", "X", "C", "Y", "D", "Z"],
      ["A:R", "B:L", "X:R", "C:R", "Y:R", "D:R", "E:L", "Z:R"],
    );
    test(
      ["X", "Y", "Z"],
      ["A", "B", "C"],
      ["A:R", "X:L", "B:R", "Y:L", "C:R", "Z:L"],
    );
    test(
      ["X", "Y", "Z"],
      ["A", "B", "C", "X", "D", "Y", "Z"],
      ["A:R", "B:R", "C:R", "X:L", "D:R", "Y:L", "Z:L"],
    );
    test(
      ["A", "B", "C", "D", "E"],
      ["C", "X", "A", "Y", "D", "E:1"],
      ["B:L", "C:L", "X:R", "A:R", "Y:R", "D:R", "E:R"],
    );
    test(
      ["C:1", "B", "D:1"],
      ["A", "B", "C:1", "D:1"],
      ["A:R", "B:R", "C:R", "D:R"],
    );

    test(
      ["C:1", "B", "D:1"],
      ["A", "B", "C:2", "D:1"],
      ["A:R", "B:L", "C:R", "D:L"],
    );

    test(
      ["A", "B", "C", "D"],
      ["A", "C:1", "B", "D:1"],
      ["A:L", "C:R", "B:L", "D:R"],
    );

    test(
      ["A", "B", "C", "D"],
      ["C", "X", "B", "Y", "A", "Z"],
      ["C:R", "D:L", "X:R", "B:R", "Y:R", "A:R", "Z:R"],
    );

    test(
      ["A", "B", "C", "D"],
      ["A", "B:1", "C:1"],
      ["A:R", "B:R", "C:R", "D:L"],
    );

    test(
      ["A", "B", "C", "D"],
      ["A", "C:1", "B:1"],
      ["A:R", "C:R", "B:R", "D:L"],
    );

    test(
      ["A", "B", "C", "D"],
      ["A", "C:1", "B", "D:1"],
      ["A:R", "C:R", "B:R", "D:R"],
    );

    test(["A:1", "B:1", "C"], ["B:2"], ["A:L", "B:R", "C:L"]);
    test(["A:1", "B:1", "C"], ["B:2", "C:2"], ["A:L", "B:R", "C:R"]);
    test(["A", "B"], ["A", "C", "B", "D"], ["A:R", "C:R", "B:R", "D:R"]);
    test(["A", "B"], ["B", "C", "D"], ["A:L", "B:R", "C:R", "D:R"]);
    test(["A", "B"], ["C", "D"], ["A:L", "C:R", "B:L", "D:R"]);
    test(["A", "B"], ["A", "B:1"], ["A:L", "B:R"]);
    test(["A:2", "B"], ["A", "B:1"], ["A:L", "B:R"]);
    test(["A:2", "B:2"], ["B:1"], ["A:L", "B:L"]);
    test(["A:2", "B:2"], ["B:1", "C"], ["A:L", "B:L", "C:R"]);
    test(["A:2", "B:2"], ["A", "C", "B:1"], ["A:L", "B:L", "C:R"]);

    // concurrent convergency
    test(["A", "B", "C"], ["A", "B", "D"], ["A:R", "B:R", "C:L", "D:R"]);
    test(["A", "B", "E"], ["A", "B", "D"], ["A:R", "B:R", "D:R", "E:L"]);
    test(
      ["A", "B", "C"],
      ["A", "B", "D", "E"],
      ["A:R", "B:R", "C:L", "D:R", "E:R"],
    );
    test(
      ["A", "B", "E"],
      ["A", "B", "D", "C"],
      ["A:R", "B:R", "D:R", "E:L", "C:R"],
    );
    test(["A", "B"], ["B", "D"], ["A:L", "B:R", "D:R"]);
    test(["C", "A", "B"], ["C", "B", "D"], ["C:R", "A:L", "B:R", "D:R"]);
  });

  it("test identical elements reconciliation", () => {
    const testIdentical = (
      local: ElementLike[],
      remote: ElementLike[],
      expected: Id[],
    ) => {
      const ret = reconcileElements(
        local as unknown as OrderedExcalidrawElement[],
        remote as unknown as RemoteExcalidrawElement[],
        {} as AppState,
      );

      if (new Set(ret.map((x) => x.id)).size !== ret.length) {
        throw new Error("reconcileElements: duplicate elements found");
      }

      assert.deepEqual(
        ret.map((x) => x.id),
        expected,
      );
    };

    // identical id/version/versionNonce/index
    // -------------------------------------------------------------------------

    testIdentical(
      [{ id: "A", version: 1, versionNonce: 1, index: "a0" }],
      [{ id: "A", version: 1, versionNonce: 1, index: "a0" }],
      ["A"],
    );
    testIdentical(
      [
        { id: "A", version: 1, versionNonce: 1, index: "a0" },
        { id: "B", version: 1, versionNonce: 1, index: "a0" },
      ],
      [
        { id: "B", version: 1, versionNonce: 1, index: "a0" },
        { id: "A", version: 1, versionNonce: 1, index: "a0" },
      ],
      ["A", "B"],
    );

    // actually identical (arrays and element objects)
    // -------------------------------------------------------------------------

    const elements1 = [
      {
        id: "A",
        version: 1,
        versionNonce: 1,
        index: "a0",
      },
      {
        id: "B",
        version: 1,
        versionNonce: 1,
        index: "a0",
      },
    ];

    testIdentical(elements1, elements1, ["A", "B"]);
    testIdentical(elements1, elements1.slice(), ["A", "B"]);
    testIdentical(elements1.slice(), elements1, ["A", "B"]);
    testIdentical(elements1.slice(), elements1.slice(), ["A", "B"]);

    const el1 = {
      id: "A",
      version: 1,
      versionNonce: 1,
      index: "a0",
    };
    const el2 = {
      id: "B",
      version: 1,
      versionNonce: 1,
      index: "a0",
    };
    testIdentical([el1, el2], [el2, el1], ["A", "B"]);
  });
});

const ordered = (elements: readonly ExcalidrawElement[]) =>
  syncInvalidIndices(elements);

const atVersion = (element: ExcalidrawElement, version: number) =>
  newElementWith(element, { version, versionNonce: version });

const growCell = (
  elements: readonly ExcalidrawElement[],
  cellId: string,
  text: string,
) =>
  relayoutTables(
    elements.map((element) => {
      if (element.id !== cellId || !isTextElement(element)) {
        return element;
      }
      return newElementWith(element, { originalText: text, text });
    }),
    new Set([cellId]),
  );

const textOf = (
  elements: readonly ExcalidrawElement[],
  id: string,
): ExcalidrawTextElement => {
  const element = elements.find((candidate) => candidate.id === id);
  if (!element || element.type !== "text") {
    throw new Error(`missing text ${id}`);
  }
  return element;
};

const tableOf = (elements: readonly ExcalidrawElement[]) => {
  const table = elements.find(isTableElement);
  if (!table) {
    throw new Error("missing table");
  }
  return table;
};

/** Geometry only: versions are allowed to differ across the two clients. */
const tableGeometry = (elements: readonly ExcalidrawElement[]) => {
  const table = tableOf(elements);
  return {
    x: table.x,
    y: table.y,
    width: table.width,
    height: table.height,
    isDeleted: table.isDeleted,
    rows: table.rows.map((row) => ({ id: row.id, height: row.height })),
    columns: table.columns.map((column) => ({
      id: column.id,
      width: column.width,
    })),
    cells: elements
      .filter((element) => element.type === "text")
      .map((element) => {
        const text = element as ExcalidrawTextElement;
        return {
          id: text.id,
          isDeleted: text.isDeleted,
          originalText: text.originalText,
          text: text.text,
          x: text.x,
          y: text.y,
          width: text.width,
          height: text.height,
          rowId: text.tableCell?.rowId ?? null,
          columnId: text.tableCell?.columnId ?? null,
        };
      })
      .sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
  };
};

/**
 * The collab path: restore the remote payload against the local scene,
 * reconcile, then relayout. Copies inputs because reconcile mutates indices.
 */
const convergeTable = (
  local: readonly ExcalidrawElement[],
  remote: readonly ExcalidrawElement[],
) => {
  const localElements = structuredClone(local) as OrderedExcalidrawElement[];
  const remoteElements = structuredClone(remote) as ExcalidrawElement[];
  const restored = restoreElements(remoteElements, localElements);
  const reconciled = reconcileElements(
    localElements,
    restored as RemoteExcalidrawElement[],
    {} as AppState,
  );
  return relayoutTables(
    reconciled,
    new Set(reconciled.map((element) => element.id)),
  );
};

describe("table collaboration", () => {
  const baseTable = () => {
    const built = newTableElement({ type: "table", x: 40, y: 80 });
    return ordered([built.table, ...built.cells]);
  };

  it("keeps both grown cells and converges geometry in both directions", () => {
    const base = baseTable();
    const table = tableOf(base);
    const rowA = table.rows[0].id;
    const rowB = table.rows[1].id;
    const cellA = base.find(
      (element) => isTableCell(element) && element.tableCell.rowId === rowA,
    )!;
    const cellB = base.find(
      (element) =>
        isTableCell(element) &&
        element.tableCell.rowId === rowB &&
        element.tableCell.columnId === table.columns[0].id,
    )!;
    const textA = "a\nb\nc\nd";
    const textB = "e\nf\ng\nh";

    const clientA = growCell(base, cellA.id, textA).map((element) => {
      if (element.id === table.id) {
        return atVersion(element, 4);
      }
      if (element.id === cellA.id) {
        return atVersion(element, 6);
      }
      if (element.id === cellB.id) {
        return atVersion(element, 1);
      }
      return atVersion(element, 1);
    });
    const clientB = growCell(base, cellB.id, textB).map((element) => {
      if (element.id === table.id) {
        return atVersion(element, 5);
      }
      if (element.id === cellA.id) {
        return atVersion(element, 1);
      }
      if (element.id === cellB.id) {
        return atVersion(element, 7);
      }
      return atVersion(element, 1);
    });

    const forward = convergeTable(clientA, clientB);
    const backward = convergeTable(clientB, clientA);

    expect(textOf(forward, cellA.id).originalText).toBe(textA);
    expect(textOf(forward, cellB.id).originalText).toBe(textB);
    expect(textOf(forward, cellA.id).isDeleted).toBe(false);
    expect(textOf(forward, cellB.id).isDeleted).toBe(false);
    expect(tableGeometry(forward)).toEqual(tableGeometry(backward));
    expect(tableOf(forward).height).toBeGreaterThan(tableOf(clientA).height);
    expect(tableOf(forward).height).toBeGreaterThan(tableOf(clientB).height);
    expect(tableOf(forward).rows[0].height).toBe(table.rows[0].height);
    expect(tableOf(forward).rows[1].height).toBe(table.rows[1].height);

    const grown = textOf(forward, cellA.id);
    if (!isTableCell(grown)) {
      throw new Error("expected a table cell");
    }
    expect(grown.height).toBeGreaterThan(
      getBoundTextMaxHeight(tableOf(forward), grown),
    );

    expect(
      relayoutTables(forward, new Set(forward.map((element) => element.id))),
    ).toBe(forward);
  });

  it("lets the higher table version win a row-add versus a column-add and drops orphans", () => {
    const base = baseTable();
    const table = tableOf(base);
    const cells = base.filter(isTextElement);
    const rowChange = insertTableRow(table, cells, {
      rowId: table.rows[0].id,
      position: "below",
    });
    const columnChange = insertTableColumn(table, cells, {
      columnId: table.columns[0].id,
      position: "right",
    });
    const sceneWith = (change: typeof rowChange, tableVersion: number) =>
      ordered([
        atVersion(change.table, tableVersion),
        ...cells.map((cell) => atVersion(cell, 1)),
        ...change.addedCells.map((cell) => atVersion(cell, tableVersion)),
      ]);

    const rowScene = sceneWith(rowChange, 3);
    const columnScene = sceneWith(columnChange, 5);
    const fromRow = convergeTable(rowScene, columnScene);
    const fromColumn = convergeTable(columnScene, rowScene);

    expect(tableGeometry(fromRow)).toEqual(tableGeometry(fromColumn));
    expect(tableOf(fromRow).columns.map((column) => column.id)).toEqual(
      columnChange.table.columns.map((column) => column.id),
    );
    expect(tableOf(fromRow).rows.map((row) => row.id)).toEqual(
      columnChange.table.rows.map((row) => row.id),
    );
    for (const cell of columnChange.addedCells) {
      expect(textOf(fromRow, cell.id).isDeleted).toBe(false);
      expect(textOf(fromRow, cell.id).originalText).toBe("");
    }
    for (const cell of rowChange.addedCells) {
      expect(textOf(fromRow, cell.id).isDeleted).toBe(true);
    }
    expect(
      relayoutTables(fromRow, new Set(fromRow.map((element) => element.id))),
    ).toBe(fromRow);
  });

  it("drops a cell edited in a column the other client deleted", () => {
    const base = baseTable();
    const table = tableOf(base);
    const cells = base.filter(isTextElement);
    const removedColumnId = table.columns[0].id;
    const edited = cells.find(
      (cell) => cell.tableCell?.columnId === removedColumnId,
    );
    if (!edited) {
      throw new Error("missing cell");
    }
    const removed = deleteTableColumn(table, cells, removedColumnId);
    const editor = growCell(base, edited.id, "still\nhere").map((element) => {
      if (element.id === table.id) {
        return atVersion(element, 2);
      }
      if (element.id === edited.id) {
        return atVersion(element, 20);
      }
      return atVersion(element, 1);
    });
    const deleter = ordered(
      base.map((element) => {
        if (element.id === table.id) {
          return atVersion(removed.table, 8);
        }
        const deleted = removed.deletedCells.find(
          (cell) => cell.id === element.id,
        );
        return deleted ? atVersion(deleted, 4) : atVersion(element, 1);
      }),
    );

    const fromEditor = convergeTable(editor, deleter);
    const fromDeleter = convergeTable(deleter, editor);

    expect(tableGeometry(fromEditor)).toEqual(tableGeometry(fromDeleter));
    expect(
      tableOf(fromEditor).columns.map((column) => column.id),
    ).not.toContain(removedColumnId);
    expect(textOf(fromEditor, edited.id).isDeleted).toBe(true);
    expect(textOf(fromDeleter, edited.id).isDeleted).toBe(true);

    const inconsistent = ordered([
      atVersion(removed.table, 8),
      ...cells.map((cell) =>
        cell.id === edited.id
          ? atVersion(
              newElementWith(cell, {
                originalText: "still\nhere",
                text: "still\nhere",
              }),
              20,
            )
          : atVersion(cell, 1),
      ),
    ]);
    const restored = restoreElements(inconsistent, null);
    expect(textOf(restored, edited.id).isDeleted).toBe(true);

    const partialKept = restoreElements(
      [atVersion(textOf(editor, edited.id), 20)],
      base,
    );
    expect(textOf(partialKept, edited.id).isDeleted).toBe(false);
    expect(textOf(partialKept, edited.id).originalText).toBe("still\nhere");

    const partialDropped = restoreElements(
      [atVersion(textOf(editor, edited.id), 20)],
      deleter,
    );
    expect(textOf(partialDropped, edited.id).isDeleted).toBe(true);
  });
});
