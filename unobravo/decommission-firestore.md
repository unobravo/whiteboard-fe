# Decommissioning Firestore — the closing plan

The last step of the work described in `unobravo/backend.md` and `unobravo/frontend.md`: removing the migration path that reads the old whiteboards out of Firestore, once there are none left to read.

Run this after the transition period, not during it. Section 3 says how to know the difference, and the answer is not "enough time has passed".

---

## 1. What this actually removes

**The `firebase` npm dependency is already gone by the time you read this.** It leaves in step 7 of `frontend.md` §4, with the main change, because the migration never needed the SDK — both legacy reads are plain `fetch` calls against public URLs (`frontend.md` §9).

**And the file is deliberately not called `remove-firebase.md`.** Firebase does not leave: the relay's authentication depends on a Firebase ID token and always will (§2). What leaves is Firestore and Firebase Storage — Excalidraw's two projects, used as a scene database. Naming the document after the wrong noun is how the §2 mistake gets made.

What is left to remove is:

| What | Where |
| --- | --- |
| The lazy migration module | `unobravo/collab/legacyScene.ts` |
| The branch that calls it | `excalidraw-app/collab/Collab.tsx`, the `null` ack of `request-scene` |
| Its two constants | the Firebase project id and storage bucket, inside that module |
| Its tests | `unobravo/tests/` (the four cases in `frontend.md` §9) |
| The documentation of both | `frontend.md` §9, `backend.md` §7, `FORK.md` |

Roughly one module and one branch. The work is small; knowing _when_ it is safe is the whole job.

## 2. Do not remove: the relay authentication token

**Read this before grepping for "firebase".**

The relay rejects any handshake that does not carry a **Firebase ID token**, issued by the `uno-bravo-dev` project, in `auth.token` (`unobravo/collab/relayAuth.ts`, `unobravo/url.md`). That is Unobravo's own Firebase project and has nothing to do with `excalidraw-room-persistence` or `excalidraw-oss-dev`, which are Excalidraw's and are what this plan decommissions.

A `grep -ri firebase` and a confident delete pass breaks authentication entirely. The references that **must survive**:

- `unobravo/collab/relayAuth.ts` — reads the token from the query string. Load-bearing.
- `unobravo/observability/scrubSentryEvent.ts` — redacts that token out of Sentry events. Removing it leaks a credential into error reports.
- `unobravo/url.md` — the spec the parent application builds its URL against.

None of these touch Firestore or Firebase Storage. They are about a JWT the whiteboard is handed and forwards, and the whiteboard has no Firebase SDK with which to mint or refresh one.

## 3. When: sweep, do not wait

The migration deletes each Firestore document once the relay acks `persisted: true` (`frontend.md` §9, point 3), so the collection drains on its own. The problem is proving it has drained: the rules are `allow list: if false`, so **Firestore cannot be enumerated**. There is no query that answers "is it empty".

There are three ways to reason about it, and only the third is a gate.

**A leading indicator — telemetry.** The migration module should emit two counters: one per whiteboard migrated, one per legacy 404. When the first goes to zero and stays there for a few weeks, the lazy path is idle. This tells you when to start, not when to stop, and it depends on those counters existing — if §9 shipped without them, this indicator does not exist and you are down to the gate below.

**Not a gate — elapsed time.** "Every old board has surely been opened by now" is unknowable. A whiteboard belongs to a patient-doctor pair that may not meet for months, and the cost of being wrong is a board that is deleted and unrecoverable.

**The gate — sweep the remainder yourself.** The parent application holds the `(roomId, roomKey)` table for every whiteboard ever created. That is the list Firestore refuses to give you, and it turns the question from "has everything been opened?" into "have I processed every row?", which is answerable.

So the transition does not end when the traffic stops. It ends when you run section 4 and it reports zero remaining.

## 4. The sweep

A one-off Node script, run once, against the rows in the parent application's room table created before the cutover. It is the same pipeline as `legacyScene.ts` with no browser.

