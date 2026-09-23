# Relay persistence — the backend plan

How the Unobravo collaboration relay becomes the whiteboard's only storage, so the app can drop Firestore and Firebase Storage entirely.

This document is **normative** for the wire protocol. `unobravo/frontend.md` mirrors the same tables for the client implementer; where the two disagree, this one is right.

Companion documents: `unobravo/url.md` (how the parent application opens the whiteboard), `unobravo/FORK.md` (what the fork changes upstream and why).

---

## 1. What this replaces

The app currently keeps three things in Firebase:

| What | Where today |
| --- | --- |
| The encrypted scene snapshot | Firestore, `scenes/{roomId}` |
| The collaboration images | Firebase Storage, `files/rooms/{roomId}/{fileId}` |
| The Excalidraw+ export | Firebase Storage — already gated off, deleted with the rest |

Both Firebase projects are **Excalidraw's own**, not Unobravo's: `.env.production` points at `excalidraw-room-persistence` and `.env.development` at `excalidraw-oss-dev`. That is the go-live blocker recorded in `FORK.md:127` and `FORK.md:147`, and it is why the target is not "repoint Firebase" but "delete it".

The relay already replays a per-room versioned snapshot to a joiner (`FORK.md:106`). What it lacks is durability: all state lives in one ECS task's memory by design, so a redeploy drops every room and versioning restarts at 1 (`FORK.md:126`). The work here is to make that snapshot survive, and to make it _correct_ — which turns out to be the harder half.

## 2. The finding that shapes the whole design

On the wire today (`excalidraw-app/collab/Portal.tsx`, `_broadcastSocketData`):

```
emit("server-broadcast", roomId, encryptedBuffer, iv)
```

`roomId` is cleartext. Everything else is AES-GCM under the room key. **The message type and the "is this the whole scene" flag are inside the ciphertext**, so the relay has no way to tell a complete scene from three dirty elements.

And most frames are partial. `broadcastElements` (`excalidraw-app/collab/Collab.tsx:966`) fires on every stroke with `syncAll: false`, sending only the elements whose version changed. Only `queueBroadcastAllElements` sends everything, throttled to `SYNC_FULL_SCENE_INTERVAL_MS` = 20 s (`excalidraw-app/app_constants.ts:6`).

The spike measured this against a real relay and wrote it down in `unobravo/dev/README.md`:

> `lastReliable` is the interesting one: watch it drop to a few hundred bytes mid-drawing. That is finding #1 from the ticket, visible live — the relay's snapshot is usually a delta, and a flush to S3 at that moment would persist a partial board.

So a relay that persists whatever arrives last persists broken whiteboards. With one blob per room and no server-side merge — which end-to-end encryption forbids — this is not an edge case, it is the common case.

**The fix is not server-side cleverness.** The client already knows whether it is sending a complete scene; it just never says so. The protocol below makes it say so, in cleartext, in a field that reveals nothing about the content.

## 3. Interface agreement

**Transport.** socket.io v4, websocket only — the relay rejects polling (`FORK.md:128`), and upstream tries websocket first, so this costs nothing.

**Handshake.** Unchanged: `auth: { token, patientId, doctorId }`. See `unobravo/url.md` for how the parent application supplies them and what the relay answers on rejection.

**Trust boundary.** Only `roomId`, `meta` and the ack bodies are cleartext. `encrypted` and `iv` are AES-GCM under the room key, which the relay never sees. **The relay must treat them as opaque bytes**: never parse, never merge, never re-encode, never log their contents. Everything in section 6 follows from the relay being unable to read what it stores.

### 3.1 Client → relay

| Event | Arguments | Ack |
| --- | --- | --- |
| `join-room` | `roomId: string` | — |
| `request-scene` | `roomId: string` | `{ data, iv, version } \| null` |
| `server-broadcast` | `roomId: string, encrypted: ArrayBuffer, iv: Uint8Array, meta: Meta` | `Ack` |
| `server-volatile-broadcast` | `roomId: string, encrypted: ArrayBuffer, iv: Uint8Array` | — |
| `user-follow` | unchanged | — |

