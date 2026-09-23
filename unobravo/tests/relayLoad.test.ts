/**
 * How Collab loads a room from the relay (unobravo/frontend.md §4.4, §6, §9)
 * and guards unload (§5.2). The relay is the only store, so both silent
 * failure modes live here: treating "could not load" as "empty board", and
 * letting a tab close over work no `persisted: true` ack has covered.
 */
import { resolvablePromise } from "@excalidraw/common";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Collab, {
  isCollaboratingAtom,
} from "../../excalidraw-app/collab/Collab";
import { appJotaiStore } from "../../excalidraw-app/app-jotai";
import { WS_SUBTYPES } from "../../excalidraw-app/app_constants";

const legacy = vi.hoisted(() => ({
  loadLegacyScene: vi.fn(),
  finishLegacyMigration: vi.fn(),
}));
vi.mock("../collab/legacyScene", () => legacy);
vi.mock("@excalidraw/excalidraw/data/encryption", () => ({
  encryptData: async () => ({
    encryptedBuffer: new ArrayBuffer(16),
    iv: new Uint8Array(12),
  }),
  decryptData: async () => new ArrayBuffer(0),
}));

const rect = {
  id: "rect-1",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 3,
  versionNonce: 1,
  index: "a0",
  isDeleted: false,
  updated: Date.now(),
};

const setup = (requestSceneAck: unknown) => {
  let elements: any[] = [];
  const excalidrawAPI = {
    getFiles: () => ({}),
    addFiles: vi.fn(),
    getAppState: () => getDefaultAppState(),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene: vi.fn((scene: { elements?: any[] }) => {
      if (scene.elements) {
        elements = scene.elements;
      }
    }),
  };
  const collab = new Collab({ excalidrawAPI: excalidrawAPI as any });
  const emitWithAck = vi.fn(async (event: string, ..._args: unknown[]) => {
    if (event === "request-scene" && requestSceneAck instanceof Error) {
      throw requestSceneAck;
    }
    return event === "request-scene"
      ? requestSceneAck
      : { version: 1, persisted: true };
  });
  collab.portal.socket = {
    emit: vi.fn(),
    timeout: () => ({ emitWithAck }),
    id: "me",
  } as any;
  collab.portal.roomId = "room-1";
  collab.portal.roomKey = "key-1";
  const setErrorDialog = vi.spyOn(collab, "setErrorDialog");
  const scenePromise = resolvablePromise<any>();
  const load = () =>
    (collab as any).loadRoomScene(
      { roomId: "room-1", roomKey: "key-1" },
      scenePromise,
    );

  return {
    collab,
    excalidrawAPI,
    emitWithAck,
    setErrorDialog,
    scenePromise,
    load,
  };
};

beforeEach(() => {
  legacy.loadLegacyScene.mockReset();
  legacy.finishLegacyMigration.mockReset();
});

