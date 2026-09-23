# Removing Firestore — the frontend plan

How the app stops using Firestore and Firebase Storage and takes everything from the collaboration relay: the scene, the images, and the knowledge of whether the last drawing is safe.

The wire protocol in section 3 is a **mirror**. `unobravo/backend.md` is normative; where the two disagree, that one is right.

Read `unobravo/FORK.md` before touching anything under `excalidraw-app/` or `packages/` — every upstream file changed here needs a row in its register, and `yarn fork:check` fails in CI otherwise.

---

## 1. Why

Three things still live in Firebase:

| What | Where | Entry point |
| --- | --- | --- |
| The encrypted scene snapshot | Firestore `scenes/{roomId}` | `saveToFirebase` / `loadFromFirebase` |
| The collaboration images | Storage `files/rooms/{roomId}/{fileId}` | `FileManager` in `Collab.tsx:159-200` |
| The Excalidraw+ export | Storage | `ExportToExcalidrawPlus.tsx` — already gated off |

Both Firebase projects belong to Excalidraw, not to Unobravo: `.env.production` points at `excalidraw-room-persistence`, `.env.development` at `excalidraw-oss-dev`. The relay replaces all of it.

### The finding that shapes the client work

On the wire today (`excalidraw-app/collab/Portal.tsx`, `_broadcastSocketData`):

```
emit("server-broadcast", roomId, encryptedBuffer, iv)
```

Only `roomId` is cleartext. **The message type and the `syncAll` flag are inside the ciphertext**, so the relay cannot tell a complete scene from a handful of dirty elements — and most frames are the latter. `broadcastElements` (`Collab.tsx:966`) fires on every stroke with `syncAll: false`; only `queueBroadcastAllElements` sends everything, throttled to `SYNC_FULL_SCENE_INTERVAL_MS` = 20 s.

The spike measured it and wrote it down in `unobravo/dev/README.md`: _"the relay's snapshot is usually a delta, and a flush to S3 at that moment would persist a partial board."_

The client's job in this plan is therefore not just "stop calling Firebase". It is to say out loud, in cleartext, what it already knows: whether this frame is the whole board.

## 2. Blocking dependency

**Do not merge this before the relay is done.** Specifically, the relay must already:

- implement `request-scene` with the ack in section 3,
- persist complete frames durably to S3 (not only to Redis),
- and run with `maxHttpBufferSize` raised to 16 MB.

Removing Firestore against a relay that still keeps its snapshot in one task's memory means every redeploy silently erases every whiteboard. The order is: relay first, verified on staging, then this branch.

`unobravo/backend.md` §8 lists the acceptance criteria to check against before starting.

## 3. Interface agreement (mirror of `backend.md` §3)

**Transport.** socket.io v4, websocket only. Handshake unchanged: `auth: { token, patientId, doctorId }` — see `unobravo/url.md`.

**Trust boundary.** Only `roomId`, `meta` and the ack bodies are cleartext. `encrypted` and `iv` stay AES-GCM under the room key, which never leaves the client.

### Client → relay

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

### Relay → client

| Event | Arguments | When |
| --- | --- | --- |
| `init-room` | — | on connection |
| `first-in-room` | — | on `join-room` when the room has no other member |
| `new-user` | `socketId: string` | on `join-room`, to the other members |
| `room-user-change` | `socketId[]` | after every join and every disconnect |
| `client-broadcast` | `encrypted, iv, version?` | fan-out; `version` only on reliable frames |

### The rules the client depends on

- A frame with `complete: false` is fanned out and **never** becomes the snapshot.
- A frame with `complete: true` becomes the snapshot, unless its `sceneVersion` is not greater than the stored one — then the ack carries `rejected: "stale"` and the frame is still delivered to peers.
- `persisted: true` means **in S3**, not "received". Without `meta.flush`, the ack comes back as soon as the relay has it in Redis, with `persisted: false`. This distinction is the whole basis of the unload guard in section 5.2.
- `request-scene` acking `null` means "new whiteboard", definitively — not "not ready".

## 4. The changes, in commit order

Much of this already exists on `spike/remove-firebase`. Cherry-pick rather than rewrite; the "From spike" column says what is already there. The spike's code is marked `DEMO(MIL-2679)` throughout — those markers come off on the way in.