```ts
type Meta = {
  /** true = this payload is the entire scene, not a delta */
  complete: boolean;
  /** the client's getSceneVersion(elements) — a plain integer, cleartext */
  sceneVersion: number;
  /** ask the relay to write through to S3 before acking */
  flush?: boolean;
};

type Ack = {
  /** the relay's monotonic per-room snapshot counter */
  version: number;
  /** true if and only if these bytes are in S3 */
  persisted: boolean;
  /** present when the snapshot write was refused */
  rejected?: "stale";
};
```

`meta` is new. `server-broadcast` currently takes three arguments and no ack; both additions are backwards-shaped — socket.io ignores arguments a handler does not declare — so an upstream `excalidraw-room` still works with a client that sends them.

### 3.2 Relay → client

| Event | Arguments | When |
| --- | --- | --- |
| `init-room` | — | on connection |
| `first-in-room` | — | on `join-room` when the room has no other member |
| `new-user` | `socketId: string` | on `join-room`, to the other members |
| `room-user-change` | `socketId[]` | after every join and every disconnect |
| `client-broadcast` | `encrypted, iv, version?` | fan-out; `version` only on reliable frames |

### 3.3 Relay rules

These are numbered because the acceptance criteria in section 8 cite them.

1. **`meta.complete === false` → fan out, never touch the snapshot.** A delta is for the peers who are already in the room and already hold the rest of the scene. It is meaningless to anyone joining later.

2. **`meta.complete === true` → fan out, then replace the snapshot** with this payload and increment the room's `version` counter by one.

3. **`meta.sceneVersion <= snapshot.sceneVersion` → refuse the snapshot write, but still fan out.** Ack `{ version: <unchanged>, persisted: <current state>, rejected: "stale" }`. This is the lagging-client case: a slow peer whose full-scene frame is built on an older state and would otherwise overwrite a newer board.

   **The honest limit, which the implementer needs to know:** `getSceneVersion` is the sum of the scene's element versions. It is monotonic within one scene's history, but it is not a reliable ordering across two diverged scenes — two different boards can produce the same sum, and a scene that lost elements can score lower while being newer. It covers the real failure (a slow client overwriting with a stale full scene) and nothing more. It is a heuristic, not a proof, and the relay must not build anything else on it.

4. **`server-volatile-broadcast` is never snapshotted and never acked.** It carries cursor positions, idle status and viewport bounds. Persisting it would overwrite a board with a mouse coordinate.

5. **`persisted: true` means the bytes are in S3, nothing weaker.** For a frame without `meta.flush`, ack as soon as the payload is in Redis, with `persisted: false` — the S3 write is debounced (section 5). For a frame with `meta.flush: true`, complete the S3 write _before_ acking. The client's unload guard depends on this distinction being exact: it is the difference between "your drawing is safe" and "your drawing is in a cache that a scale-in event can discard".

6. **`request-scene` resolves Redis → S3 → `null`.** `null` means "this room has no snapshot", definitively. It must not be used for "not ready yet" or for an internal error — the client treats `null` as a new, empty whiteboard and starts drawing on it. An error must reject the ack or surface as a socket error, never as `null`.

## 4. Blocking prerequisite: raise `maxHttpBufferSize`

**socket.io caps a payload at 1 MB by default.** The image bytes now travel inside the scene payload as base64 dataURLs, which inflates them by about 33% before they hit that cap — and the _complete_ frame, the only one worth persisting, is by construction the largest frame the client ever sends.

Past the cap the broadcast never reaches the server, the acknowledgement never fires, and the socket is torn down with **no catchable error**. The failure mode is a whiteboard that saves fine while it is small and silently stops saving once it has a few photographs on it.

The client limits what a single image can weigh (`unobravo/config/imageOptions.ts` on the spike branch: 1600 px long edge, JPEG re-encode on insert, 1 MiB hard ceiling after the resize), and that should stay as defence in depth. But a board with six images is six times that in one complete frame, and the client cannot help with that.

**Set `maxHttpBufferSize` to 16 MB.** The spike's local stub (`unobravo/dev/relay-stub.mjs`) already runs at 25 MB, which is where the round-trip measurements were taken. 16 MB leaves room for a board that is large by clinical-whiteboard standards while still bounding a hostile client.

