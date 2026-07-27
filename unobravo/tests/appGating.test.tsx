import {
  act,
  render,
  toggleMenu,
} from "@excalidraw/excalidraw/tests/test-utils";

import { appJotaiStore, Provider } from "../../excalidraw-app/app-jotai";
import { AppMainMenu } from "../../excalidraw-app/components/AppMainMenu";
import { AppWelcomeScreen } from "../../excalidraw-app/components/AppWelcomeScreen";
import {
  ShareDialog,
  shareDialogStateAtom,
} from "../../excalidraw-app/share/ShareDialog";
import { UnobravoExcalidraw } from "../components/UnobravoExcalidraw";
import { DEFAULT_FEATURE_FLAGS } from "../config/featureFlags";
import {
  INERT_INTEGRATION,
  UnobravoIntegrationContext,
} from "../hooks/useUnobravoIntegration";

import type { UnobravoFeatureFlags } from "../types";

/**
 * The app supplies its own `<MainMenu>` / `<WelcomeScreen>`, which bypass the
 * editor's own `UIOptions` gating — so these surfaces need their own coverage.
 */
const renderAppUIWithFlags = async (
  overrides: Partial<UnobravoFeatureFlags>,
) => {
  await render(
    <UnobravoIntegrationContext.Provider
      value={{
        ...INERT_INTEGRATION,
        enabled: true,
        flags: { ...DEFAULT_FEATURE_FLAGS, ...overrides },
      }}
    >
      <UnobravoExcalidraw>
        <AppMainMenu
          onCollabDialogOpen={() => {}}
          isCollaborating={false}
          isCollabEnabled={false}
          theme="light"
          refresh={() => {}}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={() => {}}
          isCollabEnabled={false}
        />
      </UnobravoExcalidraw>
    </UnobravoIntegrationContext.Provider>,
  );

  // the main menu's items only mount once the dropdown is open
  toggleMenu(document.querySelector(".excalidraw")!);
};

const queryMenuItem = (testId: string) =>
  document.querySelector(`[data-testid="${testId}"]`);

const welcomeScreenItemLabels = () =>
  Array.from(document.querySelectorAll(".welcome-screen-menu-item__text")).map(
    (element) => element.textContent,
  );

describe("app-level feature gating", () => {
  it("renders the export and image-export menu items by default", async () => {
    await renderAppUIWithFlags({});

    expect(queryMenuItem("json-export-button")).not.toBe(null);
    expect(queryMenuItem("image-export-button")).not.toBe(null);
  });

  it("hides the JSON export menu item when export is off", async () => {
    await renderAppUIWithFlags({ export: false });

    expect(queryMenuItem("json-export-button")).toBe(null);
    expect(queryMenuItem("image-export-button")).not.toBe(null);
  });

  it("hides the image export menu item when it is off", async () => {
    await renderAppUIWithFlags({ saveAsImage: false });

    expect(queryMenuItem("image-export-button")).toBe(null);
    expect(queryMenuItem("json-export-button")).not.toBe(null);
  });

  it("keeps the 'open file' entries by default", async () => {
    await renderAppUIWithFlags({});

    // the main-menu item self-gates on the action, the welcome-screen one
    // does not (it bypasses predicates), so both are checked
    expect(queryMenuItem("load-button")).not.toBe(null);
    expect(welcomeScreenItemLabels()).toContain("Open");
  });

  it("hides both 'open file' entries when loading files is off", async () => {
    await renderAppUIWithFlags({ loadFromFile: false });

    expect(queryMenuItem("load-button")).toBe(null);
    expect(welcomeScreenItemLabels()).not.toContain("Open");
    // the rest of the welcome screen is untouched
    expect(welcomeScreenItemLabels().length).toBeGreaterThan(0);
  });
});

describe("share dialog gating", () => {
  const renderShareDialog = async (
    overrides: Partial<UnobravoFeatureFlags>,
  ) => {
    await render(
      <Provider store={appJotaiStore}>
        <UnobravoIntegrationContext.Provider
          value={{
            ...INERT_INTEGRATION,
            enabled: true,
            flags: { ...DEFAULT_FEATURE_FLAGS, ...overrides },
          }}
        >
          <UnobravoExcalidraw>
            <ShareDialog collabAPI={null} onExportToBackend={() => {}} />
          </UnobravoExcalidraw>
        </UnobravoIntegrationContext.Provider>
      </Provider>,
    );

    act(() => {
      appJotaiStore.set(shareDialogStateAtom, { isOpen: true, type: "share" });
    });
  };

  it("offers the shareable link by default", async () => {
    await renderShareDialog({});

    expect(document.querySelector(".ShareDialog")).not.toBe(null);
    expect(document.querySelector(".ShareDialog__picker__button")).not.toBe(
      null,
    );
  });

  it("offers no shareable link when share links are off", async () => {
    await renderShareDialog({ shareLinks: false });

    expect(document.querySelector(".ShareDialog")).not.toBe(null);
    expect(document.querySelector(".ShareDialog__picker__button")).toBe(null);
    expect(document.querySelector(".ShareDialog__separator")).toBe(null);
  });
});
