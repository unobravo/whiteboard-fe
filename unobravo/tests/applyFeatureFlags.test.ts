import { createElement } from "react";

import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";

import { DEFAULT_FEATURE_FLAGS } from "../config/featureFlags";
import { applyFeatureFlags } from "../excalidraw/applyFeatureFlags";

import type { UnobravoFeatureFlags } from "../types";

const onExportToBackend = async () => {};

const renderCustomUI = () => createElement("div");

const baseUIOptions: ExcalidrawProps["UIOptions"] = {
  canvasActions: {
    toggleTheme: true,
    export: { onExportToBackend, renderCustomUI },
  },
};

const flagsWith = (
  overrides: Partial<UnobravoFeatureFlags>,
): UnobravoFeatureFlags => ({ ...DEFAULT_FEATURE_FLAGS, ...overrides });

describe("applyFeatureFlags", () => {
  it("returns the very same object when nothing is gated", () => {
    expect(applyFeatureFlags(baseUIOptions, DEFAULT_FEATURE_FLAGS)).toBe(
      baseUIOptions,
    );
  });

  it("keeps the app's own options that it does not control", () => {
    const UIOptions = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ images: false }),
    );

    expect(UIOptions?.canvasActions?.toggleTheme).toBe(true);
  });

  it("disables the JSON export dialog", () => {
    const UIOptions = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ export: false }),
    );

    expect(UIOptions?.canvasActions?.export).toBe(false);
  });

  it("drops the share-link callback without disabling the dialog", () => {
    const UIOptions = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ shareLinks: false }),
    );
    const exportOpts = UIOptions?.canvasActions?.export;

    expect(exportOpts).not.toBe(false);
    expect(exportOpts && exportOpts.onExportToBackend).toBeUndefined();
    expect(exportOpts && exportOpts.saveFileToDisk).toBe(true);
  });

  it("keeps the share-link callback when the flag is on", () => {
    const UIOptions = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ images: false }),
    );
    const exportOpts = UIOptions?.canvasActions?.export;

    expect(exportOpts && exportOpts.onExportToBackend).toBe(onExportToBackend);
  });

  it("drops the Excalidraw+ upload card together with the share link", () => {
    // `renderCustomUI` is where the app mounts <ExportToExcalidrawPlus>, which
    // uploads the scene to Excalidraw's cloud — same egress as a share link
    const exportOpts = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ shareLinks: false }),
    )?.canvasActions?.export;

    expect(exportOpts).not.toBe(false);
    expect(exportOpts && exportOpts.renderCustomUI).toBeUndefined();
  });

  it("keeps the Excalidraw+ upload card when share links are on", () => {
    const exportOpts = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ images: false }),
    )?.canvasActions?.export;

    expect(exportOpts && exportOpts.renderCustomUI).toBe(renderCustomUI);
  });

  it("never re-enables what the app itself disabled", () => {
    const restrictive: ExcalidrawProps["UIOptions"] = {
      canvasActions: {
        export: false,
        saveAsImage: false,
        loadScene: false,
        saveToActiveFile: false,
      },
      tools: { image: false },
    };

    // every flag on, but the app's own options must win
    const UIOptions = applyFeatureFlags(restrictive, flagsWith({ ai: false }));

    expect(UIOptions?.canvasActions?.export).toBe(false);
    expect(UIOptions?.canvasActions?.saveAsImage).toBe(false);
    expect(UIOptions?.canvasActions?.loadScene).toBe(false);
    expect(UIOptions?.canvasActions?.saveToActiveFile).toBe(false);
    expect(UIOptions?.tools?.image).toBe(false);
  });

  it("gates saving to disk in both places", () => {
    const UIOptions = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ saveToDisk: false }),
    );
    const exportOpts = UIOptions?.canvasActions?.export;

    expect(exportOpts && exportOpts.saveFileToDisk).toBe(false);
    expect(UIOptions?.canvasActions?.saveToActiveFile).toBe(false);
  });

  it("gates image export and loading from a file", () => {
    expect(
      applyFeatureFlags(baseUIOptions, flagsWith({ saveAsImage: false }))
        ?.canvasActions?.saveAsImage,
    ).toBe(false);

    expect(
      applyFeatureFlags(baseUIOptions, flagsWith({ loadFromFile: false }))
        ?.canvasActions?.loadScene,
    ).toBe(false);
  });

  it("gates the image tool", () => {
    expect(
      applyFeatureFlags(baseUIOptions, flagsWith({ images: false }))?.tools,
    ).toEqual({ image: false });
  });

  it("keeps a stable `tools` reference, which the editor compares by identity", () => {
    const flags = flagsWith({ images: false });

    expect(applyFeatureFlags(baseUIOptions, flags)?.tools).toBe(
      applyFeatureFlags(baseUIOptions, flags)?.tools,
    );
  });

  it("leaves the export options mutable, as the editor back-fills them", () => {
    const exportOpts = applyFeatureFlags(
      baseUIOptions,
      flagsWith({ images: false }),
    )?.canvasActions?.export;

    expect(Object.isFrozen(exportOpts)).toBe(false);
  });

  it("copes with an app that passes no UIOptions at all", () => {
    const UIOptions = applyFeatureFlags(undefined, flagsWith({ ai: false }));

    expect(UIOptions).toBeUndefined();

    const gated = applyFeatureFlags(undefined, flagsWith({ export: false }));

    expect(gated?.canvasActions?.export).toBe(false);
  });
});