`unobravo/tests/imageBudget.test.ts` currently asserts the _failure_ on purpose — that the worst-case frame exceeds the 1 MB default — so the day this lands, that expectation flips and the test is the reminder.

## 5. Storage

### 5.1 Layout

```
Redis   room:{roomId}:scene      { data, iv, version, sceneVersion, updatedAt }   TTL 24h
        room:{roomId}:dirty      timestamp of the oldest change not yet in S3
        room:{roomId}:flushing   lock — SET NX PX 30000

S3      rooms/{roomId}/scene.bin
        object metadata: { version, sceneVersion, updatedAt }
```

**Redis is a cache; S3 is the truth.** Redis carries no persistence guarantee here, so nothing may depend on it surviving. The 24 h TTL exists to bound memory for dormant rooms — it is not a retention policy, and a room whose Redis entry has expired is loaded from S3 on the next `request-scene` exactly as a cold room would be.

Store `data` and `iv` as bytes. Do not base64 them into Redis or into the S3 object body: they are already the largest thing in the system and another 33% is real money at this size.

### 5.2 When to write

**Redis: on every complete frame.** It is memory, it costs nothing, and it is what makes a mid-session join fast.

**S3: on five triggers, and all five are needed.**

| # | Trigger | Why it exists |
| --- | --- | --- |
| 1 | Debounce, ~15 s after the first unflushed complete frame | Absorbs the 20 s beat multiplied by the number of connected clients |
| 2 | The last client leaves the room | The closest thing to a session end the relay can observe — there is no session-end event from the product |
| 3 | Hard ceiling: dirty and >60 s since the last S3 write | Bounds the loss when a task dies mid-session. Without it, a long uninterrupted drawing session lives entirely in a volatile cache |
| 4 | `SIGTERM` | ECS sends it on every deploy and every scale-in. **This is the trigger that turns a redeploy from data loss into a non-event**, and it is the one most likely to be forgotten |
| 5 | `meta.flush === true` | The client is closing the tab and is waiting on the ack. Synchronous by rule 5 |

Triggers 1 and 3 are not redundant: the debounce keeps re-arming while a client draws continuously, so without the ceiling a busy room can go arbitrarily long without ever reaching S3.

### 5.3 Multi-node

The relay autoscales, so two clients in one room can land on different tasks.

- **socket.io Redis adapter, for fan-out.** This is required independently of persistence: without it, two clients on two tasks are in the same room and cannot see each other at all. If it is not in place today, it is the first thing to fix, before any of this.
- **A per-room flush lock**, `SET room:{roomId}:flushing NX PX 30000`. Whoever takes it performs the S3 write. Without it two tasks flush concurrently and the winner is whoever finishes last, which is not the one holding the newest scene.
- **Compare versions before the PUT.** Read the current object's `version` metadata and write only if the Redis `version` is greater. A flush delayed behind a lock must not overwrite an object another task wrote in the meantime.

## 6. Implementation sketch

Shape, not code — it makes no assumptions about the relay's file layout, and the error handling is left out deliberately.

