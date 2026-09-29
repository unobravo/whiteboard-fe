import * as Sentry from "@sentry/browser";
import { MIME_TYPES } from "@excalidraw/common";
import { isInitializedImageElement } from "@excalidraw/element";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import { decryptData } from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";

import type {
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { isPersisted, reportRelayIssue } from "./relayPersistence";

import type { RelayAck } from "./relayPersistence";

/**
 * Lazy migration of the whiteboards created while the scene lived in
 * Firestore — `unobravo/frontend.md` §9. Runs when the relay answers
 * `request-scene` with `null`; disposable by construction, and
 * `unobravo/decommission-firestore.md` is the plan for taking it out.
 *
 * No Firebase SDK: the rules allow an unauthenticated `get`/`write`, so both
 * reads and deletes are plain REST calls.
 */

// Excalidraw's production project, which every deployed build pointed at
const FIRESTORE_PROJECT = "excalidraw-room-persistence";
const STORAGE_BUCKET = "excalidraw-room-persistence.appspot.com";

const SCENE_TIMEOUT_MS = 5_000;
const FILE_TIMEOUT_MS = 15_000;

export type LegacyScene = {
  /** restored, not yet filtered: the caller applies `getSyncableElements` */
  elements: readonly OrderedExcalidrawElement[];
  files: BinaryFileData[];
};

const sceneUrl = (roomId: string) =>
  `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/scenes/${encodeURIComponent(
    roomId,
  )}`;

const fileUrl = (roomId: string, fileId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(
    `files/rooms/${roomId}/${fileId}`,
  )}`;

const fetchWithTimeout = async (
  url: string,
  timeoutMs: number,
  init?: RequestInit,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const base64ToBytes = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const count = (legacyScene: "migrated" | "not-found") => {
  try {
    Sentry.captureMessage(`legacyScene: ${legacyScene}`, {
      level: "info",
      tags: { legacyScene },
    });
  } catch (error) {
    console.error(error);
  }
};

/**
 * A 404 is `null`. Anything that cannot be read in full throws — an image
 * included: a partial board, once the relay holds it, is never migrated again.
 */
export const loadLegacyScene = async (
  roomId: string,
  roomKey: string,
): Promise<LegacyScene | null> => {
  const response = await fetchWithTimeout(sceneUrl(roomId), SCENE_TIMEOUT_MS);
  if (response.status === 404) {
    count("not-found");
    return null;
  }
  if (!response.ok) {
    throw new Error(`legacy scene: HTTP ${response.status}`);
  }

  const { fields } = await response.json();
  const decrypted = await decryptData(
    base64ToBytes(fields.iv.bytesValue),
    base64ToBytes(fields.ciphertext.bytesValue),
    roomKey,
  );
  // older scenes may predate today's element schema: restore before anything
  // else sees them, exactly as the Firestore loader did
  const elements = restoreElements(
    JSON.parse(new TextDecoder().decode(decrypted)),
    null,
    { deleteInvisibleElements: true },
  );

  const fileIds = new Set<FileId>();
  for (const element of elements) {
    if (isInitializedImageElement(element)) {
      fileIds.add(element.fileId);
    }
  }

  const files: BinaryFileData[] = [];
  await Promise.all(
    [...fileIds].map(async (id) => {
      const response = await fetchWithTimeout(
        `${fileUrl(roomId, id)}?alt=media`,
        FILE_TIMEOUT_MS,
      );
      if (response.status === 404) {
        // never uploaded: nothing exists that a migration could lose
        return;
      }
      if (!response.ok) {
        throw new Error(`legacy file: HTTP ${response.status}`);
      }
      const { data, metadata } = await decompressData<BinaryFileMetadata>(
        new Uint8Array(await response.arrayBuffer()),
        { decryptionKey: roomKey },
      );
      files.push({
        id,
        mimeType: metadata.mimeType || MIME_TYPES.binary,
        dataURL: new TextDecoder().decode(data) as DataURL,
        created: metadata.created || Date.now(),
        lastRetrieved: Date.now(),
      });
    }),
  );

  return { elements, files };
};

/**
 * Called with the ack of the migrated scene's complete frame. The Firestore
 * copy is deleted only once the relay says the bytes are in S3 — anything
 * weaker destroys the only other copy of the board (frontend.md §9, point 3).
 */
export const finishLegacyMigration = async (
  roomId: string,
  legacy: LegacyScene,
  ack: RelayAck | null,
) => {
  if (!ack || !isPersisted(ack)) {
    return;
  }
  count("migrated");
  try {
    const responses = await Promise.all([
      fetchWithTimeout(sceneUrl(roomId), SCENE_TIMEOUT_MS, {
        method: "DELETE",
      }),
      ...legacy.files.map((file) =>
        fetchWithTimeout(fileUrl(roomId, file.id), FILE_TIMEOUT_MS, {
          method: "DELETE",
        }),
      ),
    ]);
    const failed = responses.find((r) => !r.ok && r.status !== 404);
    if (failed) {
      throw new Error(`legacy delete: HTTP ${failed.status}`);
    }
  } catch (error) {
    reportRelayIssue("legacy-delete-failed", error);
  }
};
