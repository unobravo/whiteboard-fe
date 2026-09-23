/**
 * The client side of the relay persistence protocol (unobravo/backend.md §3).
 *
 * The emitted arguments are asserted, not just that an emit happened: `meta`
 * is exactly the kind of gate a clean upstream merge drops — the call
 * survives, the argument does not — and a delta promoted to snapshot replaces
 * a whole board with a few strokes, silently (unobravo/frontend.md §5.1).
 */
import { describe, expect, it, vi } from "vitest";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import Portal from "../../excalidraw-app/collab/Portal";
import { WS_SUBTYPES } from "../../excalidraw-app/app_constants";
import {
  PersistenceTracker,
  RELAY_MAX_FRAME_BYTES,
  RelayFrameTooLargeError,
  requestScene,
} from "../collab/relayPersistence";

import type { TCollabClass } from "../../excalidraw-app/collab/Collab";

const encrypted = vi.hoisted(() => ({ bytes: 16 }));

vi.mock("@excalidraw/excalidraw/data/encryption", () => ({
  encryptData: async () => ({
    encryptedBuffer: new ArrayBuffer(encrypted.bytes),
    iv: new Uint8Array(12),
  }),
}));

const rect = (id: string, version: number) =>
  ({
    id,
    type: "rectangle",
    version,
    versionNonce: 1,
    index: `a${id}`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    isDeleted: false,
    updated: Date.now(),
  } as unknown as OrderedExcalidrawElement);

const setup = (ack: unknown = { version: 1, persisted: true }) => {
  const collab = {
    excalidrawAPI: {
      getFiles: () => ({}),
      getSceneElementsIncludingDeleted: () => [],
      updateScene: () => {},
    },
    fileManager: {
      saveFiles: async () => ({}),
      shouldUpdateImageElementStatus: () => false,
    },
    onScenePersisted: vi.fn(),
    onSceneSaveError: vi.fn(),
    state: { username: "u" },
  } as unknown as TCollabClass;

  const emit = vi.fn();
  const emitWithAck = vi.fn(async () => {
    if (ack instanceof Error) {
      throw ack;
    }
    return ack;
  });
  const portal = new Portal(collab);
  portal.socket = {
    emit,
    timeout: () => ({ emitWithAck }),
    id: "socket-1",
  } as any;
  portal.socketInitialized = true;
  portal.roomId = "room-1";
  portal.roomKey = "key-1";

  return { portal, collab, emit, emitWithAck };
};

describe("scene frame meta", () => {
  it("marks a delta incomplete and never waits for an ack", async () => {
    const { portal, emit, emitWithAck } = setup();

    await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 3)], false);

    expect(emitWithAck).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      "server-broadcast",
      "room-1",
      expect.any(ArrayBuffer),
      expect.any(Uint8Array),
      { complete: false, sceneVersion: 3 },
    );
  });

  it("marks a full sync complete, asks for a flush and waits for the ack", async () => {
    const { portal, emit, emitWithAck } = setup();

    await portal.broadcastScene(
      WS_SUBTYPES.UPDATE,
      [rect("a", 3), rect("b", 4)],
      true,
    );

    expect(emit).not.toHaveBeenCalled();
    expect(emitWithAck).toHaveBeenCalledWith(
      "server-broadcast",
      "room-1",
      expect.any(ArrayBuffer),
      expect.any(Uint8Array),
      { complete: true, sceneVersion: 7, flush: true },
    );
  });

  it("sends volatile frames without meta", async () => {
    const { portal, emit } = setup();

    await portal.broadcastIdleChange("active" as any);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]).toHaveLength(4);
    expect(emit.mock.calls[0][0]).toBe("server-volatile-broadcast");
  });

  it("refuses a frame over the relay's buffer instead of killing the socket", async () => {
    const { portal, collab, emit, emitWithAck } = setup();
    encrypted.bytes = RELAY_MAX_FRAME_BYTES + 1;
    try {
      await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 1)], true);
    } finally {
      encrypted.bytes = 16;
    }

    expect(emit).not.toHaveBeenCalled();
    expect(emitWithAck).not.toHaveBeenCalled();
    expect(collab.onSceneSaveError).toHaveBeenCalledWith(
      expect.any(RelayFrameTooLargeError),
    );
  });

  it("surfaces a complete frame whose ack never comes", async () => {
    const { portal, collab } = setup(new Error("operation has timed out"));

    await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 1)], true);

    expect(collab.onSceneSaveError).toHaveBeenCalled();
    expect(collab.onScenePersisted).not.toHaveBeenCalled();
  });
});