| # | File | Change | From spike |
| --- | --- | --- | --- |
| 1 | `excalidraw-app/data/firebase.ts` | delete, all 319 lines | yes |
| 2 | `excalidraw-app/data/index.ts` | add `files?: BinaryFiles` to the `SCENE_INIT` and `SCENE_UPDATE` payload types; drop the `saveFilesToFirebase` call in `exportToBackend` | yes |
| 3 | `excalidraw-app/collab/Portal.tsx` | attach image dataURLs to the broadcast; thread `meta` and the ack through `_broadcastSocketData`; track the last acked `sceneVersion` | partly |
| 4 | `excalidraw-app/collab/Collab.tsx` | `FileManager` stops reaching Firebase; apply inlined files on receive; load through `request-scene`; delete the save-to-Firebase machinery; restore the unload guard | partly |
| 5 | `excalidraw-app/App.tsx` | drop the `loadFilesFromFirebase` import and its call | yes |
| 6 | `excalidraw-app/components/ExportToExcalidrawPlus.tsx` | delete, with its import and `renderCustomUI` block in `App.tsx` | yes |
| 7 | env and config | drop the `firebase` dependency, `VITE_APP_FIREBASE_CONFIG`, and `firebase-project/` | yes |

### 4.1 Delete `excalidraw-app/data/firebase.ts`

Everything in it goes: `saveToFirebase`, `loadFromFirebase`, `isSavedToFirebase`, `saveFilesToFirebase`, `loadFilesFromFirebase`, `loadFirebaseStorage`, and the `FirebaseSceneVersionCache`.

Note what `FirebaseSceneVersionCache` was for — it is the thing being replaced in 5.2, not simply removed. It answered "is the scene as it stands already saved?", and the unload guard was its only consumer.

Before deleting, read `loadFilesFromFirebase` once: its public-URL `fetch` plus `decompressData` is the exact shape the migration module of §9 needs, and it is the only place that pipeline is written down.

### 4.2 `excalidraw-app/data/index.ts`

Add the inline files to both scene payload types:

```ts
SCENE_INIT: {
  type: WS_SUBTYPES.INIT;
  payload: {
    elements: readonly OrderedExcalidrawElement[];
    files?: BinaryFiles;
  };
};
SCENE_UPDATE: { /* the same addition */ };
```

`BinaryFiles` is already imported in this file. `SyncableExcalidrawElement`, `isSyncableElement` and `getSyncableElements` are untouched.

The `saveFilesToFirebase` call inside `exportToBackend` (share-link publishing) is **already dead code**: `onExportToBackend` is only wired when `FEATURES.shareLinks` is true, and it is `false` in `unobravo/config/features.ts`. It goes with the rest, with a comment saying so rather than a silent deletion.

### 4.3 `excalidraw-app/collab/Portal.tsx`

Two separate changes. The first is the spike's, verbatim:

```ts
// only the files the synced elements actually reference go out, so a delta
// broadcast stays a delta
const files: BinaryFiles = {};
const allFiles = this.collab.excalidrawAPI.getFiles();
for (const element of syncableElements) {
  if (isInitializedImageElement(element) && allFiles[element.fileId]) {
    files[element.fileId] = allFiles[element.fileId];
  }
}
```

The scoping to `syncableElements` — the already-filtered array, not the whole scene — is the point. Re-broadcasting every image on every stroke is what would make this approach untenable, and `unobravo/tests/inlineImageFiles.test.ts` pins it.

The second change is new: `_broadcastSocketData` gains the `meta` argument and the ack. `broadcastScene` already receives `syncAll`, so it has everything it needs:

```ts
this.socket?.emit(
  volatile ? WS_EVENTS.SERVER_VOLATILE : WS_EVENTS.SERVER,
  roomId ?? this.roomId,
  encryptedBuffer,
  iv,
  meta, // scene frames only — volatile frames pass nothing
  (ack) => {
    /* record version / persisted / rejected */
  },
);
```

Volatile broadcasts (cursor, idle, viewport bounds) pass no `meta` and no ack. They are never persisted, and adding an ack to a 30 fps cursor stream would be its own problem.

### 4.4 `excalidraw-app/collab/Collab.tsx`

The largest change, and the one worth reviewing carefully.

**`FileManager` stops reaching Firebase.** Nothing is fetched, because a file we do not have is one whose broadcast has not arrived yet, and the next full sync carries it. Nothing is uploaded, but `saveFiles` must still report the files as saved — that is what flips an image element out of `pending` status:

```ts
getFiles: async (fileIds) => ({
  loadedFiles: [],
  erroredFiles: new Map(fileIds.map((id) => [id, true as const])),
}),
saveFiles: async ({ addedFiles }) => ({
  savedFiles: addedFiles,
  erroredFiles: new Map<FileId, BinaryFileData>(),
}),
```

**Apply inlined files on receive**, in both the `SCENE_INIT` and `SCENE_UPDATE` cases of the `client-broadcast` handler, before reconciling elements:

```ts
private addInlinedFiles = (files: BinaryFiles | undefined) => {
  if (!files) return;
  const fileData = Object.values(files);
  if (fileData.length) {
    this.excalidrawAPI.addFiles(fileData);
  }
};
```

`addFiles` is idempotent per file id, so a resend costs a map write and nothing else.

**Load through `request-scene`.** `initializeRoom`'s `fetchScene` branch loses `loadFromFirebase` and gains an emit with an ack. A payload is decrypted with the room key and handled exactly like a peer's `SCENE_INIT`. A `null` ack means no relay snapshot — which is where the Firestore migration of §9 hooks in, before concluding the board is empty.

**Delete the save machinery**: `saveCollabRoomToFirebase`, `queueSaveToFirebase` and its call from `syncElements`, and the `isSavedToFirebase` check. The error dialogs they carried (`collabSaveFailed`, `collabSaveFailed_sizeExceeded`) now belong to a rejected or absent ack — do not lose the user-visible failure path along with the Firebase code.

### 4.5 through 4.7 — the cleanup

- `App.tsx`: the `loadFilesFromFirebase` import and its call are already unreachable — MIL-2563 hardcoded `?id=` and `#json=` to never resolve, so the code path that fetched those files cannot run.
- `ExportToExcalidrawPlus.tsx`: the last importer of `firebase/storage`. Already gated off by `FEATURES.plus`, so deleting the component, its import in `App.tsx` and the `renderCustomUI` block that mounts it changes no behaviour.
- `excalidraw-app/package.json`: drop `firebase` (11.3.1). `.env.production` / `.env.development`: drop `VITE_APP_FIREBASE_CONFIG` — the migration module of §9 carries the project id and bucket it needs as its own constants, and they go when it goes. `excalidraw-app/vite-env.d.ts` and `packages/excalidraw/vite-env.d.ts`: drop its declaration. Delete `firebase-project/` (the Firestore and Storage rules).

## 5. The two places a careless implementation loses work

Both of these are silent failures. Nothing throws, nothing appears in Sentry, and the user finds out later that part of the session is missing.

### 5.1 `meta.complete` must mirror `syncAll`, not be inferred

`broadcastScene` already takes `syncAll` as a parameter and already uses it to decide what goes in the payload. Pass that same value into `meta.complete`. Do not derive it from the payload — not from the element count, not from the byte size, not from "it looks like a lot".

The reason is in section 1: the relay stores exactly one blob per room, and a delta promoted to snapshot replaces a whole board with a few strokes. A heuristic that is right 99% of the time produces a whiteboard that is quietly wrong 1% of the time, which on clinical material is worse than one that fails loudly.

`WS_SUBTYPES.INIT` always has `syncAll: true` — `broadcastScene` throws otherwise — so the invariant already exists in the code and only needs forwarding.

### 5.2 The unload guard

The spike deleted `beforeUnload` outright in commit `6184a2ac`, and was right to at the time: with no file store, `shouldPreventUnload` could never be true, so the handler was dead code. With the relay persisting, it has something real to check again.

The check is: **is the last `sceneVersion` acked with `persisted: true` at least the current scene's `getSceneVersion`?** If not, there is unsaved work. Send a final complete frame with `meta.flush: true` and prevent unload while it is in flight.

Without this, closing the tab in the 20 seconds after a stroke loses that stroke — no error, no dialog, nothing in the logs. The whole point of the ack in the interface agreement is to make this question answerable.

Keep honouring `VITE_APP_DISABLE_PREVENT_UNLOAD`, as the current handler does.

## 6. What `request-scene` lets us delete

`INITIAL_SCENE_UPDATE_TIMEOUT` (5 s, `app_constants.ts:3`) and the `fallbackInitializationHandler` around `Collab.tsx:481` and `521-529` exist because the client could not tell "nobody is going to send me a scene" from "the scene is slow". It waited five seconds and assumed the first.

