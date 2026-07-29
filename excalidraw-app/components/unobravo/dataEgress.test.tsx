import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import { UnobravoFeaturesProvider } from "../../../unobravo";

import ExcalidrawApp from "../../App";

import type { UnobravoFeatures } from "../../../unobravo";

const { h } = window;

Object.defineProperty(window, "crypto", {
  value: {
    getRandomValues: (arr: number[]) =>
      arr.forEach((v, i) => (arr[i] = Math.floor(Math.random() * 256))),
    subtle: {
      generateKey: () => {},
      exportKey: () => ({ k: "sTdLvMC_M3V8_vGa3UVRDg" }),
      // the positive control below actually reaches the decode path, so the
      // stub has to get far enough not to leave an unhandled rejection behind
      importKey: async () => ({}),
      decrypt: async () => new TextEncoder().encode("{}").buffer,
    },
  },
});

const socketFactory = vi.fn(() => ({
  close: () => {},
  on: () => {},
  once: () => {},
  off: () => {},
  emit: () => {},
}));

vi.mock("socket.io-client", () => ({
  default: (...args: unknown[]) => socketFactory(...(args as [])),
}));

/**
 * `collaboration` and `shareLinks` are the two flags that carry user content
 * off-device: live collaboration relays the scene through the websocket server
 * and persists it (and its images) to Firebase, and a shareable link POSTs the
 * whole scene to the share backend.
 *
 * So these tests assert the *network*, not the buttons. A gate on the trigger
 * alone would leave a bookmarked `#room=` or `#json=` link working, which is
 * precisely the failure this suite is here to catch.
 */
const EXCALIDRAW_HOSTS = /excalidraw\.com|googleapis\.com|firebaseio\.com/;

const renderApp = async (features: Partial<UnobravoFeatures>) =>
  render(
    <UnobravoFeaturesProvider features={features}>
      <ExcalidrawApp />
    </UnobravoFeaturesProvider>,
  );

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
    socketFactory.mockClear();
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    setHash("");
  });

  /**
   * Every URL the app tried to fetch.
   *
   * Asserting on the *host* alone would be vacuous here: the suite runs with
   * `.env.test`, which sets no backend URLs, so `VITE_APP_BACKEND_V2_GET_URL`
   * is `undefined` and the share request goes to the string `"undefined…"`.
   * A host filter would therefore pass even against an app that happily calls
   * the backend. So the assertions below are on the request count, with the
   * host check kept as a second, narrower net.
   */
  const requestedUrls = () =>
    fetchSpy.mock.calls.map(([input]) => String(input));

  const requestedExcalidrawHosts = () =>
    requestedUrls().filter((url) => EXCALIDRAW_HOSTS.test(url));

  it("ignores a #json= share link when share links are gated off", async () => {
    setHash("#json=abc123,deadbeefdeadbeefdeadbe");

    await renderApp({ shareLinks: false, collaboration: false });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    expect(requestedUrls()).toEqual([]);
    expect(requestedExcalidrawHosts()).toEqual([]);
    // the address bar must stop advertising a scene we will never load
    expect(window.location.hash).toBe("");
  });

  it("ignores a #room= link and never opens a socket when collaboration is gated off", async () => {
    setHash("#room=abcdefghij,0123456789012345678901");

    await renderApp({ shareLinks: false, collaboration: false });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    expect(socketFactory).not.toHaveBeenCalled();
    expect(requestedUrls()).toEqual([]);
    expect(window.location.hash).toBe("");
    // and the app must not paint itself as collaborating
    expect(document.querySelector(".is-collaborating")).toBe(null);
  });

  it("leaves an unrelated hash alone", async () => {
    // `#addLibrary=` and element links must survive the room/share strip
    setHash("#addLibrary=https%3A%2F%2Fexample.com%2Fa.excalidrawlib");

    await renderApp({
      shareLinks: false,
      collaboration: false,
      library: false,
    });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    expect(window.location.hash).toContain("addLibrary");
    expect(requestedUrls()).toEqual([]);
  });

  it("still fetches a #json= share link when share links are enabled", async () => {
    // the positive control: without it, the assertions above would also pass
    // against an app that simply never loads a scene
    setHash("#json=abc123,deadbeefdeadbeefdeadbe");

    // the mocked response is not a real encrypted payload, so the decode fails
    // and upstream logs it — expected here, and only noise
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await renderApp({ shareLinks: true, collaboration: false });

      await waitFor(() => {
        expect(requestedUrls().length).toBeGreaterThan(0);
      });
    } finally {
      consoleError.mockRestore();
    }
  });

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

  it("offers the share and collaboration commands when both are enabled", async () => {
    await renderApp({ shareLinks: true, collaboration: true });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    const collab = await paletteMatches("collaboration");
    await waitFor(() => {
      expect(collab().some((label) => /live collaboration/i.test(label))).toBe(
        true,
      );
    });

    const share = await paletteMatches("share");
    await waitFor(() => {
      expect(share().some((label) => /^share$/i.test(label.trim()))).toBe(true);
    });
  });

  it("drops both commands when the flags are off", async () => {
    await renderApp({ shareLinks: false, collaboration: false });

    await waitFor(() => {
      expect(h.app).toBeTruthy();
    });

    const collab = await paletteMatches("collaboration");
    await waitFor(() => {
      expect(document.querySelector(".command-palette-dialog")).not.toBe(null);
    });
    expect(collab().some((label) => /live collaboration/i.test(label))).toBe(
      false,
    );

    const share = await paletteMatches("share");
    expect(share().some((label) => /^share$/i.test(label.trim()))).toBe(false);
  });
});
