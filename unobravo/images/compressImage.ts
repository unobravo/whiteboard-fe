import { MIME_TYPES } from "@excalidraw/common";
import { resizeImageFile } from "@excalidraw/excalidraw/data/blob";

import type { ImageOptions } from "@excalidraw/excalidraw/types";

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
 */
export const createImageCompressor = <I extends DecodedImage>(
  deps: CompressorDeps<I>,
  ladder: CompressionLadder,
): ProcessImageFile => {
  return async (file, opts) => {
    if (file.type === MIME_TYPES.svg) {
      return file;
    }

    try {
      const edges = [
        ...new Set(
          ladder.edges.map((edge) => Math.min(edge, opts.maxWidthOrHeight)),
        ),
      ];

      let transparent: boolean | undefined;

      const walk = async (asPng: () => boolean) => {
        let previousLongEdge: number | undefined;
        let smallest: Blob | null = null;

        for (const [index, edge] of edges.entries()) {
          const image = await deps.decode(await deps.resize(file, edge));
          try {
            const longEdge = Math.max(image.width, image.height);
            // the source was already smaller than this step: same pixels again
            if (longEdge === previousLongEdge) {
              continue;
            }
            previousLongEdge = longEdge;

            transparent ??=
              ALPHA_CAPABLE_TYPES.has(file.type) && deps.hasAlpha(image);

            const attempts = asPng()
              ? [{ type: MIME_TYPES.png, quality: undefined }]
              : (index === 0
                  ? ladder.firstEdgeQualities
                  : ladder.laterEdgeQualities
                ).map((quality) => ({ type: MIME_TYPES.jpg, quality }));

            for (const { type, quality } of attempts) {
              const blob = await deps.encode(image, type, quality);
              if (!smallest || blob.size < smallest.size) {
                smallest = blob;
              }
              if (blob.size <= ladder.softTargetBytes) {
                return blob;
              }
            }
          } finally {
            image.close?.();
          }
        }
        return smallest;
      };

      let result = await walk(() => transparent === true);

      // last resort for a transparent image no PNG step fits under the hard
      // stop: JPEG on white loses the alpha, but refusing it would be worse
      if (transparent && result && result.size > opts.maxFileSizeBytes) {
        const jpeg = await walk(() => false);
        if (jpeg && jpeg.size < result.size) {
          result = jpeg;
        }
      }

      if (!result) {
        throw new Error("image compression produced no encoding");
      }
      return toFile(result, file.name);
    } catch (error) {
      console.error("Image compression failed, falling back", error);
      return deps.fallback(file, opts);
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
  encode: (image, type, quality) => {
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
};