```ts
// ---- join ------------------------------------------------------------------
socket.on("join-room", async (roomId) => {
  await socket.join(roomId);
  const members = await membersOf(roomId);

  if (members.length <= 1) {
    socket.emit("first-in-room");
  } else {
    socket.to(roomId).emit("new-user", socket.id);
  }
  io.to(roomId).emit("room-user-change", members);
});

// ---- load (rule 6) ---------------------------------------------------------
socket.on("request-scene", async (roomId, ack) => {
  const cached = await redis.hgetall(`room:${roomId}:scene`);
  if (cached) {
    return ack({ data: cached.data, iv: cached.iv, version: cached.version });
  }

  const object = await s3.get(`rooms/${roomId}/scene.bin`); // null when absent
  if (!object) {
    return ack(null); // definitive: new whiteboard
  }

  await redis.hset(`room:${roomId}:scene`, { ...object, ...object.metadata });
  await redis.expire(`room:${roomId}:scene`, 86_400);
  return ack({
    data: object.body,
    iv: object.metadata.iv,
    version: object.metadata.version,
  });
});

// ---- broadcast + persist (rules 1, 2, 3, 5) --------------------------------
socket.on("server-broadcast", async (roomId, encrypted, iv, meta, ack) => {
  // fan out first, always, whatever we decide about persistence (rules 1 and 3)
  socket.broadcast
    .to(roomId)
    .emit("client-broadcast", encrypted, iv, /* version */ undefined);

  if (!meta?.complete) {
    return; // rule 1 — a delta is never a snapshot
  }

  const current = await redis.hgetall(`room:${roomId}:scene`);

  if (current && meta.sceneVersion <= current.sceneVersion) {
    // rule 3 — a lagging client must not overwrite a newer board
    return ack?.({
      version: current.version,
      persisted: false,
      rejected: "stale",
    });
  }

  const version = (current?.version ?? 0) + 1;
  await redis.hset(`room:${roomId}:scene`, {
    data: encrypted,
    iv,
    version,
    sceneVersion: meta.sceneVersion,
    updatedAt: Date.now(),
  });
  await redis.expire(`room:${roomId}:scene`, 86_400);
  await redis.set(`room:${roomId}:dirty`, Date.now(), { NX: true });

  if (meta.flush) {
    await flushToS3(roomId); // rule 5 — synchronous, the client is waiting
    return ack?.({ version, persisted: true });
  }

  scheduleFlush(roomId); // trigger 1
  ack?.({ version, persisted: false });
});

// ---- volatile (rule 4) -----------------------------------------------------
socket.on("server-volatile-broadcast", (roomId, encrypted, iv) => {
  socket.volatile.broadcast.to(roomId).emit("client-broadcast", encrypted, iv);
});

// ---- last one out (trigger 2) ----------------------------------------------
socket.on("disconnecting", async () => {
  for (const roomId of roomsOf(socket)) {
    const remaining = (await membersOf(roomId)).filter(
      (id) => id !== socket.id,
    );
    io.to(roomId).emit("room-user-change", remaining);
    if (remaining.length === 0) {
      await flushToS3(roomId);
    }
  }
});

// ---- the flush itself (5.3) ------------------------------------------------
async function flushToS3(roomId) {
  const lock = await redis.set(`room:${roomId}:flushing`, id, {
    NX: true,
    PX: 30_000,
  });
  if (!lock) return; // another task owns this flush

  try {
    const scene = await redis.hgetall(`room:${roomId}:scene`);
    if (!scene) return;

    const existing = await s3.head(`rooms/${roomId}/scene.bin`);
    if (existing && existing.metadata.version >= scene.version) {
      return; // a newer flush already landed
    }

    await s3.put(`rooms/${roomId}/scene.bin`, scene.data, {
      metadata: {
        version: scene.version,
        sceneVersion: scene.sceneVersion,
        iv: scene.iv,
        updatedAt: scene.updatedAt,
      },
    });
    await redis.del(`room:${roomId}:dirty`);
  } finally {
    await redis.del(`room:${roomId}:flushing`);
  }
}

// ---- shutdown (trigger 4) --------------------------------------------------
process.on("SIGTERM", async () => {
  io.close(); // stop accepting, keep the process alive
  await Promise.allSettled(dirtyRooms().map(flushToS3));
  process.exit(0);
});
```

Two notes the sketch cannot carry:

- **`iv` lives in the S3 object's metadata, not its body.** The body is the ciphertext and nothing else, so the object stays exactly the bytes the client sent.
- **The fan-out happens before any persistence decision**, including for a rejected stale frame. A client whose snapshot write was refused is still a client whose peers need its elements — rule 3 rejects a _write_, not a _message_.

## 7. Firestore migration: the relay does not participate

The whiteboards still in Firestore are migrated, and nothing in this document changes because of it. The work is entirely on the client; this section exists so the relay implementer knows why, and which of the rules above the migration leans on.

A server-side migration is impossible. The Firestore blob encrypts a bare `JSON.stringify(elements)` array, while a relay snapshot encrypts a `{ type, payload }` envelope — rewrapping one into the other needs the room key, which the relay does not have and must never have (§3, trust boundary). The images are worse: they live in Firebase Storage under `fileId`s that are themselves inside the encrypted scene, so the relay cannot even learn which files to fetch.

