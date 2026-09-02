# DEMO(MIL-2679) — can the image bytes ride inside the scene?

Branch `demo/inline-collab-image-files`. Not for merge: it answers one question BE asked before MIL-2548 gets designed — _can we drop the Firestore/S3 file round trip and use the base64 dataURL that is already in the Excalidraw state?_

Answer: **yes, with one hard condition.** The bytes survive the relay untouched, but socket.io's default 1 MB payload ceiling is well under what a single photo weighs, and today the relay does not raise it.

## What changed in the app

| File | Change |
| --- | --- |
| `excalidraw-app/collab/Portal.tsx` | `broadcastScene` attaches the dataURLs of the image elements it is syncing |
| `excalidraw-app/data/index.ts` | `SCENE_INIT`/`SCENE_UPDATE` payloads gain `files?: BinaryFiles` |
| `excalidraw-app/collab/Collab.tsx` | `FileManager` stops reaching Firebase Storage; incoming payload files go straight to `addFiles` |

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
