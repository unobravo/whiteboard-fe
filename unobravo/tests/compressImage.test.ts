/**
 * The compression ladder behind `UNOBRAVO_IMAGE_OPTIONS.processImageFile`.
 * jsdom has no image codec, so the browser primitives are replaced by a fake
 * whose output size is a function of pixels and quality — the ladder's
 * decisions are what is under test, not pica or `canvas.toBlob`.
 */
import { MIME_TYPES } from "@excalidraw/common";
import { describe, expect, it, vi } from "vitest";

import { IMAGE_COMPRESSION_LADDER } from "../config/imageOptions";
import { createImageCompressor } from "../images/compressImage";

import type { CompressorDeps, DecodedImage } from "../images/compressImage";

const KB = 1024;
const OPTS = { maxWidthOrHeight: 1600, maxFileSizeBytes: 1024 * KB };

type FakeImage = DecodedImage & { alpha: boolean };

/**
 * `bytesAt(longEdge, quality)` decides what each encoding weighs; PNG is
 * passed `quality: 1`.
 */
const setup = ({
  sourceLongEdge = 4000,
  alpha = false,
  bytesAt,
  encodedType,
}: {
  sourceLongEdge?: number;
  alpha?: boolean;
  bytesAt: (longEdge: number, quality: number) => number;
  /** what the encoder reports producing, when it differs from the request */
  encodedType?: string;
}) => {
  // jsdom's Blob has no `.text()`: remember each resized blob's long edge
  const edgeOf = new WeakMap<Blob, number>();
  const deps: CompressorDeps<FakeImage> = {
    resize: vi.fn(async (_file: File, maxWidthOrHeight: number) => {
      const blob = new Blob([]);
      edgeOf.set(blob, Math.min(sourceLongEdge, maxWidthOrHeight));
      return blob;
    }),
    decode: vi.fn(async (blob: Blob) => {
      const edge = edgeOf.get(blob)!;
      return { width: edge, height: Math.round(edge * 0.75), alpha };
    }),
    hasAlpha: vi.fn((image: FakeImage) => image.alpha),
    encode: vi.fn(async (image: FakeImage, type, quality) => {
      const size = bytesAt(image.width, quality ?? 1);
      return new Blob([new Uint8Array(size)], { type: encodedType ?? type });
    }),
    fallback: vi.fn(async (file: File) => file),
  };
  return {
    deps,
    compress: createImageCompressor(deps, IMAGE_COMPRESSION_LADDER),
  };
};

const file = (type: string, bytes = 3 * 1024 * KB) =>
  new File([new Uint8Array(bytes)], "photo", { type });

const encodeCalls = (deps: CompressorDeps<FakeImage>) =>
  vi
    .mocked(deps.encode)
    .mock.calls.map(([image, type, quality]) => [image.width, type, quality]);

