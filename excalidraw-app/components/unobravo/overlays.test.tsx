import React from "react";

import { Excalidraw } from "@excalidraw/excalidraw/index";
import {
  act,
  render,
  waitFor,
  withExcalidrawDimensions,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import { UnobravoFooter } from "./UnobravoFooter";
import { UnobravoMainMenu } from "./UnobravoMainMenu";
import { UnobravoWelcomeScreen } from "./UnobravoWelcomeScreen";

/**
 * The flags are a plain object, so a test varies them by mocking the module
 * rather than by wrapping the tree in a provider. `Object.assign` on the shared
 * object works because every consumer reads `FEATURES.x` at render time.
 */
const mocked = vi.hoisted(() => ({
  FEATURES: {
    plus: true,
    ai: true,
    library: true,
    socials: true,
    shareLinks: true,
  },
}));

vi.mock("../../../unobravo", () => mocked);

const withFeatures = (overrides: Partial<typeof mocked.FEATURES>) => {
  Object.assign(mocked.FEATURES, {
    plus: true,
    ai: true,
    library: true,
    socials: true,
    shareLinks: true,
    ...overrides,
  });
};

/**
 * The overlays are the level-2 mechanism: our own copies of the three app-shell
 * components, swapped in by a single import in `excalidraw-app/App.tsx`.
 *
 * Two properties matter and both are asserted here:
 *
 *   - with every flag on, the overlay renders what upstream renders, so an
 *     unconfigured build is indistinguishable from upstream;
 *   - with a flag off, the affordance is actually gone from the DOM — not
 *     merely hidden behind a prop nobody reads.
 */
const renderShell = async (
  features: Partial<typeof mocked.FEATURES>,
  children: React.ReactNode,
) => {
  withFeatures(features);
  return render(<Excalidraw>{children}</Excalidraw>);
};

const openMainMenu = async () => {
  const trigger = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(
      ".dropdown-menu-button, .main-menu-trigger",
    );
    expect(el).not.toBe(null);
    return el!;
  });

  act(() => {
    trigger.click();
  });

  return waitFor(() => {
    const menu = document.querySelector(".dropdown-menu");
    expect(menu).not.toBe(null);
    return menu!;
  });
};

const menuText = (menu: Element) => menu.textContent ?? "";

const mainMenu = (
  <UnobravoMainMenu
    onCollabDialogOpen={() => {}}
    isCollaborating={false}
    isCollabEnabled={false}
    theme="light"
    refresh={() => {}}
  />
);

describe("UnobravoMainMenu", () => {
  it("keeps the Excalidraw+ and social entries when nothing is gated", async () => {
    await renderShell({}, mainMenu);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      const menu = await openMainMenu();

      expect(menuText(menu)).toContain("Excalidraw+");
      expect(menuText(menu)).toContain("Sign up");
      expect(menu.querySelector('a[href*="github.com"]')).not.toBe(null);
    });
  });

  it("removes the Excalidraw+ entries when plus is off", async () => {
    await renderShell({ plus: false }, mainMenu);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      const menu = await openMainMenu();

      expect(menuText(menu)).not.toContain("Excalidraw+");
      expect(menuText(menu)).not.toContain("Sign up");
      expect(menu.querySelector('a[href*="plus.excalidraw.com"]')).toBe(null);
      expect(menu.querySelector('a[href*="app.excalidraw.com"]')).toBe(null);
    });
  });

  it("removes the social links when socials are off", async () => {
    await renderShell({ socials: false }, mainMenu);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      const menu = await openMainMenu();

      expect(menu.querySelector('a[href*="github.com"]')).toBe(null);
      expect(menu.querySelector('a[href*="discord"]')).toBe(null);
      expect(menu.querySelector('a[href*="x.com"]')).toBe(null);
    });
  });

  it("keeps the non-commercial entries in every configuration", async () => {
    await renderShell(
      { plus: false, socials: false, ai: false, library: false },
      mainMenu,
    );

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      const menu = await openMainMenu();

      // the menu must still be a usable menu, not a stub
      expect(
        menu.querySelectorAll(".dropdown-menu-item").length,
      ).toBeGreaterThan(5);
    });
  });
});

describe("UnobravoWelcomeScreen", () => {
  const welcomeScreen = (
    <UnobravoWelcomeScreen
      onCollabDialogOpen={() => {}}
      isCollabEnabled={false}
    />
  );

  it("offers the sign-up link when nothing is gated", async () => {
    await renderShell({}, welcomeScreen);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await waitFor(() => {
        expect(document.querySelector(".welcome-screen-center")).not.toBe(null);
      });

      expect(document.body.textContent).toContain("Sign up");
    });
  });

  it("removes the sign-up link when plus is off", async () => {
    await renderShell({ plus: false }, welcomeScreen);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await waitFor(() => {
        expect(document.querySelector(".welcome-screen-center")).not.toBe(null);
      });

      expect(document.body.textContent).not.toContain("Sign up");
      expect(document.querySelector('a[href*="plus.excalidraw.com"]')).toBe(
        null,
      );
    });
  });
});

describe("UnobravoFooter", () => {
  const footer = <UnobravoFooter onChange={() => {}} />;

  it("shows the encryption shield when nothing is gated", async () => {
    await renderShell({}, footer);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await waitFor(() => {
        expect(
          document.querySelector('a[href*="plus.excalidraw.com/blog"]'),
        ).not.toBe(null);
      });
    });
  });

  it("removes the link out to Excalidraw's blog when socials are off", async () => {
    await renderShell({ socials: false }, footer);

    await withExcalidrawDimensions({ width: 1920, height: 1080 }, async () => {
      await waitFor(() => {
        expect(document.querySelector(".layer-ui__wrapper__footer")).not.toBe(
          null,
        );
      });

      expect(document.querySelector('a[href*="plus.excalidraw.com"]')).toBe(
        null,
      );
    });
  });
});
