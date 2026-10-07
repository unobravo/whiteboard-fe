/**
 * The compression ladder behind `UNOBRAVO_IMAGE_OPTIONS.processImageFile`
 * (MIL-2825, `unobravo/images.md`).
 *
 * jsdom has no image codec, so the browser primitives are replaced by a fake
 * whose output size is a function of pixels and quality. What is under test
 * is the ladder's decisions — which encodings it tries, in which order, which
 * one it keeps, and what it reports — not pica or `canvas.toBlob`, which
 * `compressorBrowserDeps.test.ts` covers separately.
 */
import { MIME_TYPES } from "@excalidraw/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IMAGE_COMPRESSION_LADDER } from "../config/imageOptions";
import { createImageCompressor } from "../images/compressImage";

import type { CompressorDeps, DecodedImage } from "../images/compressImage";
import type { ImageStage } from "../images/reportImageIssue";

const KB = 1024;
const OPTS = { maxWidthOrHeight: 1600, maxFileSizeBytes: 1024 * KB };
/** a clinical file name: it must never reach a report */
const FILE_NAME = "Mario Rossi - referto 12-03.jpg";

type FakeImage = DecodedImage & { alpha: boolean; close: () => void };

type Setup = {
  /** long edge of the source; each resize step is capped by it */
  sourceLongEdge?: number;
  alpha?: boolean;
  /** what each encoding weighs; PNG is passed `quality: 1` */
  bytesAt?: (longEdge: number, quality: number) => number;
  /** what the encoder reports producing, when it differs from the request */
  encodedType?: (requested: string) => string;
  /** milliseconds `now()` advances by on every call */
  tick?: number;
};

const setup = ({
  sourceLongEdge = 4000,
  alpha = false,
  bytesAt = () => 100 * KB,
  encodedType = (requested) => requested,
  tick = 0,
}: Setup = {}) => {
  // jsdom's Blob has no `.text()`: remember each resized blob's long edge
  const edgeOf = new WeakMap<Blob, number>();
  const decoded: FakeImage[] = [];
  let clock = 0;

  const deps: CompressorDeps<FakeImage> = {
    resize: vi.fn(async (_file: File, maxWidthOrHeight: number) => {
      const blob = new Blob([]);
      edgeOf.set(blob, Math.min(sourceLongEdge, maxWidthOrHeight));
      return blob;
    }),
    decode: vi.fn(async (blob: Blob) => {
      const edge = edgeOf.get(blob)!;
      const image = {
        width: edge,
        height: Math.round(edge * 0.75),
        alpha,
        close: vi.fn(),
      };
      decoded.push(image);
      return image;
    }),
    hasAlpha: vi.fn((image: FakeImage) => image.alpha),
    encode: vi.fn(async (image: FakeImage, type, quality) => {
      const size = bytesAt(image.width, quality ?? 1);
      return new Blob([new Uint8Array(size)], { type: encodedType(type) });
    }),
    fallback: vi.fn(
      async () =>
        new File([new Uint8Array(10)], "fallback", { type: MIME_TYPES.jpg }),
    ),
    report: vi.fn(),
    now: vi.fn(() => (clock += tick)),
  };

  return {
    deps,
    decoded,
    compress: createImageCompressor(deps, IMAGE_COMPRESSION_LADDER),
  };
};

const file = (type: string, bytes = 3 * 1024 * KB) =>
  new File([new Uint8Array(bytes)], FILE_NAME, { type });

/** [long edge, type, quality] of every encoding tried, in order */
const encodeCalls = (deps: CompressorDeps<FakeImage>) =>
  vi
    .mocked(deps.encode)
    .mock.calls.map(([image, type, quality]) => [image.width, type, quality]);

