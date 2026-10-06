import type { ImageOptions } from "@excalidraw/excalidraw/types";

import {
  browserCompressorDeps,
  createImageCompressor,
} from "../images/compressImage";

import type { CompressionLadder } from "../images/compressImage";

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
 * *rejects* — nothing re-encodes a 1440px PNG screenshot that weighs 3 MB.
 * `processImageFile` does (MIL-2825, `unobravo/images/compressImage.ts`):
 *
 * - every opaque image is re-encoded to JPEG, even one that already fits, so
 *   the metadata the source carried (a phone photo's GPS coordinates
 *   included) never reaches the board;
 * - quality steps down, then pixels, until the image fits
 *   `IMAGE_COMPRESSION_LADDER.softTargetBytes` — every snapshot the relay
 *   writes to S3 carries every image on the board, so this is what keeps the
 *   bucket small;
 * - an image with any transparent pixel stays PNG (a logo, a signature) and
 *   only loses pixels; only if no PNG fits under `maxFileSizeBytes` does it
 *   fall back to JPEG on white, which beats refusing it.
 *
 * `maxFileSizeBytes` stays the hard stop *after* all of that, so the user gets
 * a clear refusal rather than a frame that silently never arrives.
 * `outputType` is what the compressor falls back to if it throws.
 */
export const IMAGE_COMPRESSION_LADDER: CompressionLadder = {
  softTargetBytes: 500 * 1024,
  /** below 1024px a photographed document stops being readable */
  edges: [1600, 1280, 1024],
  firstEdgeQualities: [0.8, 0.7, 0.6, 0.5],
  laterEdgeQualities: [0.7, 0.5],
};

export const UNOBRAVO_IMAGE_OPTIONS: ImageOptions = {
  /** a document photographed at 1600px stays readable when zoomed */
  maxWidthOrHeight: 1600,
  /** post-compression hard stop: ~1.37 MB once base64'd into the frame */
  maxFileSizeBytes: 1024 * 1024,
  outputType: "image/jpeg",
  processImageFile: createImageCompressor(
    browserCompressorDeps,
    IMAGE_COMPRESSION_LADDER,
  ),
};
