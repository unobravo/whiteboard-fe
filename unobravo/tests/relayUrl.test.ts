import { getRelayUrl, resetRelayUrlForTests } from "../collab/relayUrl";

const FALLBACK = import.meta.env.VITE_APP_WS_SERVER_URL;

/**
 * `import.meta.env.DEV` is true under vitest, same as it is for `vite`/`vite
 * preview` — so the module's dev short-circuit is what every test here
 * actually exercises unless it is stubbed off.
 */
describe("getRelayUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv("DEV", true);
    resetRelayUrlForTests();
  });

  it("uses the build-time env var in dev, without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await getRelayUrl()).toBe(FALLBACK);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads /ws-config.json outside dev", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ wsServerUrl: "https://relay.example.com" }),
      }),
    );

    expect(await getRelayUrl()).toBe("https://relay.example.com");
  });

  it("falls back to the env var when the file is missing", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    expect(await getRelayUrl()).toBe(FALLBACK);
  });

  it("falls back to the env var when the request throws", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    expect(await getRelayUrl()).toBe(FALLBACK);
  });

  it("falls back to the env var when the file has no usable URL", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    expect(await getRelayUrl()).toBe(FALLBACK);
  });

  it("memoizes: a second call does not fetch again", async () => {
    vi.stubEnv("DEV", false);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wsServerUrl: "https://relay.example.com" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await getRelayUrl();
    await getRelayUrl();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