An ack answers the question directly: `null` is an empty board, a payload is the board. There is nothing left to time out.

This also removes a race rather than working around it. The spike's `6184a2ac` had to un-gate `SCENE_INIT` — applying it even after `socketInitialized` had flipped — precisely because the 5 s timer could fire before a real `SCENE_INIT` arrived on a slow join, and the guard then dropped the scene. With the ack there is no timer to lose the race against.

## 7. Tests

**Already in place**, both outside `excalidraw-app/` so they survive an upstream sync:

- `unobravo/tests/inlineImageFiles.test.ts` — the payload shape: a referenced image's dataURL is in the broadcast; a delta carries only its own elements' files; the `files` key is absent, not empty, when the scene has no images.
- `unobravo/tests/imageBudget.test.ts` — the image budget: inserts re-encode to JPEG, and ten worst-case images fit inside `RELAY_MAX_FRAME_BYTES` (the relay's 16 MB `maxHttpBufferSize`), the same constant the client's oversize pre-check uses.

**To add:**

- `meta.complete` is `true` on a full sync and `false` on a delta — the single assertion that protects section 5.1.
- The `request-scene` load path, both branches: a payload is decrypted and applied, and `null` yields an empty board rather than an error.
- The unload guard: a scene whose `sceneVersion` is ahead of the last `persisted: true` ack prevents unload and sends a `meta.flush` frame.

**To remove:** the `data/firebase.ts` mocks in `excalidraw-app/tests/collab.test.tsx` and `excalidraw-app/components/unobravo/relayHandshake.test.tsx`.

`relayHandshake.test.tsx` asserts the options object passed to `socket.io-client` because that gate is exactly the kind a clean merge drops — import survives, property does not. The same reasoning applies to `meta`: assert the emitted arguments, not just that an emit happened.

## 8. `FORK.md` and the register

New or changed rows: `Portal.tsx` (new), `Collab.tsx`, `App.tsx`, `data/index.ts`, both `vite-env.d.ts`, and the deletions of `data/firebase.ts` and `ExportToExcalidrawPlus.tsx`. `yarn fork:check` reads that register and fails when reality drifts from it.

Two things worth recording there explicitly:

- **The net fork surface shrinks.** `data/firebase.ts` and `ExportToExcalidrawPlus.tsx` leave the register entirely, and the whole "Firebase is still Excalidraw's" known gap (`FORK.md:127`) closes with them.
- **The `meta` argument is additive.** socket.io ignores arguments a handler does not declare, so a client sending `meta` still works against an upstream `excalidraw-room`. That keeps this a low-risk level 4 rather than a structural divergence.

`unobravo/url.md` also needs a touch-up: its "Relay handshake outcomes" section still ends with _"On `connect_error` the app falls back to loading the scene from Firebase"_, which stops being true.

## 9. Migrating the old whiteboards out of Firestore

Whiteboards created before this change live in Firestore under `scenes/{roomId}`, with their images in Firebase Storage under `files/rooms/{roomId}/{fileId}`. They are migrated **lazily, by the client, on first open** — there is no batch job.

### Why the client, and why it is cheap

The relay cannot do it. The Firestore blob encrypts a bare `JSON.stringify(elements)` array while a relay snapshot encrypts a `{ type, payload }` envelope, and rewrapping one into the other needs the room key the relay must never hold. The images are referenced by `fileId`s that live inside the encrypted scene, so the relay cannot even learn which files to fetch.

The client can, and — this is the part worth knowing — **without the Firebase SDK**:

- **Storage reads are already plain `fetch`.** `loadFilesFromFirebase` never used the SDK: it builds a public `firebasestorage.googleapis.com/…?alt=media` URL and hands the bytes to `decompressData`.
- **Firestore reads work over REST, unauthenticated.** The rules are `allow get, write: if true` with `allow list: if false` (`firebase-project/firestore.rules`). Verified: a `GET` on `https://firestore.googleapis.com/v1/projects/excalidraw-room-persistence/databases/(default)/documents/scenes/<id>` for an unknown id answers `404 NOT_FOUND`, not `401` or `403` — the request passes the rules check and reaches document resolution.

So the whole legacy read path is two `fetch` calls. **The `firebase` dependency still goes** (step 7 of §4); the project id and the bucket name become two constants inside the migration module, and they are deleted with it.

`allow list: if false` is also why this is lazy rather than a batch: the rooms cannot be enumerated. Lazy needs no list — you migrate what somebody actually opens.

### Where it lives

One new module, `unobravo/collab/legacyScene.ts`, in a directory the fork owns, so **no `FORK.md` row and no merge cost**. It hooks into the single branch this plan already rewrites: the `null` ack from `request-scene` in §4.4.

### The flow

```
request-scene  ->  ack null
                     |
                     +-- GET firestore REST /scenes/{roomId}
                     |     404 -> new whiteboard, done
                     |
                     +-- decryptData(iv, ciphertext, roomKey) -> elements[]
                     +-- restoreElements(..., { deleteInvisibleElements: true })
                     |
                     +-- for each image element:
                     |     GET storage /files/rooms/{roomId}/{fileId}
                     |     decompressData(roomKey) -> dataURL + mimeType
                     |
                     +-- broadcastScene(INIT, elements, syncAll: true)
                     |     meta.complete = true, meta.flush = true
                     |     -> relay persists it in the new format
                     |
                     +-- on ack persisted: true
                           DELETE the Firestore doc and the Storage objects
```

It is self-healing: the second open of the same room finds a relay snapshot and never touches Firestore again.

### The five things that are not free

1. **It sits on the critical path of opening a whiteboard.** Bound it with a short timeout and fail soft — a Firestore that is slow or down must yield an empty board, never a board that will not open. But the failure has to be _visible_: with the unload guard of §5.2 active, drawing on a wrongly-empty board persists that emptiness over the real one. Surface it the way a failed save is surfaced, not silently.

2. **A 404 is the normal case**, so every genuinely new whiteboard pays one wasted GET. Accepted deliberately. The parent application holds the room table and could pass a marker for boards that predate the migration, but one cheap request beats a flag that outlives its purpose.

3. **Delete after migrating, and only after.** Once the relay acks `persisted: true`, delete the Firestore document and the Storage objects — `allow write: if true` covers deletes in Firestore rules. This is not tidiness: the material is clinical and it is sitting in Excalidraw's own Firebase project. **The ordering is absolute.** `persisted: true` means the bytes are in S3 (`backend.md` §3.3 rule 5); deleting on anything weaker — an ack with `persisted: false`, a timeout, an optimistic assumption — destroys the only other copy of a whiteboard that exists nowhere else at that moment.

4. **Restore before broadcasting.** Old scenes may predate element-schema changes, which is exactly why `loadFromFirebase` ran `restoreElements` with `deleteInvisibleElements: true` before handing them over. Reuse it. Skipping it migrates elements today's client can no longer draw, and does so irreversibly once point 3 fires.

5. **Emit two counters.** One per whiteboard migrated, one per legacy 404. They cost a line each and they are the only way to know when this path has gone idle — Firestore's `allow list: if false` means nothing can be counted from the other end. Without them the decision to remove this module has no leading indicator at all (`unobravo/decommission-firestore.md` §3).

### Tests

- A room with a Firestore document and no relay snapshot: the elements reach the canvas, the images are inlined, and a frame with `meta.complete: true` goes out.
- A room with neither: an empty board, no error.
- Firestore unreachable or timing out: an empty board, one surfaced error, and **no delete**.
- The delete does not fire on an ack carrying `persisted: false`.

### When it comes out

The module is disposable by construction, and point 3 makes its own obsolescence observable. **`unobravo/decommission-firestore.md` is the plan for taking it out** — including why "enough time has passed" is not the gate, and what a final sweep over the parent application's room table has to do first.

## 10. Verification

Beyond `yarn test:update`, `yarn test:typecheck` and `yarn fork:check`, the end-to-end checks that matter, against a relay that meets section 2:

1. Open a `#room=` link on an empty room: the board is blank, and it is blank _immediately_, not after five seconds.
2. Draw, wait for a complete frame, reload: the board comes back with its images.
3. Draw, close the tab straight away: the guard fires, and the drawing is there on reopen.
4. Two browsers in one room: strokes and images both propagate live.
5. Insert several photographs, force a full sync, and confirm the frame arrives — this is the `maxHttpBufferSize` check, and its failure mode is silence.
6. Open a room that exists in Firestore and not on the relay: the board and its images appear, and a second reload serves it from the relay with the Firestore document gone.
7. Grep the bundle for `firebase`: nothing.
