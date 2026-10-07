/**
 * Compression of inserted images (MIL-2825). How it works, why, and what each
 * Sentry event means: `unobravo/images.md`.
 */
import { MIME_TYPES } from "@excalidraw/common";
import { resizeImageFile } from "@excalidraw/excalidraw/data/blob";

import type { ImageOptions } from "@excalidraw/excalidraw/types";

import { reportImageIssue } from "./reportImageIssue";

import type { ImageIssueContext, ImageStage } from "./reportImageIssue";

type ProcessImageFile = NonNullable<ImageOptions["processImageFile"]>;

/** Anything the encoder can draw, with the pixel size it will be drawn at. */
export type DecodedImage = {
  width: number;
  height: number;
  close?: () => void;
};

/**
 * The browser primitives the ladder runs on. Injected so the ladder itself can
 * be tested in jsdom, which has a canvas mock but no real image codec.
 */
export type CompressorDeps<I extends DecodedImage = DecodedImage> = {
  /** pica resize to `maxWidthOrHeight`, keeping the source format and alpha */
  resize: (file: File, maxWidthOrHeight: number) => Promise<Blob>;
  decode: (blob: Blob) => Promise<I>;
  hasAlpha: (image: I) => boolean;
  encode: (
    image: I,
    type: typeof MIME_TYPES["png"] | typeof MIME_TYPES["jpg"],
    quality?: number,
  ) => Promise<Blob>;
  /** used when anything above throws: the pre-ladder behaviour */
  fallback: ProcessImageFile;
  report: typeof reportImageIssue;
  /** milliseconds, for `slowMs` */
  now: () => number;
};

export type CompressionLadder = {
  /** stop at the first encoding at or under this */
  softTargetBytes: number;
  /** long-edge steps, largest first; each is capped at `maxWidthOrHeight` */
  edges: readonly number[];
  /** JPEG qualities tried at the first edge */
  firstEdgeQualities: readonly number[];
  /** JPEG qualities tried once the pixels have been reduced */
  laterEdgeQualities: readonly number[];
  /** a compression slower than this is reported as `slow-compression` */
  slowMs: number;
};

/** formats that can carry an alpha channel; JPEG/JFIF never do */
const ALPHA_CAPABLE_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.png,
  MIME_TYPES.webp,
  MIME_TYPES.gif,
  MIME_TYPES.avif,
  MIME_TYPES.ico,
  MIME_TYPES.bmp,
]);

/** what the ladder asks for, and so all it accepts back */
const ENCODED_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.png,
  MIME_TYPES.jpg,
]);

type Encoding = { blob: Blob; width: number; height: number };

const toFile = (blob: Blob, name: string) =>
  // the type the encoder actually produced, never the one we asked for
  new File([blob], name, { type: blob.type });

/**
 * Builds an `imageOptions.processImageFile` that re-encodes every inserted
 * raster image, and walks down quality and then pixels until it fits
 * `softTargetBytes`:
 *
 * - opaque images always become JPEG, even when they already fit — the
 *   canvas re-encode is what strips EXIF/GPS;
 * - images with any transparent pixel stay PNG, and only lose pixels — unless
 *   no PNG fits under `maxFileSizeBytes`, in which case they run the JPEG
 *   ladder on white rather than be refused;
 * - SVG passes through untouched (upstream has already normalised it).
 *
 * When nothing reaches the soft target the smallest encoding is returned, and
 * `maxFileSizeBytes` in `initializeImage` stays the hard stop.
 *
 * Never throws. A failing step falls back to the plain JPEG re-encode, and a
 * failing fallback returns the original file — what `initializeImage` did
 * before this hook existed. Every one of those is reported, tagged with the
 * stage that failed.
 */
