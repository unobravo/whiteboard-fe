import { AUTH_RESPONSE_TYPE, parseAuthResponse } from "../auth/messages";
import { createParentAuthProvider } from "../auth/parentAuthProvider";

import type { UnobravoAuthState } from "../types";

const HOST_ORIGIN = "https://app.unobravo.com";

type PostedMessage = { data: unknown; targetOrigin: string };

/**
 * Stands in for the embedding page: `window.parent` must be a *different*
 * object than `window`, otherwise the provider correctly refuses to run.
 */
const mockParent = (posted: PostedMessage[]) => {
  const parent = {
    postMessage: (data: unknown, targetOrigin: string) => {
      posted.push({ data, targetOrigin });
    },
  };

  vi.spyOn(window, "parent", "get").mockReturnValue(
    parent as unknown as Window,
  );

  return parent;
};

/** Delivers a message as if it came from the host page. */
const deliver = ({
  data,
  origin = HOST_ORIGIN,
  source,
}: {
  data: unknown;
  origin?: string;
  source?: unknown;
}) => {
  const event = new MessageEvent("message", { data, origin });

  Object.defineProperty(event, "source", {
    value: source ?? window.parent,
  });

  window.dispatchEvent(event);
};

const authenticate = (
  overrides: {
    parentOrigins?: readonly string[];
    timeoutMs?: number;
    boardId?: string | null;
  } = {},
): { result: Promise<UnobravoAuthState>; abort: () => void } => {
  const controller = new AbortController();

  const provider = createParentAuthProvider({
    parentOrigins: overrides.parentOrigins ?? [HOST_ORIGIN],
    timeoutMs: overrides.timeoutMs ?? 10_000,
  });

  return {
    result: provider.authenticate({
      boardId: overrides.boardId ?? "board-1",
      signal: controller.signal,
    }),
    abort: () => controller.abort(),
  };
};

describe("parseAuthResponse", () => {
  it("ignores messages that are not addressed to it", () => {
    expect(parseAuthResponse(null)).toBeNull();
    expect(parseAuthResponse("nope")).toBeNull();
    expect(parseAuthResponse({ type: "other" })).toBeNull();
  });

  it("flags a message addressed to it but unusable as malformed", () => {
    // a host integration bug, distinct from "not our message"
    expect(parseAuthResponse({ type: AUTH_RESPONSE_TYPE })).toBe("malformed");
  });

  it("flags a success payload without a usable token or user", () => {
    expect(
      parseAuthResponse({
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        user: { id: "u" },
      }),
    ).toBe("malformed");
    expect(
      parseAuthResponse({ type: AUTH_RESPONSE_TYPE, ok: true, token: "t" }),
    ).toBe("malformed");
    expect(
      parseAuthResponse({
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "",
        user: { id: "u" },
      }),
    ).toBe("malformed");
    expect(
      parseAuthResponse({
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "t",
        user: { id: 42 },
      }),
    ).toBe("malformed");
  });

  it("accepts a well-formed success payload", () => {
    expect(
      parseAuthResponse({
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "t",
        user: { id: "u", email: "u@unobravo.com" },
      }),
    ).toEqual({
      type: AUTH_RESPONSE_TYPE,
      ok: true,
      token: "t",
      user: { id: "u", email: "u@unobravo.com" },
      requestId: undefined,
    });
  });
});

