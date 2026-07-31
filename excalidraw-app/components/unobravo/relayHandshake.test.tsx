import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

import { resetRelayAuthForTests } from "../../../unobravo/collab/relayAuth";
import ExcalidrawApp from "../../App";
import { appJotaiStore } from "../../app-jotai";
import { collabAPIAtom } from "../../collab/Collab";

/**
 * The relay's authentication is carried by a single line in an upstream file —
 * `auth: getRelayAuth()` in `excalidraw-app/collab/Collab.tsx`. That is exactly
 * the kind of gate an upstream merge can drop while resolving cleanly: the
 * import survives, the property does not, and nothing else in the app notices
 * until collaboration stops connecting in an environment nobody tests by hand.
 *
 * So this asserts the options object `socket.io-client` is actually called
 * with, rather than that the token can be parsed — `unobravo/tests/relayAuth.test.ts`
 * already covers the parsing.
 */
const socketOptions: Array<Record<string, unknown>> = [];

vi.mock("socket.io-client", () => ({
  default: (_url: string, options: Record<string, unknown>) => {
    socketOptions.push(options);

    return {
      close: () => {},
      on: () => {},
      once: () => {},
      off: () => {},
      emit: () => {},
      id: "socket-1",
    };
  },
}));

vi.mock("../../data/firebase.ts", () => ({
  loadFromFirebase: async () => null,
  saveToFirebase: () => {},
  isSavedToFirebase: () => true,
  loadFilesFromFirebase: async () => ({ loadedFiles: [], erroredFiles: [] }),
  saveFilesToFirebase: async () => ({
    savedFiles: new Map(),
    erroredFiles: new Map(),
  }),
}));

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

/** Shaped like a JWT, and deliberately not one — nothing here verifies it. */
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJwYXRpZW50LTUifQ.a-b_c";

/**
 * Starts a session by calling `startCollaboration` rather than by opening a
 * `#room=` link. A room link makes `initializeScene` wait for the scene to
 * arrive over the socket, and the socket here is a mock that never emits, so the
 * app would sit in `isLoading` forever. Creating a room needs nothing back.
 */
const collaborateWith = async (search: string) => {
  window.history.replaceState({}, "", `/${search}`);

  // the token is read once and remembered, which is the whole point of it in
  // the app and a nuisance here — see the note on `cached` in
  // unobravo/collab/relayAuth.ts
  resetRelayAuthForTests();

  await render(<ExcalidrawApp />);

  const collabAPI = await waitFor(() => {
    const api = appJotaiStore.get(collabAPIAtom);
    expect(api).toBeTruthy();
    return api!;
  });

  // deliberately not awaited: the promise it returns resolves when the scene
  // arrives, either over the socket or on the `INITIAL_SCENE_UPDATE_TIMEOUT`
  // fallback, and the mocked socket emits nothing. The socket is opened well
  // before that, which is all this file is about.
  await act(async () => {
    void collabAPI.startCollaboration(null);
  });

  return waitFor(() => {
    expect(socketOptions.length).toBeGreaterThan(0);
    return socketOptions[socketOptions.length - 1];
  });
};

describe("relay handshake", () => {
  beforeEach(() => {
    socketOptions.length = 0;
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("sends the query-string token as socket.io auth", async () => {
    const options = await collaborateWith(`?ubToken=${TOKEN}`);

    expect(options.auth).toEqual({ token: TOKEN });

    // folded in here rather than given its own case, which would cost another
    // full app render: the relay rejects polling outright
    // (`{"code":0,"message":"Transport unknown"}`) and its handshake advertises
    // `upgrades: []`, so upstream's fallback is dead against it. Harmless while
    // websocket is tried first — which is what this pins.
    expect(options.transports).toEqual(["websocket", "polling"]);
  });

  it("sends no auth at all when there is no token", async () => {
    // not `{ token: "" }`: the relay answers "Authentication required" to a
    // missing credential and "Authentication failed" to an empty one, and the
    // first is the truthful error. An upstream excalidraw-room ignores `auth`
    // entirely, so this also keeps a local room server working.
    const options = await collaborateWith("");

    expect(options.auth).toBeUndefined();
    expect("auth" in options).toBe(true);
  });
});