So the client reads Firestore, decrypts, inlines the images and sends the result as an ordinary complete frame. See `unobravo/frontend.md` §9 for the mechanism, and `unobravo/decommission-firestore.md` for how and when it is taken out again. Two consequences for the relay:

- A migrated whiteboard arrives as a `server-broadcast` with `meta.complete: true` and `meta.flush: true`, on a room that has no snapshot yet. Rule 2 applies unchanged, and rule 3 cannot fire — there is no stored `sceneVersion` to compare against.
- **The client deletes the Firestore document and the Storage objects once it receives an ack with `persisted: true`.** That makes rule 5 load-bearing for data which, at that instant, exists nowhere else: acking `persisted: true` before the S3 write has actually completed would destroy the only other copy. If the implementation is going to be sloppy anywhere, it must not be here.

## 8. Acceptance criteria

Each is independently testable. The first six map one-to-one onto the rules in §3.3.

1. A `server-broadcast` with `meta.complete: false` is fanned out and leaves `room:{roomId}:scene` byte-identical.
2. A `server-broadcast` with `meta.complete: true` is fanned out and becomes the snapshot, with `version` exactly one greater than before.
3. A complete frame whose `meta.sceneVersion` is less than or equal to the stored one is fanned out, leaves the snapshot untouched, and acks `rejected: "stale"`.
4. A `server-volatile-broadcast` never changes the snapshot and never acks.
5. An ack carries `persisted: true` only after the S3 PUT has completed. A frame with `meta.flush: true` does not ack before that PUT.
6. `request-scene` on an unknown room acks `null`; on a known room acks the exact bytes that were stored, with the current `version`.
7. **Redeploy mid-session loses nothing.** Draw, `SIGTERM` the task, reconnect, reload the room: the board is intact.
8. **A room reopened after the Redis TTL loads from S3.** Flush a room, delete its Redis keys, `request-scene`: the snapshot comes back and Redis is repopulated.
9. **Two clients on two tasks see each other.** With the Redis adapter in place, a stroke drawn on task A reaches a client on task B.
10. **A delta never becomes the snapshot**, even when it is the last frame before every client disconnects. Draw, let a delta be the final message, disconnect everyone, then rejoin: the whole board is there, not the last stroke.
11. **A 12 MB complete frame round-trips**, proving `maxHttpBufferSize` was actually raised — the one failure that produces no error anywhere.

## 9. What this design costs

Worth stating plainly, because every item is a consequence of keeping end-to-end encryption, which was a deliberate choice and not an accident:

- **No server-side features, ever.** No thumbnails, no previews, no export, no search, no content audit. The relay stores bytes it cannot read.
- **No server-side format migration.** If an upstream sync changes Excalidraw's element schema, the stored blobs cannot be migrated by any server: only a client with the room key can read one, rewrite it and send it back. That migration is lazy by necessity and has to be designed before it is needed, not after.
- **A lost key is a lost whiteboard.** The parent webapp's room-key table becomes exactly as critical as the S3 bucket. Its backups and its replication need to be treated that way.
- **The blob is rewritten whole on every flush.** A 10 MB board flushed every 30 s across a 50-minute session is roughly 1 GB of PUTs. Not alarming, not free.

And the benefit that is worth banking explicitly, because it pays for some of the above: **deleting the key is effective erasure.** A GDPR deletion request is a row in the parent application's database, not a hunt across S3 objects, versions and replicas.

## 10. Open points

- **S3 versioning and lifecycle.** The whiteboard is a permanent document with no defined end of life, which is a decision to make rather than a decision already made. Object versioning would turn an accidental stale overwrite into something recoverable, at the cost of storing every flush.
- **The lazy format migration** forced by end-to-end encryption (§9). Nothing needs it today; the first upstream sync that changes the element schema will.
- **Room key rotation.** There is no mechanism. A room key is fixed for the life of the whiteboard, and re-keying would mean a client decrypting and re-encrypting the whole board. Out of scope here, worth knowing it has no answer yet.