describe("unload guard bookkeeping", () => {
  it("is dirty after a local change until a persisted ack covers it", async () => {
    const { portal, collab } = setup();
    portal.persistence.markLocalChange();
    expect(portal.persistence.hasUnpersisted()).toBe(true);

    await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 1)], true);

    expect(portal.persistence.hasUnpersisted()).toBe(false);
    expect(collab.onScenePersisted).toHaveBeenCalled();
  });

  it("does not count a stale or unpersisted ack", async () => {
    for (const ack of [
      { version: 1, persisted: true, rejected: "stale" },
      { version: 1, persisted: false },
    ]) {
      const { portal } = setup(ack);
      portal.persistence.markLocalChange();
      await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 1)], true);
      expect(portal.persistence.hasUnpersisted()).toBe(true);
    }
  });

  it("does not let a frame settle a change made after it was sent", () => {
    const tracker = new PersistenceTracker();
    tracker.markLocalChange();
    const { seq } = tracker.frame(true, 1);
    tracker.markLocalChange();

    tracker.settle({ version: 1, persisted: true }, seq);

    expect(tracker.hasUnpersisted()).toBe(true);
  });

  it("is clean for a participant who only watched", () => {
    expect(new PersistenceTracker().hasUnpersisted()).toBe(false);
  });
});

describe("complete frame sceneVersion", () => {
  it("never goes below what was loaded, so a reopened board is not stale", () => {
    const tracker = new PersistenceTracker();
    // the stored snapshot said 100; a day later deleted elements aged out of
    // the syncable set and the raw sum is only 80
    tracker.noteSceneVersion(100);

    expect(tracker.frame(true, 80).meta.sceneVersion).toBe(101);
    expect(tracker.frame(true, 80).meta.sceneVersion).toBe(102);
    expect(tracker.frame(true, 500).meta.sceneVersion).toBe(500);
  });

  it("rides inside the payload so the next loader learns it", async () => {
    const { portal } = setup();
    const sent: any[] = [];
    vi.spyOn(portal, "_broadcastSocketData").mockImplementation(
      async (data) => {
        sent.push(data);
        return null;
      },
    );

    await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 5)], true);
    await portal.broadcastScene(WS_SUBTYPES.UPDATE, [rect("a", 6)], false);

    expect(sent[0].payload.sceneVersion).toBe(5);
    expect(sent[1].payload.sceneVersion).toBeUndefined();
  });
});

describe("requestScene", () => {
  const socket = (ack: unknown) => ({
    timeout: () => ({
      emitWithAck: async () => {
        if (ack instanceof Error) {
          throw ack;
        }
        return ack;
      },
    }),
  });

  it("resolves null only for a room the relay has no snapshot of", async () => {
    await expect(requestScene(socket(null), "room")).resolves.toBeNull();
  });

  it("returns the stored bytes", async () => {
    const scene = await requestScene(
      socket({
        data: new Uint8Array([1, 2, 3]).buffer,
        iv: new Uint8Array(12),
        version: 4,
      }),
      "room",
    );

    expect([...scene!.data]).toEqual([1, 2, 3]);
    expect(scene!.iv).toHaveLength(12);
  });

  it("throws, never null, on a timeout or a malformed ack", async () => {
    await expect(
      requestScene(socket(new Error("timed out")), "room"),
    ).rejects.toThrow();
    await expect(requestScene(socket({ version: 1 }), "room")).rejects.toThrow(
      "malformed",
    );
  });
});
