/**
 * The browser primitives under the compression ladder (`browserCompressorDeps`
 * in `unobravo/images/compressImage.ts`). jsdom cannot decode or encode an
 * image, so the canvas context and `toBlob` are replaced by recorders: what is
 * asserted is how they are *called* — white under a JPEG and nothing under a
 * PNG, alpha read from the pixels, orientation applied on decode.
 */
import { MIME_TYPES } from "@excalidraw/common";
import * as blobModule from "@excalidraw/excalidraw/data/blob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserCompressorDeps } from "../images/compressImage";
import { reportImageIssue } from "../images/reportImageIssue";

const image = { width: 4, height: 2 } as ImageBitmap;

/** a 2d context that records the order of what is drawn on it */
const recordingContext = (pixels?: Uint8ClampedArray) => {
  const calls: string[] = [];
  const context = {
    set fillStyle(value: string) {
      calls.push(`fillStyle=${value}`);
    },
    fillRect: vi.fn(() => calls.push("fillRect")),
    drawImage: vi.fn(() => calls.push("drawImage")),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: pixels ?? new Uint8ClampedArray(w * h * 4).fill(255),
    })),
  };
  return { context, calls };
};

const useContext = (context: object | null) =>
  vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => context as any);

const useToBlob = (blob: Blob | null) =>
  vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) => callback(blob));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browserCompressorDeps", () => {
  describe("encode", () => {
    beforeEach(() => {
      useToBlob(new Blob([], { type: MIME_TYPES.jpg }));
    });

    it("paints white under a JPEG before drawing, so transparency never turns black", async () => {
      const { context, calls } = recordingContext();
      useContext(context);

      await browserCompressorDeps.encode(image, MIME_TYPES.jpg, 0.7);

      expect(calls).toEqual(["fillStyle=#ffffff", "fillRect", "drawImage"]);
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 4, 2);
    });

    it("paints nothing under a PNG, so its alpha survives", async () => {
      const { context, calls } = recordingContext();
      useContext(context);

      await browserCompressorDeps.encode(image, MIME_TYPES.png);

      expect(calls).toEqual(["drawImage"]);
    });

    it("draws on a canvas the size of the image", async () => {
      const { context } = recordingContext();
      useContext(context);
      const toBlob = useToBlob(new Blob([], { type: MIME_TYPES.jpg }));

      await browserCompressorDeps.encode(image, MIME_TYPES.jpg, 0.7);

      const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
      expect([canvas.width, canvas.height]).toEqual([4, 2]);
    });

    it("asks toBlob for the requested type and quality", async () => {
      useContext(recordingContext().context);
      const toBlob = useToBlob(new Blob([], { type: MIME_TYPES.jpg }));

      await browserCompressorDeps.encode(image, MIME_TYPES.jpg, 0.6);

      expect(toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        MIME_TYPES.jpg,
        0.6,
      );
    });

    it("resolves with the blob toBlob produced", async () => {
      useContext(recordingContext().context);
      const blob = new Blob([new Uint8Array(3)], { type: MIME_TYPES.png });
      useToBlob(blob);

      await expect(
        browserCompressorDeps.encode(image, MIME_TYPES.png),
      ).resolves.toBe(blob);
    });

    it("rejects when toBlob produces nothing", async () => {
      useContext(recordingContext().context);
      useToBlob(null);

      await expect(
        browserCompressorDeps.encode(image, MIME_TYPES.jpg, 0.8),
      ).rejects.toThrow("canvas.toBlob failed");
    });

    it("throws when no 2d context is available", async () => {
      useContext(null);

      await expect(
        browserCompressorDeps.encode(image, MIME_TYPES.jpg, 0.8),
      ).rejects.toThrow("2d canvas context unavailable");
    });
  });

  describe("hasAlpha", () => {
    it("is false when every pixel is fully opaque", () => {
      useContext(recordingContext().context);

      expect(browserCompressorDeps.hasAlpha(image)).toBe(false);
    });

    it("is true when a single pixel is even slightly transparent", () => {
      const pixels = new Uint8ClampedArray(4 * 2 * 4).fill(255);
      pixels[pixels.length - 1] = 254; // the very last pixel's alpha
      useContext(recordingContext(pixels).context);

      expect(browserCompressorDeps.hasAlpha(image)).toBe(true);
    });

    it("reads alpha only, not a dark colour channel", () => {
      const pixels = new Uint8ClampedArray(4 * 2 * 4).fill(255);
      pixels[0] = 0; // red of the first pixel
      pixels[1] = 0;
      pixels[2] = 0;
      useContext(recordingContext(pixels).context);

      expect(browserCompressorDeps.hasAlpha(image)).toBe(false);
    });

    it("reads the whole image, with no background painted under it", () => {
      const { context, calls } = recordingContext();
      useContext(context);

      browserCompressorDeps.hasAlpha(image);

      expect(calls).toEqual(["drawImage"]);
      expect(context.getImageData).toHaveBeenCalledWith(0, 0, 4, 2);
    });

    it("throws when no 2d context is available", () => {
      useContext(null);

      expect(() => browserCompressorDeps.hasAlpha(image)).toThrow(
        "2d canvas context unavailable",
      );
    });
  });

  describe("decode", () => {
    it("applies the EXIF orientation, so a portrait photo stays upright", async () => {
      const bitmap = { width: 2, height: 4 };
      const createImageBitmap = vi.fn(async () => bitmap);
      vi.stubGlobal("createImageBitmap", createImageBitmap);
      const blob = new Blob([], { type: MIME_TYPES.jpg });

      await expect(browserCompressorDeps.decode(blob)).resolves.toBe(bitmap);
      expect(createImageBitmap).toHaveBeenCalledWith(blob, {
        imageOrientation: "from-image",
      });
    });
  });

  describe("resize and fallback", () => {
    const file = new File([new Uint8Array(3)], "x.png", {
      type: MIME_TYPES.png,
    });

    it("resizes through upstream's pica helper, keeping the source format", async () => {
      const resize = vi
        .spyOn(blobModule, "resizeImageFile")
        .mockResolvedValue(file);

      await browserCompressorDeps.resize(file, 1280);

      expect(resize).toHaveBeenCalledWith(file, { maxWidthOrHeight: 1280 });
    });

    it("falls back to upstream's plain JPEG re-encode", async () => {
      const resize = vi
        .spyOn(blobModule, "resizeImageFile")
        .mockResolvedValue(file);

      await browserCompressorDeps.fallback(file, {
        maxWidthOrHeight: 1600,
        maxFileSizeBytes: 1024,
      });

      expect(resize).toHaveBeenCalledWith(file, {
        maxWidthOrHeight: 1600,
        outputType: MIME_TYPES.jpg,
      });
    });
  });

  describe("wiring", () => {
    it("reports through reportImageIssue", () => {
      expect(browserCompressorDeps.report).toBe(reportImageIssue);
    });

    it("measures with a monotonic clock", () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(1234);

      expect(browserCompressorDeps.now()).toBe(1234);
      expect(now).toHaveBeenCalled();
    });
  });
});