describe("createParentAuthProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fails closed when the allowlist is not configured", async () => {
    mockParent([]);

    const { result } = authenticate({ parentOrigins: [] });

    expect(await result).toEqual({
      status: "error",
      error: { code: "internal", message: expect.any(String) },
    });
  });

  it("fails closed when the app is not embedded", async () => {
    vi.spyOn(window, "parent", "get").mockReturnValue(window);

    const { result } = authenticate();

    expect((await result).status).toBe("error");
    expect(await result).toMatchObject({ error: { code: "not-embedded" } });
  });

  it("asks the host for the session, never with a wildcard target", async () => {
    const posted: PostedMessage[] = [];
    mockParent(posted);

    const { result, abort } = authenticate({ boardId: "board-42" });

    expect(posted).toHaveLength(1);
    expect(posted[0].targetOrigin).toBe(HOST_ORIGIN);
    expect(posted[0].data).toMatchObject({
      type: "unobravo:auth-request",
      boardId: "board-42",
    });

    abort();
    await result;
  });

  it("resolves with the user the host returns", async () => {
    const posted: PostedMessage[] = [];
    mockParent(posted);

    const { result } = authenticate();

    deliver({
      data: {
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "token-1",
        user: { id: "user-1", displayName: "Ada" },
      },
    });

    expect(await result).toEqual({
      status: "authenticated",
      token: "token-1",
      user: { id: "user-1", displayName: "Ada" },
    });
  });

  it("ignores responses from an origin that is not allowlisted", async () => {
    mockParent([]);
    vi.useFakeTimers();

    const { result } = authenticate({ timeoutMs: 1_000 });

    deliver({
      origin: "https://evil-unobravo.com",
      data: {
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "attacker",
        user: { id: "attacker" },
      },
    });

    vi.advanceTimersByTime(1_000);

    expect(await result).toMatchObject({ error: { code: "timeout" } });
  });

  it("ignores responses that do not come from the window it asked", async () => {
    mockParent([]);
    vi.useFakeTimers();

    const { result } = authenticate({ timeoutMs: 1_000 });

    deliver({
      source: { postMessage: () => {} },
      data: {
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "attacker",
        user: { id: "attacker" },
      },
    });

    vi.advanceTimersByTime(1_000);

    expect(await result).toMatchObject({ error: { code: "timeout" } });
  });

  it("ignores a reply that answers a different request", async () => {
    const posted: PostedMessage[] = [];
    mockParent(posted);
    vi.useFakeTimers();

    const { result } = authenticate({ timeoutMs: 1_000 });

    deliver({
      data: {
        type: AUTH_RESPONSE_TYPE,
        ok: true,
        token: "stale",
        user: { id: "stale" },
        requestId: "unobravo-auth-does-not-exist",
      },
    });

    vi.advanceTimersByTime(1_000);

    expect(await result).toMatchObject({ error: { code: "timeout" } });
  });

  it("fails with an error, not a rejection, if postMessage throws", async () => {
    // e.g. a target origin the browser rejects; a rejection here would leave
    // the provider's caller on a loading screen with no way out
    vi.spyOn(window, "parent", "get").mockReturnValue({
      postMessage: () => {
        throw new SyntaxError("invalid target origin");
      },
    } as unknown as Window);
    vi.useFakeTimers();

    const { result } = authenticate({ timeoutMs: 1_000 });

    vi.advanceTimersByTime(1_000);

    expect(await result).toMatchObject({ error: { code: "timeout" } });
  });

  it("reports a malformed host payload immediately, not as a timeout", async () => {
    mockParent([]);
    vi.useFakeTimers();

    const { result } = authenticate({ timeoutMs: 10_000 });

    deliver({
      data: { type: AUTH_RESPONSE_TYPE, ok: true, user: { id: "u" } },
    });

    // settles without waiting out the timeout
    expect(await result).toMatchObject({ error: { code: "internal" } });
  });

  it("reports the host's denial", async () => {
    mockParent([]);

    const { result } = authenticate();

    deliver({
      data: { type: AUTH_RESPONSE_TYPE, ok: false, code: "unauthorized" },
    });

    expect(await result).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("times out when the host never answers", async () => {
    mockParent([]);
    vi.useFakeTimers();

    const { result } = authenticate({ timeoutMs: 5_000 });

    vi.advanceTimersByTime(5_000);

    expect(await result).toMatchObject({ error: { code: "timeout" } });
  });

  it("keeps asking until the host is listening", async () => {
    const posted: PostedMessage[] = [];
    mockParent(posted);
    vi.useFakeTimers();

    const { result, abort } = authenticate({ timeoutMs: 5_000 });

    expect(posted).toHaveLength(1);

    vi.advanceTimersByTime(750);

    expect(posted.length).toBeGreaterThan(1);
    expect(new Set(posted.map((message) => message.targetOrigin))).toEqual(
      new Set([HOST_ORIGIN]),
    );

    abort();
    await result;
  });

  it("stops asking, and stops listening, once aborted", async () => {
    const posted: PostedMessage[] = [];
    mockParent(posted);
    vi.useFakeTimers();

    const { result, abort } = authenticate();

    abort();
    await result;

    const postedAfterAbort = posted.length;
    vi.advanceTimersByTime(2_000);

    expect(posted).toHaveLength(postedAfterAbort);
  });
});
