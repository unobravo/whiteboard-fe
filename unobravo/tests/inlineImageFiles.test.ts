/**
 * The scene broadcast carries its image bytes: there is no file store, so the
 * dataURL the editor already holds rides inside the scene payload. These
 * assertions pin what `Portal.broadcastScene` puts on the wire, and that a
 * delta stays a delta — a broadcast only carries the files its own elements
 * reference.
 *
 * `_broadcastSocketData` is stubbed, so this asserts the payload and not the
 * encryption or the socket; `relayPersistence.test.ts` covers those.
 */
import { describe, expect, it, vi } from "vitest";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import Portal from "../../excalidraw-app/collab/Portal";
import { WS_SUBTYPES } from "../../excalidraw-app/app_constants";

import type { TCollabClass } from "../../excalidraw-app/collab/Collab";
import type { SocketUpdateData } from "../../excalidraw-app/data";

const imageElement = (id: string, fileId: string) =>
  ({
    id,
    type: "image",
    fileId,
    status: "saved",
    version: 1,
    versionNonce: 1,
    index: `a${id}`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    scale: [1, 1],
    crop: null,
  } as unknown as OrderedExcalidrawElement);

const dataURL = (marker: string) =>
  `data:image/png;base64,${marker.repeat(64)}`;

const setup = (elements: OrderedExcalidrawElement[], files: BinaryFiles) => {
  const sent: SocketUpdateData[] = [];

  const collab = {
    excalidrawAPI: {
      getFiles: () => files,
      getSceneElementsIncludingDeleted: () => elements,
      updateScene: () => {},
      getAppState: () => ({ selectedElementIds: {} }),
    },
    getSceneElementsIncludingDeleted: () => elements,
    fileManager: {
      saveFiles: async () => ({
        savedFiles: new Map(),
        erroredFiles: new Map(),
      }),
      shouldUpdateImageElementStatus: () => false,
    },
    state: { username: "demo" },
  } as unknown as TCollabClass;

  const portal = new Portal(collab);
  portal.socket = { emit: () => {}, id: "socket-1" } as any;
  portal.socketInitialized = true;
  portal.roomId = "room-1";
  portal.roomKey = "key-1";
  vi.spyOn(portal, "_broadcastSocketData").mockImplementation(
    async (data: SocketUpdateData) => {
      sent.push(data);
      return null;
    },
  );

  return { portal, sent };
};

describe("inlined image files", () => {
  it("puts the dataURL of a referenced image in the scene payload", async () => {
    const elements = [imageElement("img-1", "file-1")];
    const files = {
      "file-1": {
        id: "file-1",
        mimeType: "image/png",
        dataURL: dataURL("A"),
        created: 1,
      },
    } as unknown as BinaryFiles;

    const { portal, sent } = setup(elements, files);
    await portal.broadcastScene(WS_SUBTYPES.INIT, elements, true);

    expect(sent).toHaveLength(1);
    const payload = (sent[0] as any).payload;
    expect(Object.keys(payload.files)).toEqual(["file-1"]);
    expect(payload.files["file-1"].dataURL).toBe(dataURL("A"));
  });

  it("carries only the files the broadcast's own elements reference", async () => {
    const first = imageElement("img-1", "file-1");
    const second = imageElement("img-2", "file-2");
    const files = {
      "file-1": {
        id: "file-1",
        mimeType: "image/png",
        dataURL: dataURL("A"),
        created: 1,
      },
      "file-2": {
        id: "file-2",
        mimeType: "image/png",
        dataURL: dataURL("B"),
        created: 1,
      },
    } as unknown as BinaryFiles;

    const { portal, sent } = setup([first, second], files);

    // a full sync carries both
    await portal.broadcastScene(WS_SUBTYPES.INIT, [first, second], true);
    expect(Object.keys((sent[0] as any).payload.files)).toEqual([
      "file-1",
      "file-2",
    ]);

    // a delta after only the second element changed carries one image, not two:
    // re-broadcasting every image on every stroke is what would make this
    // approach untenable
    const changed = { ...second, version: 2 } as OrderedExcalidrawElement;
    await portal.broadcastScene(WS_SUBTYPES.UPDATE, [first, changed], false);
    const delta = (sent[1] as any).payload;
    expect(delta.elements.map((e: OrderedExcalidrawElement) => e.id)).toEqual([
      "img-2",
    ]);
    expect(Object.keys(delta.files)).toEqual(["file-2"]);
  });

  it("omits the files key when the scene has no images", async () => {
    const elements = [
      { ...imageElement("rect-1", "unused"), type: "rectangle" },
    ] as unknown as OrderedExcalidrawElement[];

    const { portal, sent } = setup(elements, {} as BinaryFiles);
    await portal.broadcastScene(WS_SUBTYPES.INIT, elements, true);

    expect((sent[0] as any).payload.files).toBeUndefined();
  });
});
