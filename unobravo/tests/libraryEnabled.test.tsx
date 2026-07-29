import React from "react";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";
import { actionAddToLibrary } from "@excalidraw/excalidraw/actions/actionAddToLibrary";
import { CommandPalette, Excalidraw } from "@excalidraw/excalidraw/index";
import {
  act,
  fireEvent,
  render,
  waitFor,
  withExcalidrawDimensions,
} from "@excalidraw/excalidraw/tests/test-utils";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

const { h } = window;

/**
 * Covers the `libraryEnabled` prop added in `packages/excalidraw`.
 *
 * The prop is modelled on upstream's `aiEnabled` and is a candidate to send
 * upstream (see `unobravo/FORK.md`), so these tests are written against the
 * public component rather than against our gating layer.
 *
 * Each case asserts the *affordance* is gone, not that a prop was threaded
 * through: hiding the tab while leaving the command palette entry or the
 * context-menu action live would be a silent leak.
 */
const openDefaultSidebar = () =>
  act(() => {
    h.setState({
      openSidebar: { name: DEFAULT_SIDEBAR.name, tab: CANVAS_SEARCH_TAB },
    });
  });

describe("libraryEnabled", () => {
  it("shows the library tab by default", async () => {
    await render(<Excalidraw />);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      openDefaultSidebar();

      await waitFor(() => {
        expect(document.querySelector(".default-sidebar")).not.toBe(null);
      });

      expect(document.querySelectorAll(".sidebar-tab-trigger")).toHaveLength(2);
    });
  });

  it("removes the library tab and its trigger when disabled", async () => {
    await render(<Excalidraw libraryEnabled={false} />);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      openDefaultSidebar();

      await waitFor(() => {
        expect(document.querySelector(".default-sidebar")).not.toBe(null);
      });

      expect(document.querySelectorAll(".sidebar-tab-trigger")).toHaveLength(1);
      expect(document.querySelector('[data-testid="library"]')).toBe(null);
      expect(document.querySelector('[data-testid="search"]')).not.toBe(null);
    });
  });

  it("opens the sidebar on the search tab when the library is disabled", async () => {
    await render(<Excalidraw libraryEnabled={false} />);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      const trigger = await waitFor(() => {
        const el = document.querySelector<HTMLElement>(
          ".default-sidebar-trigger",
        );
        expect(el).not.toBe(null);
        return el!;
      });

      act(() => {
        trigger.click();
      });

      // upstream's default tab is the library one, which no longer exists
      await waitFor(() => {
        expect(h.state.openSidebar?.tab).toBe(CANVAS_SEARCH_TAB);
      });
    });
  });

  it("keeps 'Add to library' available by default", async () => {
    await render(<Excalidraw />);

    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    API.setSelectedElements([rect]);

    expect(h.app.actionManager.isActionEnabled(actionAddToLibrary)).toBe(true);
  });

  it("disables 'Add to library' when the library is disabled", async () => {
    await render(<Excalidraw libraryEnabled={false} />);

    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    API.setSelectedElements([rect]);

    expect(h.app.actionManager.isActionEnabled(actionAddToLibrary)).toBe(false);
  });

  const openPaletteAndSearch = async (query: string) => {
    act(() => {
      h.setState({ openDialog: { name: "commandPalette" } });
    });

    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        ".command-palette-dialog input",
      );
      expect(el).not.toBe(null);
      return el!;
    });

    fireEvent.change(input, { target: { value: query } });

    return () =>
      Array.from(document.querySelectorAll(".command-item")).map(
        (item) => item.textContent ?? "",
      );
  };

  it("offers the library command by default", async () => {
    await render(
      <Excalidraw>
        <CommandPalette />
      </Excalidraw>,
    );

    const matches = await openPaletteAndSearch("library");

    await waitFor(() => {
      expect(matches().some((label) => /library/i.test(label))).toBe(true);
    });
  });

  it("drops the library command when the library is disabled", async () => {
    await render(
      <Excalidraw libraryEnabled={false}>
        <CommandPalette />
      </Excalidraw>,
    );

    // searching for something that still exists first, so the absence below is
    // evidence about the library command and not about a palette that failed
    // to open or a renamed selector — `.some()` on an empty list is `false`
    const zoomMatches = await openPaletteAndSearch("zoom");
    await waitFor(() => {
      expect(zoomMatches().length).toBeGreaterThan(0);
    });

    const matches = await openPaletteAndSearch("library");
    await waitFor(() => {
      expect(document.querySelector(".no-match")).not.toBe(null);
    });
    expect(matches().some((label) => /library/i.test(label))).toBe(false);
  });

  describe("library writes", () => {
    const libraryItem = {
      id: "unobravo-test-item",
      status: "unpublished" as const,
      elements: [API.createElement({ type: "rectangle" })],
      created: 1,
    };

    it("stores an item and opens the sidebar by default", async () => {
      await render(<Excalidraw />);

      await act(async () => {
        await h.app.library.updateLibrary({
          libraryItems: [libraryItem],
          openLibraryMenu: true,
        });
      });

      expect(await h.app.library.getLatestLibrary()).toHaveLength(1);
      expect(h.state.openSidebar).toEqual({
        name: DEFAULT_SIDEBAR.name,
        tab: "library",
      });
    });

    it("refuses the write when the library is disabled", async () => {
      await render(<Excalidraw libraryEnabled={false} />);

      await act(async () => {
        await h.app.library.updateLibrary({
          libraryItems: [libraryItem],
          openLibraryMenu: true,
        });
      });

      // nothing stored in a place the user can no longer see...
      expect(await h.app.library.getLatestLibrary()).toHaveLength(0);
      // ...and no sidebar jammed onto a tab that no longer renders
      expect(h.state.openSidebar).toBe(null);
    });

    it("resolves rather than rejecting, so uncatching callers do not blow up", async () => {
      await render(<Excalidraw libraryEnabled={false} />);

      await expect(
        h.app.library.updateLibrary({ libraryItems: [libraryItem] }),
      ).resolves.toEqual([]);
    });
  });

  describe("restored sidebar state", () => {
    const withLibraryTabOpen = {
      appState: {
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "library" as const },
      },
    };

    it("keeps a restored library tab open by default", async () => {
      await render(<Excalidraw initialData={withLibraryTabOpen} />);

      await waitFor(() => {
        expect(h.state.openSidebar?.tab).toBe("library");
      });
    });

    it("closes a restored library tab when the library is disabled", async () => {
      // upstream's default sidebar tab is the library one and excalidraw-app
      // persists `openSidebar`, so without this clamp every existing user gets
      // an empty docked panel the first time a gated build loads
      await render(
        <Excalidraw libraryEnabled={false} initialData={withLibraryTabOpen} />,
      );

      await waitFor(() => {
        expect(h.state.openSidebar).toBe(null);
      });

      expect(document.querySelector(".default-sidebar")).toBe(null);
    });
  });
});
