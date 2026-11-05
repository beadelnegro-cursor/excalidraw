import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import {
  createRedoAction,
  createUndoAction,
} from "@excalidraw/excalidraw/actions/actionHistory";
import {
  isTableCell,
  isTableElement,
  isTextElement,
  newTableElement,
  relayoutTables,
  syncInvalidIndices,
} from "@excalidraw/element";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import { StoreIncrement } from "@excalidraw/element";

import type { DurableIncrement, EphemeralIncrement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { WS_SUBTYPES } from "../app_constants";

import ExcalidrawApp from "../App";

import { isSyncableElement } from "../data";

const collabHarness = vi.hoisted(() => {
  const sockets: Array<{
    handlers: Map<string, Array<(...args: any[]) => any>>;
  }> = [];
  return {
    sockets,
    plaintext: { current: "{}" },
  };
});

const { h } = window;

Object.defineProperty(window, "crypto", {
  value: {
    getRandomValues: (arr: number[]) =>
      arr.forEach((v, i) => (arr[i] = Math.floor(Math.random() * 256))),
    subtle: {
      generateKey: () => {},
      exportKey: () => ({ k: "sTdLvMC_M3V8_vGa3UVRDg" }),
    },
  },
});

vi.mock("../../excalidraw-app/data/firebase.ts", () => {
  const loadFromFirebase = async () => null;
  const saveToFirebase = () => {};
  const isSavedToFirebase = () => true;
  const loadFilesFromFirebase = async () => ({
    loadedFiles: [],
    erroredFiles: [],
  });
  const saveFilesToFirebase = async () => ({
    savedFiles: new Map(),
    erroredFiles: new Map(),
  });

  return {
    loadFromFirebase,
    saveToFirebase,
    isSavedToFirebase,
    loadFilesFromFirebase,
    saveFilesToFirebase,
  };
});

vi.mock("socket.io-client", () => {
  return {
    default: () => {
      const handlers = new Map<string, Array<(...args: any[]) => any>>();
      const socket = {
        close: () => {},
        on: (event: string, cb: (...args: any[]) => any) => {
          const list = handlers.get(event) ?? [];
          list.push(cb);
          handlers.set(event, list);
        },
        once: () => {},
        off: (event: string, cb?: (...args: any[]) => any) => {
          const list = handlers.get(event);
          if (!list) {
            return;
          }
          handlers.set(
            event,
            cb ? list.filter((handler) => handler !== cb) : [],
          );
        },
        emit: () => {},
      };
      collabHarness.sockets.push({ handlers });
      return socket;
    },
  };
});

vi.mock("@excalidraw/excalidraw/data/encryption", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@excalidraw/excalidraw/data/encryption")
  >();
  return {
    ...actual,
    decryptData: async () => {
      const bytes = new TextEncoder().encode(collabHarness.plaintext.current);
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
  };
});

/**
 * These test would deserve to be extended by testing collab with (at least) two clients simultanouesly,
 * while having access to both scenes, appstates stores, histories and etc.
 * i.e. multiplayer history tests could be a good first candidate, as we could test both history stacks simultaneously.
 */
describe("collaboration", () => {
  it("should emit two ephemeral increments even though updates get batched", async () => {
    const durableIncrements: DurableIncrement[] = [];
    const ephemeralIncrements: EphemeralIncrement[] = [];

    await render(<ExcalidrawApp />);

    h.store.onStoreIncrementEmitter.on((increment) => {
      if (StoreIncrement.isDurable(increment)) {
        durableIncrements.push(increment);
      } else {
        ephemeralIncrements.push(increment);
      }
    });

    // eslint-disable-next-line dot-notation
    expect(h.store["scheduledMicroActions"].length).toBe(0);
    expect(durableIncrements.length).toBe(0);
    expect(ephemeralIncrements.length).toBe(0);

    const rectProps = {
      type: "rectangle",
      id: "A",
      height: 200,
      width: 100,
      x: 0,
      y: 0,
    } as const;

    const rect = API.createElement({ ...rectProps });

    API.updateScene({
      elements: [rect],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await waitFor(() => {
      // expect(commitSpy).toHaveBeenCalledTimes(1);
      expect(durableIncrements.length).toBe(1);
    });

    // simulate two batched remote updates
    act(() => {
      h.app.updateScene({
        elements: [newElementWith(h.elements[0], { x: 100 })],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      h.app.updateScene({
        elements: [newElementWith(h.elements[0], { x: 200 })],
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      // we scheduled two micro actions,
      // which confirms they are going to be executed as part of one batched component update
      // eslint-disable-next-line dot-notation
      expect(h.store["scheduledMicroActions"].length).toBe(2);
    });

    await waitFor(() => {
      // altough the updates get batched,
      // we expect two ephemeral increments for each update,
      // and each such update should have the expected change
      expect(ephemeralIncrements.length).toBe(2);
      expect(ephemeralIncrements[0].change.elements.A).toEqual(
        expect.objectContaining({ x: 100 }),
      );
      expect(ephemeralIncrements[1].change.elements.A).toEqual(
        expect.objectContaining({ x: 200 }),
      );
      // eslint-disable-next-line dot-notation
      expect(h.store["scheduledMicroActions"].length).toBe(0);
    });
  });

  it("should allow to undo / redo even on force-deleted elements", async () => {
    await render(<ExcalidrawApp />);
    const rect1Props = {
      type: "rectangle",
      id: "A",
      height: 200,
      width: 100,
    } as const;

    const rect2Props = {
      type: "rectangle",
      id: "B",
      width: 100,
      height: 200,
    } as const;

    const rect1 = API.createElement({ ...rect1Props });
    const rect2 = API.createElement({ ...rect2Props });

    API.updateScene({
      elements: syncInvalidIndices([rect1, rect2]),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    API.updateScene({
      elements: syncInvalidIndices([
        rect1,
        newElementWith(h.elements[1], { isDeleted: true }),
      ]),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(2);
      expect(API.getSnapshot()).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: true }),
      ]);
      expect(h.elements).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: true }),
      ]);
    });

    // one form of force deletion happens when starting the collab, not to sync potentially sensitive data into the server
    window.collab.startCollaboration(null);

    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(2);
      // we never delete from the local snapshot as it is used for correct diff calculation
      expect(API.getSnapshot()).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: true }),
      ]);
      expect(h.elements).toEqual([expect.objectContaining(rect1Props)]);
    });

    const undoAction = createUndoAction(h.history);
    act(() => h.app.actionManager.executeAction(undoAction));

    // with explicit undo (as addition) we expect our item to be restored from the snapshot!
    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(1);
      expect(API.getRedoStack().length).toBe(1);
      expect(API.getSnapshot()).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: false }),
      ]);
      expect(h.elements).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: false }),
      ]);
    });

    // simulate force deleting the element remotely
    API.updateScene({
      elements: syncInvalidIndices([rect1]),
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(1);
      expect(API.getRedoStack().length).toBe(1);
      expect(API.getSnapshot()).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: true }),
      ]);
      expect(h.elements).toEqual([expect.objectContaining(rect1Props)]);
    });

    const redoAction = createRedoAction(h.history);
    act(() => h.app.actionManager.executeAction(redoAction));

    // with explicit redo (as removal) we again restore the element from the snapshot!
    await waitFor(() => {
      expect(API.getUndoStack().length).toBe(2);
      expect(API.getRedoStack().length).toBe(0);
      expect(API.getSnapshot()).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: true }),
      ]);
      expect(h.elements).toEqual([
        expect.objectContaining(rect1Props),
        expect.objectContaining({ ...rect2Props, isDeleted: true }),
      ]);
    });
  });

  it("converges two grown rows received through the socket", async () => {
    await render(<ExcalidrawApp />);

    const built = newTableElement({ type: "table", x: 30, y: 40 });
    const base = syncInvalidIndices([built.table, ...built.cells]);
    const table = base.find(isTableElement)!;
    const cellA = base.find(
      (element) =>
        isTableCell(element) && element.tableCell.rowId === table.rows[0].id,
    )!;
    const cellB = base.find(
      (element) =>
        isTableCell(element) &&
        element.tableCell.rowId === table.rows[1].id &&
        element.tableCell.columnId === table.columns[0].id,
    )!;
    const empty = base.find(
      (element) =>
        isTableCell(element) && element.tableCell.rowId === table.rows[2].id,
    )!;
    const textA = "a\nb\nc\nd";
    const textB = "e\nf\ng\nh";
    const stamp = (element: ExcalidrawElement, version: number) =>
      newElementWith(element, { version, versionNonce: version });
    const grow = (cellId: string, text: string) =>
      relayoutTables(
        base.map((element) => {
          if (element.id !== cellId || !isTextElement(element)) {
            return element;
          }
          return newElementWith(element, { originalText: text, text });
        }),
        new Set([cellId]),
      );

    const local = grow(cellA.id, textA).map((element) => {
      if (element.id === table.id) {
        return stamp(element, 4);
      }
      if (element.id === cellA.id) {
        return stamp(element, 6);
      }
      return stamp(element, 1);
    });
    const remote = grow(cellB.id, textB).map((element) => {
      if (element.id === table.id) {
        return stamp(element, 5);
      }
      if (element.id === cellB.id) {
        return stamp(element, 7);
      }
      if (element.id === cellA.id) {
        return stamp(element, 1);
      }
      return stamp(element, 1);
    });
    const remoteTable = remote.find(isTableElement)!;

    if (!isTableCell(empty)) {
      throw new Error("expected an empty cell");
    }
    expect(
      isSyncableElement({
        ...empty,
        width: 0,
        height: 0,
        text: "",
        originalText: "",
      }),
    ).toBe(true);

    API.updateScene({
      elements: local,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    const started = window.collab.startCollaboration(null);
    await waitFor(() => {
      const socket = collabHarness.sockets.at(-1);
      expect(socket?.handlers.get("client-broadcast")?.length).toBe(1);
    });

    collabHarness.plaintext.current = JSON.stringify({
      type: WS_SUBTYPES.UPDATE,
      payload: { elements: remote },
    });
    const onBroadcast = collabHarness.sockets
      .at(-1)!
      .handlers.get("client-broadcast")![0];
    await act(async () => {
      await onBroadcast(new ArrayBuffer(1), new Uint8Array(12));
    });

    await waitFor(() => {
      const tableNow = h.elements.find(isTableElement);
      const textNow = (id: string) =>
        h.elements.find(
          (element) => element.id === id,
        ) as ExcalidrawTextElement;
      expect(tableNow && isTableElement(tableNow)).toBe(true);
      expect(textNow(cellA.id).originalText).toBe(textA);
      expect(textNow(cellB.id).originalText).toBe(textB);
      expect(textNow(cellA.id).isDeleted).toBe(false);
      expect(textNow(cellB.id).isDeleted).toBe(false);
      expect(textNow(empty.id).isDeleted).toBe(false);
      expect(textNow(empty.id).originalText).toBe("");
      expect(tableNow!.height).toBeGreaterThan(remoteTable.height);
      expect(tableNow!.rows.map((row) => row.height)).toEqual(
        table.rows.map((row) => row.height),
      );
    });

    // The room promise stays pending until a peer sends init. Don't await it.
    void started;
  });
});
