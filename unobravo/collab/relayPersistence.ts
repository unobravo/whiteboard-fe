import * as Sentry from "@sentry/browser";

/**
 * The client half of the relay persistence protocol — `unobravo/backend.md` §3
 * is normative, `unobravo/frontend.md` §3 mirrors it.
 *
 * Only `roomId`, `meta` and the ack bodies are cleartext; the scene stays
 * AES-GCM under the room key, which never leaves the client.
 */

/** the relay's `maxHttpBufferSize` (backend.md §4). Past it the socket dies silently. */
export const RELAY_MAX_FRAME_BYTES = 16 * 1024 * 1024;
/** a flushed frame waits on an S3 PUT, and the relay's flush lock is 30 s */
export const SCENE_ACK_TIMEOUT_MS = 30_000;
export const REQUEST_SCENE_TIMEOUT_MS = 10_000;

export type RelayMeta = {
  /** true = this payload is the entire scene, not a delta */
  complete: boolean;
  /** cleartext integer the relay compares to refuse a stale snapshot */
  sceneVersion: number;
  /** ask the relay to write through to S3 before acking */
  flush?: boolean;
};

export type RelayAck = {
  version: number;
  /** true if and only if these bytes are in S3 */
  persisted: boolean;
  rejected?: "stale";
};

export type RelayScene = {
  data: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
};

/** structural, so this module does not pin a socket.io-client version */
type AckSocket = {
  timeout(ms: number): {
    emitWithAck(event: string, ...args: unknown[]): Promise<any>;
  };
};

export class RelayFrameTooLargeError extends Error {
  constructor(bytes: number) {
    super(`scene frame is ${bytes} bytes, over ${RELAY_MAX_FRAME_BYTES}`);
    this.name = "RelayFrameTooLargeError";
  }
}

const toBytes = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    // copy: a view may sit on a larger (or shared) buffer
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    ) as Uint8Array<ArrayBuffer>;
  }
  return null;
};

/**
 * Resolves the room's snapshot, or `null` — which the relay only answers for a
 * room that has none (backend.md §3.3 rule 6). Anything else throws: a timeout
 * or a malformed ack is never "empty board".
 */
export const requestScene = async (
  socket: AckSocket,
  roomId: string,
): Promise<RelayScene | null> => {
  const ack = await socket
    .timeout(REQUEST_SCENE_TIMEOUT_MS)
    .emitWithAck("request-scene", roomId);
  if (ack === null) {
    return null;
  }
  const data = toBytes(ack?.data);
  const iv = toBytes(ack?.iv);
  if (!data || !iv) {
    throw new Error("request-scene: malformed ack");
  }
  return { data, iv };
};

/** emits a complete scene frame and resolves the relay's ack; throws on timeout */
export const emitSceneFrame = async (
  socket: AckSocket,
  roomId: string,
  encrypted: ArrayBuffer,
  iv: Uint8Array,
  meta: RelayMeta,
): Promise<RelayAck> => {
  const ack = await socket
    .timeout(SCENE_ACK_TIMEOUT_MS)
    .emitWithAck("server-broadcast", roomId, encrypted, iv, meta);
  if (typeof ack?.persisted !== "boolean") {
    throw new Error("server-broadcast: malformed ack");
  }
  return ack;
};

/** the only ack that means "this client's bytes are in S3" */
export const isPersisted = (ack: RelayAck) =>
  ack.persisted === true && !ack.rejected;

/**
 * Answers the unload guard's question: has this client broadcast a change
 * that no `persisted: true` ack has covered since?
 *
 * Local changes only — a participant who only watches has nothing to lose.
 * Every frame records the sequence number it covers at send time; only a
 * persisted, non-stale ack settles it.
 */
export class PersistenceTracker {
  private localSeq = 0;
  private persistedSeq = 0;
  /** highest sceneVersion known to be stored, or sent by this client */
  private sceneVersionFloor = 0;

  /**
   * The `meta` for a scene frame, and the local-change sequence number it
   * covers. Every complete frame asks for a write-through: a persisted ack is
   * what the unload guard waits on, and without `flush` none ever comes back.
   */
  frame(complete: boolean, sceneVersion: number) {
    const seq = this.localSeq;
    if (!complete) {
      return { seq, meta: { complete, sceneVersion } as RelayMeta };
    }
    // The raw sum can go *down* while the board moves forward — a deleted
    // element ages out of the syncable set a day later — and the relay would
    // then refuse every save of a reopened board as stale. So a complete
    // frame never goes below what was loaded or last sent; the value also
    // rides inside the payload, so whoever loads it can `noteSceneVersion`.
    const next = Math.max(sceneVersion, this.sceneVersionFloor + 1);
    this.sceneVersionFloor = next;
    return { seq, meta: { complete, sceneVersion: next, flush: true } };
  }

  /** true when the ack proves the frame is in S3 */
  settle(ack: RelayAck | null, seq: number) {
    if (!ack || !isPersisted(ack)) {
      return false;
    }
    this.persistedSeq = Math.max(this.persistedSeq, seq);
    return true;
  }

  markLocalChange() {
    this.localSeq++;
  }

  hasUnpersisted() {
    return this.localSeq > this.persistedSeq;
  }

  noteSceneVersion(sceneVersion: number) {
    this.sceneVersionFloor = Math.max(this.sceneVersionFloor, sceneVersion);
  }
}

export type RelayIssue =
  | "connect-failed"
  | "scene-load-failed"
  | "scene-save-failed"
  | "scene-too-large"
  | "legacy-load-failed"
  | "legacy-delete-failed";

/** never the room id or key: the tag and the error message are all it carries */
export const reportRelayIssue = (issue: RelayIssue, error?: unknown) => {
  try {
    Sentry.captureMessage(`relay: ${issue}`, {
      level: "warning",
      tags: { relayIssue: issue },
      extra: error ? { error: String(error) } : undefined,
    });
  } catch (sentryError) {
    console.error(sentryError);
  }
};
