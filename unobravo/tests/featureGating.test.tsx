import { actionSaveFileToDisk } from "@excalidraw/excalidraw/actions/actionExport";
import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
} from "@excalidraw/excalidraw/tests/test-utils";

import { UnobravoExcalidraw } from "../components/UnobravoExcalidraw";
import { DEFAULT_FEATURE_FLAGS } from "../config/featureFlags";
import {
  INERT_INTEGRATION,
  UnobravoIntegrationContext,
} from "../hooks/useUnobravoIntegration";

import type { UnobravoFeatureFlags } from "../types";

const { h } = window;

/**
 * These tests assert the *affordance* is gone, not merely that a prop was
 * passed: several editor surfaces ignore `UIOptions` and had to be gated
 * explicitly, so only the rendered result is meaningful.
 */
const renderWithFlags = async (overrides: Partial<UnobravoFeatureFlags>) =>
  render(
    <UnobravoIntegrationContext.Provider
      value={{
        ...INERT_INTEGRATION,
        enabled: true,
        flags: { ...DEFAULT_FEATURE_FLAGS, ...overrides },
      }}
    >
      <UnobravoExcalidraw
        UIOptions={{ canvasActions: { export: { saveFileToDisk: true } } }}
      />
    </UnobravoIntegrationContext.Provider>,
  );

describe("feature gating", () => {
  it("shows the image tool by default", async () => {
    await renderWithFlags({});

    expect(document.querySelector('[data-testid="toolbar-image"]')).not.toBe(
      null,
    );
  });

  it("hides the image tool when images are disabled", async () => {
    await renderWithFlags({ images: false });

    expect(document.querySelector('[data-testid="toolbar-image"]')).toBe(null);
  });

  it("keeps saving to disk available by default", async () => {
    await renderWithFlags({});

    expect(h.app.actionManager.isActionEnabled(actionSaveFileToDisk)).toBe(
      true,
    );
  });

  it("disables saving to disk — shortcut and palette included", async () => {
    await renderWithFlags({ saveToDisk: false });

    expect(h.app.actionManager.isActionEnabled(actionSaveFileToDisk)).toBe(
      false,
    );
  });

  it("disables saving to disk when the export dialog is off entirely", async () => {
    await renderWithFlags({ export: false });

    expect(h.app.actionManager.isActionEnabled(actionSaveFileToDisk)).toBe(
      false,
    );
  });

  it("turns the AI surfaces off via the editor's own prop", async () => {
    await renderWithFlags({ ai: false });

    expect(h.app.props.aiEnabled).toBe(false);
  });

  it("leaves the editor untouched when nothing is gated", async () => {
    await renderWithFlags({});

    expect(h.app.props.aiEnabled).toBe(true);
    expect(h.app.props.UIOptions.canvasActions.saveAsImage).toBe(true);
    expect(h.app.props.UIOptions.canvasActions.loadScene).toBe(true);
  });
});

describe("feature gating on the mobile toolbar", () => {
  beforeAll(() => {
    mockBoundingClientRect({ height: 400, width: 800 });
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  // positive control: proves the assertion below is not vacuous
  it("shows the image tool on the phone layout by default", async () => {
    await renderWithFlags({});
    h.app.refreshEditorInterface();

    expect(h.app.editorInterface.formFactor).toBe("phone");
    expect(document.querySelector('[data-testid="toolbar-image"]')).not.toBe(
      null,
    );
  });

  it("hides the image tool on the phone layout too", async () => {
    await renderWithFlags({ images: false });
    h.app.refreshEditorInterface();

    expect(h.app.editorInterface.formFactor).toBe("phone");
    expect(document.querySelector('[data-testid="toolbar-image"]')).toBe(null);
  });
});
