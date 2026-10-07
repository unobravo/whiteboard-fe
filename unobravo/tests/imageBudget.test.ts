/**
 * The image budget. With image bytes inside the scene broadcast,
 * `UNOBRAVO_IMAGE_OPTIONS` is what keeps a pasted photo from producing a frame
 * the relay drops on the floor. These assertions pin the arithmetic, so raising
 * the ceiling has to be a deliberate edit with the relay's buffer in hand.
 */
import { describe, expect, it } from "vitest";

import { RELAY_MAX_FRAME_BYTES } from "../collab/relayPersistence";
import {
  IMAGE_COMPRESSION_LADDER,
  UNOBRAVO_IMAGE_OPTIONS,
} from "../config/imageOptions";

/** base64 is 4 bytes of text per 3 bytes of input. */
const BASE64_INFLATION = 4 / 3;

describe("image budget", () => {
  it("re-encodes on insert, which is what actually bounds the bytes", () => {
    // without this, `maxFileSizeBytes` only rejects: a 1440px PNG screenshot
    // weighing 3 MB is refused rather than made to fit
    expect(UNOBRAVO_IMAGE_OPTIONS.outputType).toBe("image/jpeg");
  });

  it("compresses every insert down the ladder (MIL-2825)", () => {
    expect(UNOBRAVO_IMAGE_OPTIONS.processImageFile).toBeTypeOf("function");
  });

  it("aims below the hard stop, so the ladder has room to work", () => {
    expect(IMAGE_COMPRESSION_LADDER.softTargetBytes).toBeLessThanOrEqual(
      UNOBRAVO_IMAGE_OPTIONS.maxFileSizeBytes!,
    );
    // never below the edge a photographed document stays readable at
    expect(Math.min(...IMAGE_COMPRESSION_LADDER.edges)).toBeGreaterThanOrEqual(
      1024,
    );
  });

  it("only calls a compression slow past 5 s, above the ~2 s worst case measured", () => {
    expect(IMAGE_COMPRESSION_LADDER.slowMs).toBe(5000);
  });

  it("fits ten worst-case images in one complete frame", () => {
    // a complete frame carries every image on the board, so one image must
    // be a small fraction of the relay's buffer, not merely under it
    const worstCaseImage =
      UNOBRAVO_IMAGE_OPTIONS.maxFileSizeBytes! * BASE64_INFLATION;

    expect(worstCaseImage * 10).toBeLessThan(RELAY_MAX_FRAME_BYTES);
  });

  it("caps the long edge low enough that a document stays readable", () => {
    expect(UNOBRAVO_IMAGE_OPTIONS.maxWidthOrHeight).toBe(1600);
  });
});
