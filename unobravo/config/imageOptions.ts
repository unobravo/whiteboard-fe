import type { ImageOptions } from "@excalidraw/excalidraw/types";

/**
 * What an inserted image is allowed to weigh.
 *
 * DEMO(MIL-2679): with the image bytes travelling inside the scene broadcast
 * instead of a file store, the socket frame is the constraint. socket.io caps
 * a payload at `maxHttpBufferSize`, **1 MB by default**, and the relay does
 * not raise it today — past the cap the broadcast never reaches the server,
 * the acknowledgement never fires and the socket is torn down, so the drawing
 * is lost with no error to catch. Base64 inflates the bytes by ~33% before
 * they hit that cap, so the budget is roughly `maxHttpBufferSize / 1.37`
 * minus the rest of the scene.
 *
 * Upstream's defaults are 1440px and a 4 MiB ceiling, and the ceiling only
 * *rejects* — nothing re-encodes a 1440px PNG screenshot that happens to weigh
 * 3 MB. Two changes make the frame predictable:
 *
 * - `outputType: "image/jpeg"` re-encodes on insert, which is what actually
 *   bounds the bytes. It also strips every metadata block the source carried
 *   (a phone photo's GPS coordinates included) — the same disarming the
 *   monolith's shared-files pipeline does server-side, here for free.
 * - `maxFileSizeBytes` is the hard stop *after* the resize, so it is a real
 *   ceiling rather than an input check, and the user gets a clear refusal.
 *
 * The trade is lossy re-encoding for every insert, transparency included: a
 * PNG with an alpha channel comes out on a white background. Acceptable for a
 * clinical whiteboard, where images are photographs and screenshots of
 * documents; revisit if someone pastes UI mockups with transparency.
 *
 * The numbers are deliberately not derived from a constant in the relay: it
 * has no endpoint that reports its buffer size, so a mismatch has to be caught
 * by the measurement in `unobravo/dev/README.md`, not by a type.
 */
export const UNOBRAVO_IMAGE_OPTIONS: ImageOptions = {
  /**
   * A document photographed at 1600px on its long edge stays readable when
   * zoomed, and re-encodes to ~200-500 KB — a 270-680 KB frame, inside the
   * 1 MB default with the rest of the scene to spare.
   */
  maxWidthOrHeight: 1600,
  /**
   * Post-resize hard stop. 1 MiB of JPEG at 1600px is a photograph of
   * unusually high entropy; it becomes a ~1.37 MB frame, which needs the relay
   * buffer at >= 2 MB. Until that lands this is the tail case to watch, not a
   * limit users will meet — see the measured sizes in `unobravo/dev/README.md`.
   */
  maxFileSizeBytes: 1024 * 1024,
  outputType: "image/jpeg",
};
