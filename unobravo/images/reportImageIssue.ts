import * as Sentry from "@sentry/browser";

/**
 * What can go wrong, or look wrong, while compressing an inserted image.
 * `unobravo/images.md` has what each one means and what to do about it.
 */
export type ImageIssue =
  /** a ladder step threw; the plain JPEG re-encode was used instead */
  | "compression-failed"
  /** the fallback threw too; the original file went on, metadata and all */
  | "fallback-failed"
  /** the best encoding is still over `maxFileSizeBytes`: the insert is refused */
  | "over-hard-stop"
  /** a transparent image only fit as JPEG, on white */
  | "transparency-dropped"
  /** `canvas.toBlob` produced another type than the one asked for */
  | "unexpected-encoder-type"
  /** the whole ladder took longer than `CompressionLadder.slowMs` */
  | "slow-compression";

export type ImageStage =
  | "resize"
  | "decode"
  | "hasAlpha"
  | "encode"
  | "fallback";

/**
 * Deliberately has no `name`: a clinical file name can carry a patient's
 * name. Sizes, types and timings are all an event ever needs.
 */
export type ImageIssueContext = {
  inputType: string;
  inputBytes: number;
  outputType?: string;
  outputBytes?: number;
  /** decoded size at the step that failed, or of the result */
  width?: number;
  height?: number;
  /** encodings tried so far */
  attempts?: number;
  durationMs?: number;
  stage?: ImageStage;
  /** only for `unexpected-encoder-type` */
  requestedType?: string;
};

/**
 * Exceptions for what threw, warnings for what merely looks wrong, all tagged
 * `imageIssue` so they can be filtered. Never lets Sentry itself break an
 * insert, and never logs through `console.error`: `captureConsoleIntegration`
 * would turn that into a second, untagged event.
 */
export const reportImageIssue = (
  issue: ImageIssue,
  context: ImageIssueContext,
  error?: unknown,
) => {
  try {
    if (error !== undefined) {
      Sentry.captureException(error, {
        level: "error",
        tags: { imageIssue: issue, imageStage: context.stage },
        extra: context,
      });
    } else {
      Sentry.captureMessage(`image: ${issue}`, {
        level: "warning",
        tags: { imageIssue: issue },
        extra: context,
      });
    }
  } catch (sentryError) {
    console.warn(sentryError);
  }
};
