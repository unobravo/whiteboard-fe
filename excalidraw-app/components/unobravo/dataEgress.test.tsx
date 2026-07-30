import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import ExcalidrawApp from "../../App";

const { h } = window;

Object.defineProperty(window, "crypto", {
  value: {
    getRandomValues: (arr: number[]) =>
      arr.forEach((v, i) => (arr[i] = Math.floor(Math.random() * 256))),
    subtle: {
      generateKey: () => {},
      exportKey: () => ({ k: "sTdLvMC_M3V8_vGa3UVRDg" }),
      importKey: async () => ({}),
      decrypt: async () => new TextEncoder().encode("{}").buffer,
    },
  },
});

vi.mock("socket.io-client", () => ({
  default: () => ({
    close: () => {},
    on: () => {},
    once: () => {},
    off: () => {},
    emit: () => {},
  }),
}));

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
 * `shareLinks` and `ai` gate surfaces that would otherwise reach Excalidraw's
 * servers, so these assert the *network* rather than the buttons.
 *
 * Note what `shareLinks` does and does not cover. It stops the app offering to
 * publish a link — the export handler, the dialog section, the palette entry.
 * It does not stop the app *opening* one: a `#json=` link a user is sent still
 * loads, exactly as upstream, because collaboration is always enabled and leans
 * on the same backends anyway. The gate is about what the app produces, not
 * about refusing links a user already holds.
 */
const renderApp = async (features: Partial<typeof mocked.FEATURES>) => {
  withFeatures(features);
  return render(<ExcalidrawApp />);
};

const setHash = (hash: string) => {
  window.history.replaceState({}, "", `${window.location.pathname}${hash}`);
};

const spyOnFetch = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response("{}"));

describe("data egress", () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    setHash("");
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    setHash("");
  });

  const requestedUrls = () =>
    fetchSpy.mock.calls.map(([input]) => String(input));

  /**
   * Opens the command palette and returns the labels currently matching.
   *
   * Asserting against `document.body.textContent` without opening it would be
   * vacuous — `CommandPalette` renders `null` unless `openDialog` names it, so
   * the labels are absent whatever the flags say.
   */
  const paletteMatches = async (query: string) => {
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

  it("drops the share command when share links are gated off", async () => {
    await renderApp({ shareLinks: false });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    const share = await paletteMatches("share");
    await waitFor(() => {
      expect(document.querySelector(".command-palette-dialog")).not.toBe(null);
    });
    expect(share().some((label) => /^share$/i.test(label.trim()))).toBe(false);
  });

  it("offers it when they are enabled", async () => {
    // the positive control: without it the assertion above would also pass
    // against a palette that simply rendered nothing
    await renderApp({ shareLinks: true });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    const share = await paletteMatches("share");
    await waitFor(() => {
      expect(share().some((label) => /^share$/i.test(label.trim()))).toBe(true);
    });
  });

  it("makes no AI request and mounts no AI surface when ai is off", async () => {
    // AIComponents and TTDDialogTrigger both talk to VITE_APP_AI_BACKEND, so
    // this gets a network assertion rather than a button check
    await renderApp({ ai: false });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    expect(requestedUrls()).toEqual([]);
    expect(document.querySelector('[data-testid="ttd-dialog-trigger"]')).toBe(
      null,
    );

    const matches = await paletteMatches("diagram");
    expect(matches().some((label) => /text to diagram/i.test(label))).toBe(
      false,
    );
  });

  it("offers the AI surfaces when ai is on", async () => {
    await renderApp({ ai: true });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    const matches = await paletteMatches("diagram");
    await waitFor(() => {
      expect(matches().some((label) => /text to diagram/i.test(label))).toBe(
        true,
      );
    });
  });

  it("still loads a #json= link, which shareLinks deliberately does not gate", async () => {
    setHash("#json=abc123,deadbeefdeadbeefdeadbe");

    // the mocked response is not a real encrypted payload, so the decode fails
    // and upstream logs it — expected here, and only noise
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await renderApp({ shareLinks: false });

      await waitFor(() => {
        expect(requestedUrls().length).toBeGreaterThan(0);
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