const reportedIssues = (deps: CompressorDeps<FakeImage>) =>
  vi.mocked(deps.report).mock.calls.map(([issue]) => issue);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("compressImage", () => {
  describe("what it produces", () => {
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

    it("keeps the file name", async () => {
      const { compress } = setup();

      const result = await compress(file(MIME_TYPES.jpg), OPTS);

      expect(result.name).toBe(FILE_NAME);
    });

    it("labels the file with the type the encoder produced", async () => {
      const { compress } = setup({ encodedType: () => MIME_TYPES.png });

      const result = await compress(file(MIME_TYPES.jpg), OPTS);

      expect(result.type).toBe(MIME_TYPES.png);
    });

    it("passes SVG through untouched, without reporting anything", async () => {
      const svg = file(MIME_TYPES.svg, 10);
      const { compress, deps } = setup();

      await expect(compress(svg, OPTS)).resolves.toBe(svg);
      expect(deps.resize).not.toHaveBeenCalled();
      expect(deps.report).not.toHaveBeenCalled();
    });

    it.each([MIME_TYPES.png, MIME_TYPES.webp, MIME_TYPES.gif, MIME_TYPES.bmp])(
      "turns an opaque %s into JPEG",
      async (type) => {
        const { compress } = setup();

        const result = await compress(file(type), OPTS);

        expect(result.type).toBe(MIME_TYPES.jpg);
      },
    );
  });

  describe("transparency", () => {
    it.each([
      MIME_TYPES.png,
      MIME_TYPES.webp,
      MIME_TYPES.gif,
      MIME_TYPES.avif,
      MIME_TYPES.ico,
      MIME_TYPES.bmp,
    ])("scans the pixels of a %s for alpha", async (type) => {
      const { compress, deps } = setup();

      await compress(file(type), OPTS);

      expect(deps.hasAlpha).toHaveBeenCalledTimes(1);
    });

    it.each([MIME_TYPES.jpg, MIME_TYPES.jfif])(
      "never scans a %s, which cannot carry alpha",
      async (type) => {
        const { compress, deps } = setup({ alpha: true });

        const result = await compress(file(type), OPTS);

        expect(deps.hasAlpha).not.toHaveBeenCalled();
        expect(result.type).toBe(MIME_TYPES.jpg);
      },
    );

    it("scans for alpha once, however many steps it takes", async () => {
      const { compress, deps } = setup({ bytesAt: () => 900 * KB });

      await compress(file(MIME_TYPES.png), OPTS);

      expect(deps.hasAlpha).toHaveBeenCalledTimes(1);
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

    it("keeps the PNG when it misses the soft target but fits under the hard stop", async () => {
      const { compress, deps } = setup({
        alpha: true,
        bytesAt: () => 800 * KB,
      });

      const result = await compress(file(MIME_TYPES.png), OPTS);

      expect(result.type).toBe(MIME_TYPES.png);
      expect(deps.report).not.toHaveBeenCalled();
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
      expect(reportedIssues(deps)).toEqual(["transparency-dropped"]);
    });

    it("keeps the PNG when the JPEG fallback is no smaller", async () => {
      const { compress, deps } = setup({
        alpha: true,
        bytesAt: (_edge, q) => (q === 1 ? 2048 * KB : 3000 * KB),
      });

      const result = await compress(file(MIME_TYPES.png), OPTS);

      expect(result.type).toBe(MIME_TYPES.png);
      expect(result.size).toBe(2048 * KB);
      expect(reportedIssues(deps)).toEqual(["over-hard-stop"]);
    });
  });

  describe("the ladder", () => {
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

    it("accepts an encoding exactly at the soft target", async () => {
      const { compress, deps } = setup({
        bytesAt: () => IMAGE_COMPRESSION_LADDER.softTargetBytes,
      });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(encodeCalls(deps)).toHaveLength(1);
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

    it("tries every step, in order, when nothing fits", async () => {
      const { compress, deps } = setup({ bytesAt: () => 900 * KB });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(encodeCalls(deps)).toEqual([
        [1600, MIME_TYPES.jpg, 0.8],
        [1600, MIME_TYPES.jpg, 0.7],
        [1600, MIME_TYPES.jpg, 0.6],
        [1600, MIME_TYPES.jpg, 0.5],
        [1280, MIME_TYPES.jpg, 0.7],
        [1280, MIME_TYPES.jpg, 0.5],
        [1024, MIME_TYPES.jpg, 0.7],
        [1024, MIME_TYPES.jpg, 0.5],
      ]);
    });

    it("never goes below 1024px, and returns the smallest encoding when nothing fits", async () => {
      const { compress, deps } = setup({
        bytesAt: (edge, q) => Math.round(edge * q * KB),
      });

      const result = await compress(file(MIME_TYPES.jpg), OPTS);

      // 1024px at 0.5 is the smallest the ladder produces
      expect(result.size).toBe(512 * KB);
      expect(
        Math.min(...encodeCalls(deps).map(([edge]) => edge as number)),
      ).toBe(1024);
    });

    it("keeps the smallest encoding even when it is not the last one tried", async () => {
      // an encoder that gets *bigger* at lower quality, as real ones can on noise
      const { compress } = setup({
        bytesAt: (edge, q) =>
          edge === 1600 && q === 0.8 ? 600 * KB : 900 * KB,
      });

      const result = await compress(file(MIME_TYPES.jpg), OPTS);

      expect(result.size).toBe(600 * KB);
    });

    it("always resizes from the original file, never from a previous step", async () => {
      const source = file(MIME_TYPES.jpg);
      const { compress, deps } = setup({ bytesAt: () => 900 * KB });

      await compress(source, OPTS);

      expect(vi.mocked(deps.resize).mock.calls).toEqual([
        [source, 1600],
        [source, 1280],
        [source, 1024],
      ]);
    });

    it("does not encode the same pixels twice when the source is small", async () => {
      const { compress, deps } = setup({
        sourceLongEdge: 900,
        bytesAt: () => 900 * KB,
      });

      await compress(file(MIME_TYPES.jpg), OPTS);

      // 1600, 1280 and 1024 all decode to 900px: only the first edge encodes
      expect(encodeCalls(deps)).toEqual([
        [900, MIME_TYPES.jpg, 0.8],
        [900, MIME_TYPES.jpg, 0.7],
        [900, MIME_TYPES.jpg, 0.6],
        [900, MIME_TYPES.jpg, 0.5],
      ]);
    });

    it("caps every step at maxWidthOrHeight", async () => {
      const { compress, deps } = setup({ bytesAt: () => 900 * KB });

      await compress(file(MIME_TYPES.jpg), { ...OPTS, maxWidthOrHeight: 800 });

      // 1600, 1280 and 1024 all collapse to 800: one step, all four qualities
      expect(vi.mocked(deps.resize).mock.calls.map(([, edge]) => edge)).toEqual(
        [800],
      );
      expect(encodeCalls(deps)).toHaveLength(4);
    });

    it("keeps the steps below a maxWidthOrHeight that falls between them", async () => {
      const { compress, deps } = setup({ bytesAt: () => 900 * KB });

      await compress(file(MIME_TYPES.jpg), { ...OPTS, maxWidthOrHeight: 1300 });

      expect(vi.mocked(deps.resize).mock.calls.map(([, edge]) => edge)).toEqual(
        [1300, 1280, 1024],
      );
    });

    it("closes every decoded image, the skipped ones included", async () => {
      const { compress, decoded } = setup({
        sourceLongEdge: 900,
        bytesAt: () => 900 * KB,
      });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(decoded).toHaveLength(3);
      decoded.forEach((image) => expect(image.close).toHaveBeenCalledTimes(1));
    });

    it("closes the decoded image when encoding throws", async () => {
      const { compress, deps, decoded } = setup();
      vi.mocked(deps.encode).mockRejectedValueOnce(new Error("encode failed"));

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(decoded[0].close).toHaveBeenCalledTimes(1);
    });
  });

  describe("failures", () => {
    it("falls back to the pre-ladder behaviour when a step throws", async () => {
      const source = file(MIME_TYPES.jpg);
      const { compress, deps } = setup();
      vi.mocked(deps.decode).mockRejectedValueOnce(new Error("decode failed"));

      const result = await compress(source, OPTS);

      expect(deps.fallback).toHaveBeenCalledWith(source, OPTS);
      expect(result.name).toBe("fallback");
    });

    it("returns the original file when the fallback throws too, as before the hook", async () => {
      const source = file(MIME_TYPES.jpg);
      const { compress, deps } = setup();
      vi.mocked(deps.decode).mockRejectedValueOnce(new Error("decode failed"));
      vi.mocked(deps.fallback).mockRejectedValueOnce(new Error("pica failed"));

      await expect(compress(source, OPTS)).resolves.toBe(source);
      expect(reportedIssues(deps)).toEqual([
        "compression-failed",
        "fallback-failed",
      ]);
    });

    it.each(["", MIME_TYPES.webp, "application/octet-stream"])(
      "treats an encoder output typed %j as a failure",
      async (type) => {
        const { compress, deps } = setup({ encodedType: () => type });

        await compress(file(MIME_TYPES.jpg), OPTS);

        expect(deps.fallback).toHaveBeenCalled();
      },
    );

    it("never logs through console.error, which Sentry would capture again", async () => {
      const consoleError = vi.spyOn(console, "error");
      const { compress, deps } = setup();
      vi.mocked(deps.decode).mockRejectedValueOnce(new Error("decode failed"));
      vi.mocked(deps.fallback).mockRejectedValueOnce(new Error("pica failed"));

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe("reports", () => {
    it("reports nothing when everything goes to plan", async () => {
      const { compress, deps } = setup({
        bytesAt: (edge) => (edge > 1280 ? 900 * KB : 400 * KB),
      });

      await compress(file(MIME_TYPES.png), OPTS);

      expect(deps.report).not.toHaveBeenCalled();
    });

    it.each<[ImageStage, keyof CompressorDeps<FakeImage>]>([
      ["resize", "resize"],
      ["decode", "decode"],
      ["hasAlpha", "hasAlpha"],
      ["encode", "encode"],
    ])(
      "reports compression-failed with stage %s when %s throws",
      async (stage, dep) => {
        const error = new Error(`${dep} failed`);
        const { compress, deps } = setup();
        vi.mocked(deps[dep] as any).mockImplementationOnce(() => {
          throw error;
        });

        await compress(file(MIME_TYPES.png, 3000), OPTS);

        expect(deps.report).toHaveBeenCalledWith(
          "compression-failed",
          expect.objectContaining({
            stage,
            inputType: MIME_TYPES.png,
            inputBytes: 3000,
          }),
          error,
        );
      },
    );

    it("reports fallback-failed with the fallback's own error", async () => {
      const fallbackError = new Error("pica failed");
      const { compress, deps } = setup();
      vi.mocked(deps.decode).mockRejectedValueOnce(new Error("decode failed"));
      vi.mocked(deps.fallback).mockRejectedValueOnce(fallbackError);

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(deps.report).toHaveBeenLastCalledWith(
        "fallback-failed",
        expect.objectContaining({ stage: "fallback" }),
        fallbackError,
      );
    });

    it("counts the attempts made before a failure", async () => {
      const { compress, deps } = setup({ bytesAt: () => 900 * KB });
      vi.mocked(deps.encode)
        .mockResolvedValueOnce(
          new Blob([new Uint8Array(900 * KB)], { type: MIME_TYPES.jpg }),
        )
        .mockRejectedValueOnce(new Error("encode failed"));

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(deps.report).toHaveBeenCalledWith(
        "compression-failed",
        expect.objectContaining({ attempts: 1, stage: "encode", width: 1600 }),
        expect.any(Error),
      );
    });

    it("reports over-hard-stop when even the smallest encoding will be refused", async () => {
      const { compress, deps } = setup({ bytesAt: () => 2048 * KB });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(deps.report).toHaveBeenCalledWith(
        "over-hard-stop",
        expect.objectContaining({
          outputType: MIME_TYPES.jpg,
          outputBytes: 2048 * KB,
          attempts: 8,
          width: 1600,
        }),
      );
    });

    it("reports transparency-dropped with the JPEG it ended up as", async () => {
      const { compress, deps } = setup({
        alpha: true,
        bytesAt: (_edge, q) => (q === 1 ? 2048 * KB : 300 * KB),
      });

      await compress(file(MIME_TYPES.png), OPTS);

      expect(deps.report).toHaveBeenCalledWith(
        "transparency-dropped",
        expect.objectContaining({
          inputType: MIME_TYPES.png,
          outputType: MIME_TYPES.jpg,
          outputBytes: 300 * KB,
        }),
      );
    });

    it("reports unexpected-encoder-type once per compression", async () => {
      const { compress, deps } = setup({
        bytesAt: () => 900 * KB,
        // asked for JPEG, got PNG (what an unsupported toBlob type does)
        encodedType: () => MIME_TYPES.png,
      });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(
        reportedIssues(deps).filter((i) => i === "unexpected-encoder-type"),
      ).toHaveLength(1);
      expect(deps.report).toHaveBeenCalledWith(
        "unexpected-encoder-type",
        expect.objectContaining({
          requestedType: MIME_TYPES.jpg,
          outputType: MIME_TYPES.png,
        }),
      );
    });

    it("reports slow-compression past slowMs, with the duration", async () => {
      // `now()` is read at the start and at the end: one 6 s tick apart
      const { compress, deps } = setup({ tick: 6000 });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(deps.report).toHaveBeenCalledWith(
        "slow-compression",
        expect.objectContaining({ durationMs: 6000 }),
      );
    });

    it("does not report a compression under slowMs", async () => {
      const { compress, deps } = setup({ tick: 1000 });

      await compress(file(MIME_TYPES.jpg), OPTS);

      expect(deps.report).not.toHaveBeenCalled();
    });

    it("never puts the file name in a report", async () => {
      // every report this ladder can emit, in one run
      const { compress, deps } = setup({
        alpha: true,
        tick: 6000,
        bytesAt: () => 2048 * KB,
        encodedType: (requested) =>
          requested === MIME_TYPES.png ? MIME_TYPES.jpg : requested,
      });
      await compress(file(MIME_TYPES.png), OPTS);

      const failing = setup();
      vi.mocked(failing.deps.decode).mockRejectedValueOnce(
        new Error("decode failed"),
      );
      vi.mocked(failing.deps.fallback).mockRejectedValueOnce(
        new Error("pica failed"),
      );
      await failing.compress(file(MIME_TYPES.jpg), OPTS);

      const payloads = [
        ...vi.mocked(deps.report).mock.calls,
        ...vi.mocked(failing.deps.report).mock.calls,
      ];
      expect(payloads.length).toBeGreaterThan(3);
      const serialized = JSON.stringify(payloads.map(([, context]) => context));
      expect(serialized).not.toContain("Mario");
      expect(serialized).not.toContain("referto");
      payloads.forEach(([, context]) =>
        expect(context).not.toHaveProperty("name"),
      );
    });
  });
});
