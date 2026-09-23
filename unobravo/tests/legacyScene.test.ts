/**
 * The lazy Firestore migration (unobravo/frontend.md §9). The deletes are the
 * dangerous half: they destroy the only other copy of a board, so they must
 * fire on `persisted: true` and nothing weaker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { finishLegacyMigration, loadLegacyScene } from "../collab/legacyScene";

import type { LegacyScene } from "../collab/legacyScene";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/browser", () => sentry);

const image = {
  id: "img-1",
  type: "image",
  fileId: "file-1",
  status: "saved",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  version: 2,
};

vi.mock("@excalidraw/excalidraw/data/encryption", () => ({
  decryptData: async () =>
    new TextEncoder().encode(JSON.stringify([image])).buffer,
}));
vi.mock("@excalidraw/excalidraw/data/encode", () => ({
  decompressData: async () => ({
    data: new TextEncoder().encode("data:image/jpeg;base64,AAAA"),
    metadata: { mimeType: "image/jpeg", created: 1 },
  }),
}));

const firestoreDoc = {
  fields: {
    sceneVersion: { integerValue: "2" },
    iv: { bytesValue: btoa("123456789012") },
    ciphertext: { bytesValue: btoa("ciphertext") },
  },
};

type Route = (url: string, init?: RequestInit) => Response;
let route: Route;
const fetchMock = vi.fn((url: string, init?: RequestInit) =>
  Promise.resolve(route(url, init)),
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  sentry.captureMessage.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const deletes = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

describe("loadLegacyScene", () => {
  it("returns the restored elements and inlines their images", async () => {
    route = (url) =>
      url.includes("firestore")
        ? json(firestoreDoc)
        : new Response(new Uint8Array([1, 2, 3]));

    const legacy = await loadLegacyScene("room-1", "key");

    expect(legacy!.elements.map((e) => e.id)).toEqual(["img-1"]);
    expect(legacy!.files).toEqual([
      expect.objectContaining({
        id: "file-1",
        dataURL: "data:image/jpeg;base64,AAAA",
        mimeType: "image/jpeg",
      }),
    ]);
    const storageCall = fetchMock.mock.calls.find(([url]) =>
      url.includes("firebasestorage"),
    )!;
    expect(storageCall[0]).toContain(
      "files%2Frooms%2Froom-1%2Ffile-1?alt=media",
    );
  });

  it("returns null for a room that was never in Firestore, and counts it", async () => {
    route = () => json({ error: { code: 404 } }, 404);

    await expect(loadLegacyScene("room-1", "key")).resolves.toBeNull();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "legacyScene: not-found",
      expect.objectContaining({ tags: { legacyScene: "not-found" } }),
    );
  });

  it("throws when Firestore is unreachable, so the caller can surface it", async () => {
    route = () => json({}, 503);

    await expect(loadLegacyScene("room-1", "key")).rejects.toThrow("503");
    expect(deletes()).toHaveLength(0);
  });

  it("refuses a partial board when an image could not be read", async () => {
    // once the relay holds a snapshot the room is never migrated again, so a
    // board missing an image must not be migrated at all
    route = (url) =>
      url.includes("firestore") ? json(firestoreDoc) : json({}, 500);

    await expect(loadLegacyScene("room-1", "key")).rejects.toThrow("500");
  });

  it("migrates without an image that was never uploaded", async () => {
    route = (url) =>
      url.includes("firestore") ? json(firestoreDoc) : json({}, 404);

    const legacy = await loadLegacyScene("room-1", "key");

    expect(legacy!.elements).toHaveLength(1);
    expect(legacy!.files).toEqual([]);
  });
});

describe("finishLegacyMigration", () => {
  const legacy: LegacyScene = {
    elements: [],
    files: [
      {
        id: "file-1",
        mimeType: "image/jpeg",
        dataURL: "data:" as any,
        created: 1,
      } as any,
    ],
  };

  beforeEach(() => {
    route = () => new Response(null, { status: 200 });
  });

  it("deletes the Firestore document and its images once the relay has it in S3", async () => {
    await finishLegacyMigration("room-1", legacy, {
      version: 1,
      persisted: true,
    });

    const urls = deletes().map(([url]) => url);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/documents/scenes/room-1");
    expect(urls[1]).toContain("files%2Frooms%2Froom-1%2Ffile-1");
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "legacyScene: migrated",
      expect.anything(),
    );
  });

  it("never deletes on anything weaker than persisted: true", async () => {
    await finishLegacyMigration("room-1", legacy, {
      version: 1,
      persisted: false,
    });
    await finishLegacyMigration("room-1", legacy, {
      version: 1,
      persisted: true,
      rejected: "stale",
    });
    await finishLegacyMigration("room-1", legacy, null);

    expect(deletes()).toHaveLength(0);
  });
});