describe("request-scene", () => {
  it("decrypts and applies the relay's snapshot", async () => {
    const { collab, excalidrawAPI, scenePromise, load } = setup({
      data: new ArrayBuffer(8),
      iv: new Uint8Array(12),
      version: 3,
    });
    vi.spyOn(collab as any, "decryptPayload").mockResolvedValue({
      type: WS_SUBTYPES.INIT,
      payload: {
        elements: [rect],
        files: { "file-1": { id: "file-1", dataURL: "data:" } },
        sceneVersion: 40,
      },
    });

    await load();

    const scene = await scenePromise;
    expect(scene.elements.map((e: any) => e.id)).toEqual(["rect-1"]);
    expect(excalidrawAPI.addFiles).toHaveBeenCalledWith([
      { id: "file-1", dataURL: "data:" },
    ]);
    expect(collab.portal.socketInitialized).toBe(true);
    // the stored version, so the next complete frame is not refused as stale
    expect(collab.portal.persistence.frame(true, 3).meta.sceneVersion).toBe(41);
    expect(legacy.loadLegacyScene).not.toHaveBeenCalled();
  });

  it("accepts a snapshot stored from the 20 s full sync, an UPDATE", async () => {
    const { collab, scenePromise, load } = setup({
      data: new ArrayBuffer(8),
      iv: new Uint8Array(12),
    });
    vi.spyOn(collab as any, "decryptPayload").mockResolvedValue({
      type: WS_SUBTYPES.UPDATE,
      payload: { elements: [rect] },
    });

    await load();

    expect((await scenePromise).elements).toHaveLength(1);
    expect(collab.portal.socketInitialized).toBe(true);
  });

  it("treats null as an empty board, immediately and without an error", async () => {
    const { collab, setErrorDialog, scenePromise, load } = setup(null);
    legacy.loadLegacyScene.mockResolvedValue(null);

    await load();

    await expect(scenePromise).resolves.toBeNull();
    expect(collab.portal.socketInitialized).toBe(true);
    expect(setErrorDialog).not.toHaveBeenCalled();
  });

  it("never treats a failed load as an empty board", async () => {
    const { collab, setErrorDialog, scenePromise, load, emitWithAck } = setup(
      new Error("operation has timed out"),
    );

    await load();

    // the editor stops waiting, but nothing is broadcast over an unseen board
    await expect(scenePromise).resolves.toBeNull();
    expect(collab.portal.socketInitialized).toBe(false);
    expect(setErrorDialog).toHaveBeenCalled();
    expect(legacy.loadLegacyScene).not.toHaveBeenCalled();

    // and the next init-room (a reconnect) retries
    emitWithAck.mockResolvedValueOnce(null);
    legacy.loadLegacyScene.mockResolvedValue(null);
    await load();
    expect(collab.portal.socketInitialized).toBe(true);
  });

  it("runs one load at a time when a reconnect lands mid-load", async () => {
    const { collab, emitWithAck, load } = setup(null);
    let release!: (value: null) => void;
    legacy.loadLegacyScene.mockReturnValue(
      new Promise((resolve) => (release = resolve)),
    );

    const first = load();
    const reconnect = load(); // a second init-room while the first is in flight
    await vi.waitFor(() =>
      expect(legacy.loadLegacyScene).toHaveBeenCalledTimes(1),
    );
    release(null);
    await Promise.all([first, reconnect]);

    expect(legacy.loadLegacyScene).toHaveBeenCalledTimes(1);
    expect(
      emitWithAck.mock.calls.filter(([e]) => e === "request-scene"),
    ).toHaveLength(1);
    expect(collab.portal.socketInitialized).toBe(true);
  });
});

describe("legacy migration", () => {
  it("applies a Firestore board and sends it as a complete, flushed frame", async () => {
    const { collab, emitWithAck, excalidrawAPI, scenePromise, load } =
      setup(null);
    const files = [{ id: "file-1", dataURL: "data:" }];
    legacy.loadLegacyScene.mockResolvedValue({
      elements: [rect],
      files,
    });

    await load();

    expect((await scenePromise).elements.map((e: any) => e.id)).toEqual([
      "rect-1",
    ]);
    expect(excalidrawAPI.addFiles).toHaveBeenCalledWith(files);
    const frame = emitWithAck.mock.calls.find(
      ([event]) => event === "server-broadcast",
    )!;
    expect(frame[4]).toMatchObject({ complete: true, flush: true });
    expect(legacy.finishLegacyMigration).toHaveBeenCalledWith(
      "room-1",
      expect.anything(),
      { version: 1, persisted: true },
    );
    expect(collab.portal.persistence.hasUnpersisted()).toBe(false);
  });

  it("fails soft to an empty board, visibly, when Firestore is unreachable", async () => {
    const { collab, setErrorDialog, scenePromise, load } = setup(null);
    legacy.loadLegacyScene.mockRejectedValue(new Error("HTTP 503"));

    await load();

    await expect(scenePromise).resolves.toBeNull();
    expect(collab.portal.socketInitialized).toBe(true);
    expect(setErrorDialog).toHaveBeenCalled();
    expect(legacy.finishLegacyMigration).not.toHaveBeenCalled();
  });
});

describe("unload guard", () => {
  const unload = (collab: Collab) => {
    const event = new Event("beforeunload", { cancelable: true });
    (collab as any).beforeUnload(event);
    return event;
  };

  it("prevents unload and sends a flushed frame while local work is unpersisted", () => {
    const { collab, emitWithAck } = setup(null);
    appJotaiStore.set(isCollaboratingAtom, true);
    collab.portal.socketInitialized = true;
    collab.portal.persistence.markLocalChange();

    const event = unload(collab);

    expect(event.defaultPrevented).toBe(true);
    // sent once encrypted, asynchronously
    return vi.waitFor(() =>
      expect(
        emitWithAck.mock.calls.find(([e]) => e === "server-broadcast")?.[4],
      ).toMatchObject({ complete: true, flush: true }),
    );
  });

  it("lets a participant who only watched leave", () => {
    const { collab } = setup(null);
    appJotaiStore.set(isCollaboratingAtom, true);

    expect(unload(collab).defaultPrevented).toBe(false);
  });
});
