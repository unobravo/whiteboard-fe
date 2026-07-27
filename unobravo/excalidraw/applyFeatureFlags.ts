import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";

import type { UnobravoFeatureFlags } from "../types";

type UIOptions = NonNullable<ExcalidrawProps["UIOptions"]>;
type CanvasActions = NonNullable<UIOptions["canvasActions"]>;
type Tools = NonNullable<UIOptions["tools"]>;

/**
 * `UIOptions.tools` is compared by reference by the editor's memo comparator
 * (`areEqual` in `packages/excalidraw/index.tsx`), unlike `canvasActions`
 * which is compared key by key. Reusing these constants keeps the memo intact
 * instead of re-rendering the whole editor on every parent render.
 */
const TOOLS_WITH_IMAGE: Tools = { image: true };
const TOOLS_WITHOUT_IMAGE: Tools = { image: false };

/**
 * Applies the Unobravo feature flags on top of the `UIOptions` the app already
 * builds, mapping each flag onto the editor's existing public options.
 *
 * The returned `canvasActions.export` object must stay mutable: the editor
 * back-fills `saveFileToDisk` on it in place.
 */
export const applyFeatureFlags = (
  baseUIOptions: ExcalidrawProps["UIOptions"],
  flags: UnobravoFeatureFlags,
): ExcalidrawProps["UIOptions"] => {
  // with nothing gated, hand back the very same object: an unconfigured build
  // must be indistinguishable from upstream, down to prop identity
  if (
    flags.export &&
    flags.saveAsImage &&
    flags.saveToDisk &&
    flags.loadFromFile &&
    flags.shareLinks &&
    flags.images
  ) {
    return baseUIOptions;
  }

  const baseCanvasActions = baseUIOptions?.canvasActions;
  const baseExport = baseCanvasActions?.export || undefined;

  const exportOpts: CanvasActions["export"] = flags.export
    ? {
        ...baseExport,
        saveFileToDisk:
          flags.saveToDisk && baseExport?.saveFileToDisk !== false,
        onExportToBackend: flags.shareLinks
          ? baseExport?.onExportToBackend
          : undefined,
      }
    : false;

  return {
    ...baseUIOptions,
    canvasActions: {
      ...baseCanvasActions,
      export: exportOpts,
      saveAsImage:
        flags.saveAsImage && baseCanvasActions?.saveAsImage !== false,
      saveToActiveFile:
        flags.saveToDisk && baseCanvasActions?.saveToActiveFile !== false,
      loadScene: flags.loadFromFile && baseCanvasActions?.loadScene !== false,
    },
    tools: flags.images ? TOOLS_WITH_IMAGE : TOOLS_WITHOUT_IMAGE,
  };
};
