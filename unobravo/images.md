# Image compression

How an image inserted on the whiteboard is shrunk before it reaches anyone else, why it is done this way, and what to look at when it goes wrong. Ticket: [MIL-2825](https://unobravo.atlassian.net/browse/MIL-2825).

The code: `unobravo/images/compressImage.ts` (the ladder and its browser primitives), `unobravo/images/reportImageIssue.ts` (Sentry), `unobravo/config/imageOptions.ts` (the numbers). The upstream side is one optional hook, `imageOptions.processImageFile`, registered in `unobravo/FORK.md`.

---

## 1. Why

**Every image is stored once per snapshot, and every snapshot carries every image.** There is no separate image upload. An image's bytes travel as a base64 dataURL inside the scene broadcast (`unobravo/frontend.md`), and the relay writes the whole encrypted scene to S3 as `rooms/{roomId}/scene.bin` (`unobravo/backend.md`). A 3 MB photo on a board is 4 MB in every snapshot of that board, forever.

**Only the client can compress.** The scene is end-to-end encrypted with the room key, which the relay never holds. Encrypted bytes don't compress, and the relay can't see which bytes are images. So it happens on insert, in the browser, before the image enters the scene.

**Photos carry metadata.** A phone photo has EXIF, GPS coordinates included. On a clinical whiteboard that is the patient's or the therapist's location. It has to be gone before the image is stored anywhere.

**What #44 left.** The first version (1600px, re-encode to JPEG at 0.8, refuse over 1 MiB) relied on upstream's `resizeImageFile`, which:

- returns a JPEG untouched when it already fits within 1600px — so a 1.7 MB JPEG was refused instead of compressed, and kept its EXIF;
- re-attaches the original JPEG segments when it does resize (that is `image-blob-reduce`'s behaviour) — so GPS survived on resized photos too;
- encodes the canvas to JPEG with its alpha channel — so a transparent PNG came out on **black**;
- has one fixed quality and no size target.

## 2. The path an image takes

```
 drop / paste / image tool / pasted URL
                 │
                 ▼
  App.initializeImage                       packages/excalidraw/components/App.tsx
   ├─ normalizeSVG (SVG only)
   ├─ fileId = SHA-1 of the ORIGINAL bytes  ← before compression: the same photo
   │                                          inserted twice dedupes
   ├─ already loaded? → reuse, skip everything below
   │
   ├─ imageOptions.processImageFile(file, { maxWidthOrHeight, maxFileSizeBytes, outputType })
   │     = createImageCompressor(browserCompressorDeps, IMAGE_COMPRESSION_LADDER)
   │       └─ the ladder, section 3                   unobravo/images/compressImage.ts
   │
   ├─ size > maxFileSizeBytes (1 MiB)? → "file too big", insert refused
   └─ getDataURL → this.files[fileId] = { dataURL, mimeType = file.type }
                 │
                 ▼
  Portal.broadcastScene → encrypt → socket → relay → Redis → S3 rooms/{roomId}/scene.bin
```

Every way of inserting an image goes through `initializeImage`. The ways that don't are listed in section 6.

## 3. The ladder

`createImageCompressor` gets the file the user inserted and returns the file to store. It never throws.

**1. SVG** is returned as it is. It's vector and has already been cleaned by upstream's `normalizeSVG`.

**2. Steps.** The long-edge steps are `[1600, 1280, 1024]`, each capped at `maxWidthOrHeight` and deduplicated (`maxWidthOrHeight: 800` gives one step, `[800]`). For each step:

1. `resize` — upstream's pica helper, run **from the original file** every time, never from the previous step's output. It keeps the source format and its alpha.
2. `decode` — `createImageBitmap(..., { imageOrientation: "from-image" })`, so a portrait phone photo stays upright.
3. If the decoded long edge is the same as the previous step's (the source was smaller than the step), skip: same pixels, same results.
4. `hasAlpha` — **once**, on the first step, and only for formats that can carry alpha (PNG, WebP, GIF, AVIF, ICO, BMP; never JPEG/JFIF). It reads every pixel and returns true at the first alpha below 255.
5. `encode` each attempt through `canvas.toBlob`, and stop at the **first one ≤ 500 KB**:

|                            | Opaque → JPEG, on white    | Transparent → PNG |
| -------------------------- | -------------------------- | ----------------- |
| first step (1600px)        | quality 0.8, 0.7, 0.6, 0.5 | one PNG           |
| later steps (1280, 1024px) | quality 0.7, 0.5           | one PNG           |
| attempts at most           | 8                          | 3                 |

**3. Nothing fits.** If no attempt reaches 500 KB, the **smallest** encoding is kept, which is not necessarily the last one: encoders can get bigger at lower quality on noisy images. If it's still over 1 MiB, `initializeImage` refuses it.

**4. Transparent images that don't fit.** If even the smallest PNG is over 1 MiB, the whole JPEG ladder runs again on white. Its result is used only if it's smaller than the PNG.

**5. Encoder output check.** Every encoder result is checked: it must be PNG or JPEG. Anything else (an empty type, WebP, …) counts as a failure, because that type would be stored as the image's `mimeType`. The stored `File` is typed from what the encoder produced, never from what was asked for.

The output always comes out of `canvas.toBlob`. That is what strips EXIF, GPS and PNG text chunks: a canvas has pixels and nothing else.

### When something throws

```
any step throws ──► report compression-failed (with the stage) ──► fallback:
                    resizeImageFile(file, { maxWidthOrHeight, outputType: "image/jpeg" })
                    (the #44 behaviour)
                         │
                         └─ throws too ──► report fallback-failed ──► return the ORIGINAL file
```

**The original file goes on, metadata and all.** That is what `initializeImage` did before the hook existed, and it was chosen on purpose: refusing the insert would block the user for a failure they can do nothing about. The `fallback-failed` event is how we find out it happened. Returning the file ourselves, rather than throwing, also keeps `initializeImage`'s own `console.error` from firing a second, untagged Sentry event.

### The numbers

| Setting | Value | Where | Pinned by |
| --- | --- | --- | --- |
| Long-edge steps | 1600, 1280, 1024 | `IMAGE_COMPRESSION_LADDER.edges` | `imageBudget.test.ts` (never below 1024) |
| JPEG qualities, first step | 0.8, 0.7, 0.6, 0.5 | `.firstEdgeQualities` | `compressImage.test.ts` |
| JPEG qualities, later steps | 0.7, 0.5 | `.laterEdgeQualities` | `compressImage.test.ts` |
| Soft target | 500 KB | `.softTargetBytes` | `imageBudget.test.ts` (≤ hard stop) |
| Slow threshold | 5 s | `.slowMs` | `imageBudget.test.ts` |
| Hard stop | 1 MiB | `UNOBRAVO_IMAGE_OPTIONS.maxFileSizeBytes` | `imageBudget.test.ts` (10 worst-case images fit a relay frame) |
| Long edge before compression | 1600px | `.maxWidthOrHeight` | `imageBudget.test.ts` |

## 4. Decisions, and why

- **Always re-encode, even an image that already fits.** It is the only thing that guarantees EXIF and GPS are gone. The cost is a small quality loss on images that were already small.
- **Transparency is decided from the pixels, not the format.** Most PNGs are opaque screenshots; those become JPEG (a screenshot went from 446 KB to 210 KB). Only an image with at least one transparent pixel stays PNG. A single pixel at alpha 254 is enough, which is correct but heavier.
- **Transparent and too big → JPEG on white, not refused.** `master` accepted those images as JPEG on black, so refusing them would have been a regression. White is what a whiteboard is.
- **Never below 1024px.** Below that, a photographed document stops being readable when zoomed.
- **Quality first, then pixels.** Fewer pixels hurt readability more than JPEG at 0.6 does.
- **GIFs lose their animation**, as they did before: the canvas holds one frame.
- **Homemade, not a package.** The heavy work is already done by pica (an upstream dependency) and the browser's encoder. What is ours is the policy: always strip, decide alpha from pixels, the 1024 floor, the hard-stop fallback, the stage reported to Sentry. A package (`browser-image-compression` was considered) would have its own policy, and every rule above would still need a test to hold it to ours.

## 5. Sentry

Every event is tagged `imageIssue`. Filter on `imageIssue:*` to see them all, or on a single value.

| `imageIssue` | Level | When | What it means / what to do |
| --- | --- | --- | --- |
| `compression-failed` | error (exception) | a ladder step threw | The fallback was used. Look at the `imageStage` tag: `decode` is often a format the browser can't open, `encode` a canvas or memory limit. One event per insert. |
| `fallback-failed` | error (exception) | the fallback threw too | **The original file was stored, metadata included.** Always follows a `compression-failed` from the same insert. Rare. If it isn't, it needs looking at. |
| `over-hard-stop` | warning | the best encoding is still over 1 MiB | The user saw "file too big". Frequent events mean the hard stop or the ladder needs revisiting. |
| `transparency-dropped` | warning | a transparent image only fit as JPEG on white | Expected now and then: a large detailed logo, a scanned page with an alpha channel. |
| `unexpected-encoder-type` | warning | `canvas.toBlob` produced a type other than the one asked for | A browser that can't encode the requested type. Reported once per insert. If the type isn't PNG or JPEG, it is also a `compression-failed`. |
| `slow-compression` | warning | the ladder took over 5 s | A slow device or a pathological image. The insert worked, the user waited. |

**What an event carries** (`extra`): `inputType`, `inputBytes`, `outputType`, `outputBytes`, `width`, `height`, `attempts`, `durationMs`, `stage`, and `requestedType` for `unexpected-encoder-type`.

**What it never carries: the file name.** On a clinical whiteboard a file name can be "Mario Rossi - referto.jpg". `ImageIssueContext` has no field for it, and `compressImage.test.ts` checks that no report contains it.

**Never `console.error`.** `excalidraw-app/sentry.ts` enables `captureConsoleIntegration` for errors, so a `console.error` here would be a second, untagged event. Local logging uses `console.warn`, including when Sentry itself throws (`reportImageIssue` never lets that break an insert).

There are no events for successful compressions, which would cost Sentry quota on every insert.

## 6. Out of scope

These paths store image bytes without going through `initializeImage`, so nothing here compresses them:

- boards migrated from Firestore (`unobravo/collab/legacyScene.ts` → `addFiles`);
- opening or dropping an `.excalidraw` file, or a PNG/SVG with a scene embedded;
- pasting copied Excalidraw elements that carry their own files;
- images received from collaborators, which the sender's client has already compressed.

## 7. Testing it

**Automated** — jsdom has no image codec, so the primitives are faked or recorded:

- `unobravo/tests/compressImage.test.ts` — the ladder: every step and its order, every MIME type, the alpha paths, failures and fallback, every Sentry issue, no file name in any report.
- `unobravo/tests/compressorBrowserDeps.test.ts` — the browser primitives: white under JPEG only, alpha read from pixels, orientation on decode, `toBlob` arguments and failures.
- `unobravo/tests/reportImageIssue.test.ts` — exceptions and warnings, their tags, Sentry failing silently.
- `unobravo/tests/processImageFile.test.tsx` — the hook inside `<Excalidraw>`: it replaces `resizeImageFile`, the hard stop still applies, a throwing hook inserts the original, a replaced hook is picked up.
- `unobravo/tests/imageBudget.test.ts` — the numbers above.

```bash
yarn vitest run unobravo/tests/compressImage.test.ts unobravo/tests/compressorBrowserDeps.test.ts \
  unobravo/tests/reportImageIssue.test.ts unobravo/tests/processImageFile.test.tsx unobravo/tests/imageBudget.test.ts
```

**By hand**, in a real browser:

1. Run `yarn start` and open http://localhost:3001.
2. Drop some images onto the board: a phone photo with GPS on, a large JPEG under 1600px, a transparent PNG, a screenshot, a GIF.
3. In the DevTools console:

```js
Object.values(h.app.files).map((f) => {
  const bin = atob(f.dataURL.split(",")[1]);
  return {
    type: f.mimeType,
    KB: Math.round(bin.length / 1024),
    exif: bin.includes("Exif"),
  };
});
```

To compare with the behaviour without the hook, run `delete h.app.props.imageOptions.processImageFile` before dropping. A reload brings the hook back.

**Measured** in headless Chrome on synthetic images (PR #46). Sizes vary a little between runs.

| Image | Before | After |
| --- | --- | --- |
| photo 4000×3000, 7.3 MB, EXIF/GPS | JPEG 448 KB, EXIF + GPS kept | JPEG 411 KB, stripped |
| JPEG 1500px, 1.7 MB | refused | JPEG 435 KB |
| transparent PNG logo | JPEG on black | PNG 29 KB, alpha kept |
| screenshot PNG 1920×1080 | JPEG 210 KB | JPEG 211 KB |
| transparent noise PNG 3000px | JPEG 878 KB on black | JPEG 474 KB on white (~2.1 s) |

## 8. Changing the numbers

The numbers live in `unobravo/config/imageOptions.ts`. Change them there, then update the assertion in `unobravo/tests/imageBudget.test.ts` that pins each one; that test is meant to fail until the change is deliberate.

- **Raising `maxFileSizeBytes`:** check it against `RELAY_MAX_FRAME_BYTES` first. A complete frame carries every image on the board.
- **Changing the steps or qualities:** the expected attempt sequences in `compressImage.test.ts` change too.
