import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";

import type { AppState } from "@excalidraw/excalidraw/types";

import { clearUnrenderableSidebar } from "../../data/LocalData";

/**
 * The editor clamps a restored library tab when it initialises, but the write
 * path has to agree with it: a second tab syncing from localStorage would
 * otherwise re-inject `{name: "default", tab: "library"}` into a build that no
 * longer renders that tab, and the user would get a blank docked panel.
 *
 * `saveDataStateToLocalStorage` reads the frozen module-scope flags, which no
 * test can vary, so the decision is factored out and tested here directly.
 */
const withSidebar = (tab: string | null) =>
  ({
    openSidebar: tab === null ? null : { name: DEFAULT_SIDEBAR.name, tab },
  } as unknown as Pick<AppState, "openSidebar">);

describe("clearUnrenderableSidebar", () => {
  it("keeps the library tab while the library is enabled", () => {
    expect(
      clearUnrenderableSidebar(withSidebar("library"), true).openSidebar,
    ).toEqual({ name: DEFAULT_SIDEBAR.name, tab: "library" });
  });

  it("drops the library tab once the library is disabled", () => {
    expect(
      clearUnrenderableSidebar(withSidebar("library"), false).openSidebar,
    ).toBe(null);
  });

  it("never persists the search tab, either way", () => {
    for (const libraryEnabled of [true, false]) {
      expect(
        clearUnrenderableSidebar(withSidebar(CANVAS_SEARCH_TAB), libraryEnabled)
          .openSidebar,
      ).toBe(null);
    }
  });

  it("leaves a host-supplied sidebar alone", () => {
    const custom = {
      openSidebar: { name: "unobravo-notes", tab: "library" },
    } as unknown as Pick<AppState, "openSidebar">;

    expect(clearUnrenderableSidebar(custom, false).openSidebar).toEqual({
      name: "unobravo-notes",
      tab: "library",
    });
  });

  it("tolerates a closed sidebar", () => {
    expect(clearUnrenderableSidebar(withSidebar(null), false).openSidebar).toBe(
      null,
    );
  });
});