describe("compressImage", () => {
  it("re-encodes an opaque image that already fits, so EXIF/GPS never survives", async () => {
    const source = file(MIME_TYPES.jpg, 100 * KB);
    const { compress, deps } = setup({
      sourceLongEdge: 800,
      bytesAt: () => 90 * KB,
    });

    const result = await compress(source, OPTS);

    expect(result).not.toBe(source);
    expect(result.type).toBe(MIME_TYPES.jpg);
    expect(encodeCalls(deps)).toEqual([[800, MIME_TYPES.jpg, 0.8]]);
  });

  it("steps quality down and stops at the first encoding under the soft target", async () => {
    const { compress, deps } = setup({
      // 0.8 → 800 KB, 0.7 → 700 KB, 0.6 → 450 KB
      bytesAt: (_edge, q) => (q > 0.65 ? q * 1000 * KB : 450 * KB),
    });

    const result = await compress(file(MIME_TYPES.jpg), OPTS);

    expect(result.size).toBe(450 * KB);
    expect(encodeCalls(deps)).toEqual([
      [1600, MIME_TYPES.jpg, 0.8],
      [1600, MIME_TYPES.jpg, 0.7],
      [1600, MIME_TYPES.jpg, 0.6],
    ]);
  });

  it("reduces pixels once quality alone is not enough", async () => {
    const { compress, deps } = setup({
      bytesAt: (edge) => (edge > 1280 ? 900 * KB : 400 * KB),
    });

    const result = await compress(file(MIME_TYPES.jpg), OPTS);

    expect(result.size).toBe(400 * KB);
    expect(encodeCalls(deps)).toEqual([
      [1600, MIME_TYPES.jpg, 0.8],
      [1600, MIME_TYPES.jpg, 0.7],
      [1600, MIME_TYPES.jpg, 0.6],
      [1600, MIME_TYPES.jpg, 0.5],
      [1280, MIME_TYPES.jpg, 0.7],
    ]);
  });

  it("never goes below 1024px, and returns the smallest encoding when nothing fits", async () => {
    const { compress, deps } = setup({
      bytesAt: (edge, q) => Math.round(edge * q * KB),
    });

    const result = await compress(file(MIME_TYPES.jpg), OPTS);

    // 1024px at 0.5 is the smallest the ladder produces
    expect(result.size).toBe(512 * KB);
    expect(Math.min(...encodeCalls(deps).map(([edge]) => edge as number))).toBe(
      1024,
    );
  });

  it("keeps a transparent image as PNG and only reduces its pixels", async () => {
    const { compress, deps } = setup({
      alpha: true,
      bytesAt: (edge) => (edge > 1024 ? 800 * KB : 450 * KB),
    });

    const result = await compress(file(MIME_TYPES.png), OPTS);

    expect(result.type).toBe(MIME_TYPES.png);
    expect(encodeCalls(deps)).toEqual([
      [1600, MIME_TYPES.png, undefined],
      [1280, MIME_TYPES.png, undefined],
      [1024, MIME_TYPES.png, undefined],
    ]);
  });

  it("falls back to JPEG on white when no PNG fits under the hard stop", async () => {
    const { compress, deps } = setup({
      alpha: true,
      // PNG never fits; JPEG at 1600px and 0.7 lands under the soft target
      bytesAt: (_edge, q) =>
        q === 1 ? 2048 * KB : q > 0.75 ? 600 * KB : 450 * KB,
    });

    const result = await compress(file(MIME_TYPES.png), OPTS);

    expect(result.type).toBe(MIME_TYPES.jpg);
    expect(result.size).toBe(450 * KB);
    expect(encodeCalls(deps)).toEqual([
      [1600, MIME_TYPES.png, undefined],
      [1280, MIME_TYPES.png, undefined],
      [1024, MIME_TYPES.png, undefined],
      [1600, MIME_TYPES.jpg, 0.8],
      [1600, MIME_TYPES.jpg, 0.7],
    ]);
  });

  it("keeps the PNG when it misses the soft target but fits under the hard stop", async () => {
    const { compress } = setup({
      alpha: true,
      bytesAt: () => 800 * KB,
    });

    const result = await compress(file(MIME_TYPES.png), OPTS);

    expect(result.type).toBe(MIME_TYPES.png);
  });

  it("turns an opaque PNG screenshot into JPEG", async () => {
    const { compress } = setup({ bytesAt: () => 200 * KB });

    const result = await compress(file(MIME_TYPES.png), OPTS);

    expect(result.type).toBe(MIME_TYPES.jpg);
  });

  it("does not scan JPEG pixels for alpha", async () => {
    const { compress, deps } = setup({ bytesAt: () => 200 * KB });

    await compress(file(MIME_TYPES.jpg), OPTS);

    expect(deps.hasAlpha).not.toHaveBeenCalled();
  });

  it("does not encode the same pixels twice when the source is small", async () => {
    const { compress, deps } = setup({
      sourceLongEdge: 900,
      bytesAt: () => 900 * KB,
    });

    await compress(file(MIME_TYPES.jpg), OPTS);

    // 1600, 1280 and 1024 all decode to 900px: only the first edge encodes
    expect(encodeCalls(deps)).toHaveLength(4);
  });

  it("caps every step at maxWidthOrHeight", async () => {
    const { compress, deps } = setup({ bytesAt: () => 100 * KB });

    await compress(file(MIME_TYPES.jpg), { ...OPTS, maxWidthOrHeight: 1200 });

    expect(deps.resize).toHaveBeenCalledWith(expect.any(File), 1200);
  });

  it("labels the file with the type the encoder produced", async () => {
    const { compress } = setup({
      bytesAt: () => 100 * KB,
      encodedType: MIME_TYPES.png,
    });

    const result = await compress(file(MIME_TYPES.jpg), OPTS);

    expect(result.type).toBe(MIME_TYPES.png);
  });

  it("passes SVG through untouched", async () => {
    const svg = file(MIME_TYPES.svg, 10);
    const { compress, deps } = setup({ bytesAt: () => 1 });

    await expect(compress(svg, OPTS)).resolves.toBe(svg);
    expect(deps.resize).not.toHaveBeenCalled();
  });

  it("falls back to the pre-ladder behaviour when the browser primitives throw", async () => {
    const source = file(MIME_TYPES.jpg);
    const { compress, deps } = setup({ bytesAt: () => 1 });
    vi.mocked(deps.decode).mockRejectedValueOnce(new Error("decode failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await compress(source, OPTS);

    expect(deps.fallback).toHaveBeenCalledWith(source, OPTS);
  });
});