export const createImageCompressor = <I extends DecodedImage>(
  deps: CompressorDeps<I>,
  ladder: CompressionLadder,
): ProcessImageFile => {
  return async (file, opts) => {
    if (file.type === MIME_TYPES.svg) {
      return file;
    }

    const startedAt = deps.now();
    const elapsed = () => Math.round(deps.now() - startedAt);
    const context: ImageIssueContext = {
      inputType: file.type,
      inputBytes: file.size,
      attempts: 0,
    };
    let stage: ImageStage = "resize";

    try {
      const edges = [
        ...new Set(
          ladder.edges.map((edge) => Math.min(edge, opts.maxWidthOrHeight)),
        ),
      ];

      let transparent: boolean | undefined;
      let reportedEncoderType = false;

      const walk = async (asPng: () => boolean) => {
        let previousLongEdge: number | undefined;
        let smallest: Encoding | null = null;

        for (const [index, edge] of edges.entries()) {
          stage = "resize";
          const resized = await deps.resize(file, edge);
          stage = "decode";
          const image = await deps.decode(resized);
          try {
            context.width = image.width;
            context.height = image.height;

            const longEdge = Math.max(image.width, image.height);
            // the source was already smaller than this step: same pixels again
            if (longEdge === previousLongEdge) {
              continue;
            }
            previousLongEdge = longEdge;

            if (transparent === undefined) {
              stage = "hasAlpha";
              transparent =
                ALPHA_CAPABLE_TYPES.has(file.type) && deps.hasAlpha(image);
            }

            const attempts = asPng()
              ? [{ type: MIME_TYPES.png, quality: undefined }]
              : (index === 0
                  ? ladder.firstEdgeQualities
                  : ladder.laterEdgeQualities
                ).map((quality) => ({ type: MIME_TYPES.jpg, quality }));

            for (const { type, quality } of attempts) {
              stage = "encode";
              const blob = await deps.encode(image, type, quality);
              context.attempts!++;

              if (blob.type !== type) {
                if (!reportedEncoderType) {
                  reportedEncoderType = true;
                  deps.report("unexpected-encoder-type", {
                    ...context,
                    requestedType: type,
                    outputType: blob.type,
                    outputBytes: blob.size,
                  });
                }
                // an empty or exotic type would be stored as the mimeType
                if (!ENCODED_TYPES.has(blob.type)) {
                  throw new Error(
                    `encoder produced "${blob.type}" for "${type}"`,
                  );
                }
              }

              const encoding = {
                blob,
                width: image.width,
                height: image.height,
              };
              if (!smallest || blob.size < smallest.blob.size) {
                smallest = encoding;
              }
              if (blob.size <= ladder.softTargetBytes) {
                return encoding;
              }
            }
          } finally {
            image.close?.();
          }
        }
        return smallest;
      };

      let result = await walk(() => transparent === true);
      let transparencyDropped = false;

      // last resort for a transparent image no PNG step fits under the hard
      // stop: JPEG on white loses the alpha, but refusing it would be worse
      if (transparent && result && result.blob.size > opts.maxFileSizeBytes) {
        const jpeg = await walk(() => false);
        if (jpeg && jpeg.blob.size < result.blob.size) {
          result = jpeg;
          transparencyDropped = true;
        }
      }

      if (!result) {
        throw new Error("image compression produced no encoding");
      }

      const outcome: ImageIssueContext = {
        ...context,
        width: result.width,
        height: result.height,
        outputType: result.blob.type,
        outputBytes: result.blob.size,
        durationMs: elapsed(),
      };
      if (transparencyDropped) {
        deps.report("transparency-dropped", outcome);
      }
      if (result.blob.size > opts.maxFileSizeBytes) {
        deps.report("over-hard-stop", outcome);
      }
      if (outcome.durationMs! > ladder.slowMs) {
        deps.report("slow-compression", outcome);
      }

      return toFile(result.blob, file.name);
    } catch (error) {
      // console.warn, not console.error: Sentry already gets this, tagged
      console.warn("Image compression failed, falling back", error);
      deps.report(
        "compression-failed",
        { ...context, stage, durationMs: elapsed() },
        error,
      );

      try {
        return await deps.fallback(file, opts);
      } catch (fallbackError) {
        console.warn("Image compression fallback failed", fallbackError);
        deps.report(
          "fallback-failed",
          { ...context, stage: "fallback", durationMs: elapsed() },
          fallbackError,
        );
        return file;
      }
    }
  };
};

const drawToCanvas = (image: ImageBitmap, background?: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2d canvas context unavailable");
  }
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0);
  return { canvas, context };
};

export const browserCompressorDeps: CompressorDeps<ImageBitmap> = {
  resize: (file, maxWidthOrHeight) =>
    resizeImageFile(file, { maxWidthOrHeight }),
  // applies the EXIF orientation, so a portrait phone photo stays upright
  decode: (blob) => createImageBitmap(blob, { imageOrientation: "from-image" }),
  hasAlpha: (image) => {
    const { context } = drawToCanvas(image);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }
    return false;
  },
  // async, so a missing canvas context rejects rather than throws
  encode: async (image, type, quality) => {
    // JPEG has no alpha: paint white underneath rather than let it go black
    const { canvas } = drawToCanvas(
      image,
      type === MIME_TYPES.jpg ? "#ffffff" : undefined,
    );
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("canvas.toBlob failed")),
        type,
        quality,
      ),
    );
  },
  fallback: (file, { maxWidthOrHeight }) =>
    resizeImageFile(file, { maxWidthOrHeight, outputType: MIME_TYPES.jpg }),
  report: reportImageIssue,
  now: () => performance.now(),
};
