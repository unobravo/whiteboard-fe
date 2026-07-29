import { DEFAULT_FEATURES } from "../config/features";

import type { UnobravoFeatures } from "../config/features";

/**
 * `RESOLVED_FEATURES` is the only thing production actually reads — no provider
 * is ever mounted, so every consumer falls through to the context default.
 * Testing the overlays through a provider therefore proves nothing about the
 * shipped build: rename an env var in `ENV_VAR_BY_FEATURE` and every other test
 * still passes while the gate is dead.
 *
 * These tests exercise the real module-scope resolution.
 */
const loadResolvedFeatures = async (
  search: string,
): Promise<UnobravoFeatures> => {
  const original = window.location.search;

  // jsdom's location is not writable, so replace it wholesale for the duration
  Object.defineProperty(window, "location", {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  });

  try {
    vi.resetModules();
    const module = await import("../hooks/useUnobravoFeatures");
    return module.RESOLVED_FEATURES;
  } finally {
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: original },
      writable: true,
      configurable: true,
    });
  }
};

describe("RESOLVED_FEATURES", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("matches upstream when nothing is configured", async () => {
    expect(await loadResolvedFeatures("")).toEqual(DEFAULT_FEATURES);
  });

  it("reads the env var names the .env files actually use", async () => {
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_PLUS", "false");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_AI", "false");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_LIBRARY", "false");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_SOCIALS", "false");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_COLLABORATION", "false");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS", "false");

    expect(await loadResolvedFeatures("")).toEqual({
      plus: false,
      ai: false,
      library: false,
      socials: false,
      collaboration: false,
      shareLinks: false,
    });
  });

  it("honours query-string overrides in dev", async () => {
    // the suite runs with MODE=test, which `isDevEnv()` does not consider dev,
    // so opt in the same way a non-production build would
    vi.stubEnv("VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES", "true");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_PLUS", "false");

    expect((await loadResolvedFeatures("?ubPlus=true")).plus).toBe(true);
  });

  it("ignores query-string overrides without the opt-in", async () => {
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_PLUS", "false");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_LIBRARY", "false");

    const features = await loadResolvedFeatures(
      "?ubPlus=true&ubLibrary=true&ubAi=true",
    );

    // this is the expression that stops an end user re-enabling a gated
    // feature from the URL bar in production
    expect(features.plus).toBe(false);
    expect(features.library).toBe(false);
  });

  it("treats a value that is neither true nor false as unset", async () => {
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_PLUS", "");
    vi.stubEnv("VITE_APP_UNOBRAVO_ENABLE_AI", "0");

    const features = await loadResolvedFeatures("");

    expect(features.plus).toBe(true);
    expect(features.ai).toBe(true);
  });

  it("is frozen, so no consumer can flip a flag at runtime", async () => {
    const features = await loadResolvedFeatures("");

    expect(Object.isFrozen(features)).toBe(true);
  });
});
