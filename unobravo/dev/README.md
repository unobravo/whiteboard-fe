# DEMO(MIL-2679) — can the image bytes ride inside the scene?

Branch `demo/inline-collab-image-files`. Not for merge: it answers one question BE asked before MIL-2548 gets designed — _can we drop the Firestore/S3 file round trip and use the base64 dataURL that is already in the Excalidraw state?_

Answer: **yes, with one hard condition.** The bytes survive the relay untouched, but socket.io's default 1 MB payload ceiling is well under what a single photo weighs, and today the relay does not raise it.

## What changed in the app

| File | Change |
| --- | --- |
| `excalidraw-app/collab/Portal.tsx` | `broadcastScene` attaches the dataURLs of the image elements it is syncing; `_broadcastSocketData` records payload sizes in dev |
| `excalidraw-app/data/index.ts` | `SCENE_INIT`/`SCENE_UPDATE` payloads gain `files?: BinaryFiles` |
| `excalidraw-app/collab/Collab.tsx` | `FileManager` stops reaching Firebase Storage; incoming payload files go straight to `addFiles` |
| `packages/excalidraw` (types, index, App) | `imageOptions` gains `outputType`, so a host can ask for re-encoding on insert — upstream-shaped, PR-able as-is |
| `unobravo/config/imageOptions.ts` | our values: 1600px long edge, JPEG re-encode, 1 MiB post-resize ceiling |
| `unobravo/dev/wireStats.ts` | `__wireStats()` in the browser console: per-broadcast sizes, what share is images, how many frames would exceed 1 MB |

## Making it fit the relay we already have

The 1 MB ceiling is only a blocker because Excalidraw inserts images at their original resolution — upstream caps _dimensions_ at 1440px and only **rejects** above 4 MiB, so a 1440px PNG screenshot weighing 3 MB sails through the resize untouched and then blows the frame.

`outputType: "image/jpeg"` is the missing lever: it re-encodes on insert, which is what actually bounds the bytes. A document photographed at 1600px lands at ~200-500 KB, i.e. a 270-680 KB frame — **inside socket.io's default, so the demo runs against the real staging relay with no BE change at all.**

Two side effects worth naming. Re-encoding through a canvas strips every metadata block the source carried, a phone photo's GPS coordinates included — the same disarming the monolith's shared-files pipeline does server-side, here for free. And it is lossy: a PNG with transparency comes out on white. Fine for photographs and scans of documents, which is what a clinical board carries.

The tail case is unresolved on purpose: 1 MiB of post-resize JPEG is a ~1.37 MB frame and still needs the relay buffer at >= 2 MB. `unobravo/tests/imageBudget.test.ts` asserts exactly that, so the day the buffer is raised, the failing expectation is the reminder to revisit the cap.

## Getting numbers instead of guesses

Draw a realistic board — a handful of images, a few hundred elements — then in the console:

```js
__wireStats(); // summary: median / p95 / largest frame, image share,
// frames over 1 MB, and the last reliable broadcast
// (which is exactly what the relay stores as the snapshot)
__wireStats.rows; // every broadcast, in order
```

`lastReliable` is the interesting one: watch it drop to a few hundred bytes mid-drawing. That is finding #1 from the ticket, visible live — the relay's snapshot is usually a delta, and a flush to S3 at that moment would persist a partial board.

Scene persistence is untouched — this branch only removes the **image** round trip. Firestore still holds the scene, which is the point made in MIL-2679: the scene still needs a durable home somewhere.

## Measured, not argued

`unobravo/dev/inline-files-roundtrip.mjs` runs two real socket.io clients against `relay-stub.mjs` with the payload shape the app emits:

```
--- 1. wire size
image bytes        2.00 MiB
base64 dataURL     2.67 MiB
JSON scene on wire 2.67 MiB  (2796479 bytes)
socket.io default  1.00 MiB -> EXCEEDED, socket would be closed

--- 2. live fan-out (A -> B, both in room)
B received         2.67 MiB (v1, ack v1)
bytes intact       yes

--- 3. snapshot replay (C joins alone, after A and B leave)
C received         2.67 MiB (v1)
dataURL identical  yes
```

So: base64 costs **+33%**, a 2 MiB image is a 2.67 MiB frame, and both the live fan-out and the late-joiner snapshot replay carry it byte-identical.

Re-running the same script against a stub started with `MAX_BUFFER=1048576` (socket.io's default, which is what the real relay runs today) shows the failure mode: the relay logs **no** `server-broadcast` at all, the sender's ack callback never fires, and the socket is torn down. From the app's point of view the drawing is simply lost, with no error to catch.

## Run it locally

The staging relay refuses a handshake without a Firebase ID token and caps payloads at 1 MB, so the demo runs against a local stub that speaks the same events.

```bash
# 1. socket.io server (not a repo dependency — install it out of tree)
SCRATCH=$(mktemp -d)
npm --prefix "$SCRATCH" install socket.io@4
ln -s "$SCRATCH/node_modules/socket.io" node_modules/socket.io   # plus its deps

# 2. the stub relay, with the ceiling raised
node unobravo/dev/relay-stub.mjs                 # :3002, 25 MiB buffer
PORT=3003 MAX_BUFFER=1048576 node unobravo/dev/relay-stub.mjs   # the ceiling

# 3. the round trip
node unobravo/dev/inline-files-roundtrip.mjs 2   # image size in MiB
RELAY=http://localhost:3003 node unobravo/dev/inline-files-roundtrip.mjs 2

# 4. the app against the stub — put this in .env.development.local (gitignored)
#    VITE_APP_WS_SERVER_URL=http://localhost:3002
yarn start                                       # then open :3001/?authToken=demo
```

Two browser windows on the same `#room=` link: paste an image in one, it appears in the other with no file store in the loop. Reload the window that is alone in the room and the snapshot replay brings the image back.

## What this does not settle

- **A cap is now a product decision.** Whatever the relay's buffer is set to divides by ~1.37 into the largest image a user may paste. Excalidraw's own limit is 4 MiB (`FILE_UPLOAD_MAX_BYTES`), which needs a ~5.5 MiB buffer.
- **Snapshot size.** The relay stores the last broadcast per room, so the snapshot now includes every image in the scene — in Redis today (MIL-2605), in S3 later (MIL-2548), replayed in full to every joiner.
- **Full-scene guarantee.** Unchanged and still open (MIL-2679 comment, gap 3a): the stored snapshot is the last broadcast, which is usually a delta. Inlining images makes a delta snapshot worse, not better — it can now be a delta that also lacks the image bytes of everything it does not mention.
- **Durability.** Dropping the image round trip does not remove the need for a durable scene store. It reduces S3's job from "scene + N image objects" to "one object per room".
- **`unobravo/tests/inlineImageFiles.test.ts`** pins the sender side (payload carries the referenced files, a delta stays a delta, no `files` key when the scene has no images).
