import type { ImageOptions } from "@excalidraw/excalidraw/types";

/**
 * What an inserted image is allowed to weigh.
 *
 * Image bytes travel inside the scene broadcast as base64 dataURLs, so the
 * socket frame is the constraint: past the relay's `maxHttpBufferSize` the
 * frame is dropped and the socket torn down with no error to catch. Base64
 * inflates the bytes by ~33%, and a complete frame carries every image on the
 * board — so one image has to stay a small fraction of the frame budget
 * (`RELAY_MAX_FRAME_BYTES` in `unobravo/collab/relayPersistence.ts`).
 *
 * Upstream's defaults are 1440px and a 4 MiB ceiling, and the ceiling only
 * *rejects* — nothing re-encodes a 1440px PNG screenshot that weighs 3 MB:
 *
 * - `outputType: "image/jpeg"` re-encodes on insert, which is what actually
 *   bounds the bytes. It also strips the metadata the source carried (a phone
 *   photo's GPS coordinates included).
 * - `maxFileSizeBytes` is the hard stop *after* the resize, so the user gets a
 *   clear refusal rather than a frame that silently never arrives.
 *
 * The trade is lossy re-encoding for every insert: a PNG with an alpha channel
 * comes out on a white background. Acceptable for a clinical whiteboard, where
 * images are photographs and scans of documents.
 */
export const UNOBRAVO_IMAGE_OPTIONS: ImageOptions = {
  /** a document photographed at 1600px stays readable when zoomed */
  maxWidthOrHeight: 1600,
  /** post-resize hard stop: ~1.37 MB once base64'd into the frame */
  maxFileSizeBytes: 1024 * 1024,
  outputType: "image/jpeg",
};