**The crypto is portable.** The room key is the `k` field of a JWK `A128GCM` key (`packages/excalidraw/data/encryption.ts`, `ENCRYPTION_KEY_BITS = 128`), and Node 18+ ships the same `crypto.subtle`. `importKey("jwk", { alg: "A128GCM", kty: "oct", k: roomKey, … })` behaves identically to the browser.

Per row:

```
1.  HEAD  s3://…/rooms/{roomId}/scene.bin
      exists -> the relay already owns a board here. SKIP the write, and do
                NOT delete: a Firestore document that survived the lazy
                migration means it never completed — the load failed and the
                user drew over an empty board, or no `persisted: true` ack
                came back. Report the row for manual review instead.

2.  GET   https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/scenes/{roomId}
      404 -> nothing here, nothing to do. Next row.

3.  decrypt(iv, ciphertext, roomKey)            -> elements[]
      (both fields arrive base64-encoded in the REST response's bytesValue)

4.  for each image element:
      GET https://firebasestorage.googleapis.com/v0/b/{bucket}/o/files%2Frooms%2F{roomId}%2F{fileId}?alt=media
      decompressData(roomKey)                   -> dataURL + mimeType

5.  encrypt(roomKey, JSON.stringify({ type: "SCENE_INIT", payload: { elements, files } }))
    PUT  s3://…/rooms/{roomId}/scene.bin
         metadata { version: 1, sceneVersion, iv, updatedAt }
    read it back and compare bytes

6.  record: migrated | already-present | absent | failed(reason)
```

Nothing is deleted here. Deleting is a separate pass, below.

Four things the sketch does not say:

- **Step 1 is not an optimisation, it is correctness.** If someone opened and drew on that whiteboard after the lazy migration ran, S3 holds a scene newer than Firestore's. Writing over it silently reverts their work. Check first, always.
- **Write straight to S3, not through the relay.** The relay reads S3 on a Redis miss (`backend.md` §5), so the board is live on the next open with no socket, no per-room auth token, and no `maxHttpBufferSize` ceiling to worry about. Going through the relay as a socket client also works and exercises the real path, but it needs a valid token for every room and buys nothing here.
- **`restoreElements` is optional in the sweep.** Every client runs it on receive, inside `_reconcileElements`, so a scene written raw is restored when it is read. Include it if the script can import it from the monorepo cleanly; do not spend a day making that import work.
- **The report is the deliverable**, not the migration. Keep it, with a row per whiteboard. It is the evidence section 3 asks for, and the only record of what was deleted.

### Three passes, and only the third is irreversible

The sweep runs as three separate invocations, because that is what keeps every destructive step out of the migration itself.

| Pass | What it does | What proves it worked |
| --- | --- | --- |
| **1 — migrate** | steps 1 to 6 above | a report with a row per whiteboard |
| **2 — verify** | the same thing again, unchanged | every row reports `absent` or `already-present`, **nothing** reports `migrated` |
| **3 — delete** | for each row pass 1 recorded as `migrated` or `already-present`, delete the Firestore document and the Storage objects | the same probe returns 404 for every row |

Pass 2 is the gate of section 3: a clean second run means the lazy path and the sweep between them have reached everything the parent application knows about.

**Leave a gap between pass 2 and pass 3** — a few weeks is plenty. In that window Firestore is a cold backup of every whiteboard that was just written to S3, costing nothing and worth having the first time somebody reports a board that does not look right. Running pass 3 immediately after pass 2 works and is faster; it also throws away the only safety net at the exact moment it is most useful.

## 5. The removal

Once the sweep reports clean:

1. **Delete `unobravo/collab/legacyScene.ts`** and its tests. Owned directory, no `FORK.md` row, nothing else imports it.
2. **Delete the branch in `Collab.tsx`.** The `null` ack of `request-scene` goes back to meaning exactly what `backend.md` §3.3 rule 6 says it means: a new, empty whiteboard. This is the only upstream file touched, and the diff is smaller after than before, so its `FORK.md` row shrinks rather than appears.
3. **Update the documents.** `frontend.md` §9 and `backend.md` §7 become a sentence in the past tense with the sweep's date — do not delete them outright, because "why is there no Firestore fallback?" is a question someone will ask in a year. `FORK.md`'s known-gaps section loses the Firebase entry it has carried since `FORK.md:127`.
4. **Check `unobravo/arch/ARCHITECTURE.md`**, which still describes the Firebase persistence layer.

## 6. What deliberately stays

- **Everything in section 2.** The relay auth token is not this.
- **`FIREBASE_STORAGE_PREFIXES` in `excalidraw-app/app_constants.ts`.** It becomes unused when the main change lands, and it is tempting to delete. Do not: it is an upstream constant in an upstream file, so removing it buys a `FORK.md` row and a permanent conflict surface in exchange for deleting six dead lines. Upstream can keep it.

## 7. What an upstream sync will bring back

The fork **deletes** `excalidraw-app/data/firebase.ts` and `excalidraw-app/components/ExportToExcalidrawPlus.tsx`. Deleted files are the loudest thing in a merge and the easiest to resolve wrongly: when upstream modifies a file the fork deleted, git raises a modify/delete conflict, and accepting "theirs" restores a module that imports a dependency the fork no longer has. The build breaks immediately, which is the good case.

The bad case is quieter: upstream adds a _new_ call site for Firebase persistence in a file the fork keeps — `Collab.tsx` and `data/index.ts` are the likely ones — and the merge resolves cleanly with a broken import or, worse, a working one if the dependency ever comes back for another reason.

So: both deletions stay registered in `FORK.md` with their reason, and the upstream-sync skill treats a reappearing `firebase` import the same way it treats a dropped gate. A `grep -rn "firebase/" --include="*.ts" --include="*.tsx" excalidraw-app/ packages/` that returns anything after a sync is a regression, not a merge artefact.

## 8. Verification

1. The sweep's second run reports zero `migrated`.
2. `grep -rn "firestore\|firebasestorage\|firebase/" --include="*.ts" --include="*.tsx" excalidraw-app/ packages/ unobravo/` returns nothing.
3. `grep -rn "firebase" excalidraw-app/package.json .env.production .env.development` returns nothing.
4. The relay handshake still authenticates — `relayHandshake.test.tsx` passes, and a real session against staging connects. **This is the check that catches an over-eager removal of section 2**, and it is worth doing by hand rather than trusting the suite.
5. `yarn test:update`, `yarn test:typecheck`, `yarn fork:check`.
6. Open an old whiteboard end to end: it loads from the relay, with its images, and no request leaves for a Google domain. Watch the network tab, not the logs.

## 9. The point of no return

Pass 3 of the sweep — and nothing before it — deletes the Firestore documents and the Storage objects. After that, the only copy of those whiteboards is in S3, and any row missing from the parent application's table was never migrated and is now unreachable: the data is still in Firestore only if the sweep never saw it, and `allow list: if false` means nothing can find it again.

The lazy migration in `frontend.md` §9 does delete per whiteboard, as it goes, on an ack of `persisted: true`. That is a different risk and a much smaller one — it deletes one board, immediately after the relay confirmed the S3 write, with a client holding the decrypted scene in memory. The sweep's pass 3 deletes in bulk, long after the fact, on the strength of a report. Hence the separation.

Two consequences worth accepting deliberately before running it:

- **The parent application's room table is the index of record.** If it is incomplete, the sweep is incomplete, and neither the script nor Firestore can tell you so. Confirm its completeness before, not after.
- **Verify the S3 write before the delete, per whiteboard.** Step 5 reads the object back for exactly this reason, and pass 3 only ever deletes rows pass 1 recorded as written. A sweep that deletes on the assumption that a PUT succeeded is one transient error away from losing clinical material.

Both are the reason the sweep is three passes rather than one. Do not collapse them back into a single run to save an afternoon.
