import {
  DEFAULT_FEATURE_FLAGS,
  resolveFeatureFlags,
} from "../config/featureFlags";
import { readUnobravoConfig } from "../config/integrationConfig";

describe("resolveFeatureFlags", () => {
  it("enables everything by default, so an unconfigured build is upstream", () => {
    expect(resolveFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(
      Object.values(DEFAULT_FEATURE_FLAGS).every((value) => value === true),
    ).toBe(true);
  });

  it("reads build-time defaults from the env", () => {
    const flags = resolveFeatureFlags({
      env: {
        VITE_APP_UNOBRAVO_ENABLE_IMAGES: "false",
        VITE_APP_UNOBRAVO_ENABLE_AI: "FALSE",
        VITE_APP_UNOBRAVO_ENABLE_EXPORT: "true",
      },
    });

    expect(flags.images).toBe(false);
    expect(flags.ai).toBe(false);
    expect(flags.export).toBe(true);
    expect(flags.collaboration).toBe(true);
  });

  it("ignores env values that are neither true nor false", () => {
    const flags = resolveFeatureFlags({
      env: {
        VITE_APP_UNOBRAVO_ENABLE_IMAGES: "",
        VITE_APP_UNOBRAVO_ENABLE_AI: "nope",
      },
    });

    expect(flags.images).toBe(true);
    expect(flags.ai).toBe(true);
  });

  it("accepts booleans, since import.meta.env exposes some as such", () => {
    expect(
      resolveFeatureFlags({
        env: { VITE_APP_UNOBRAVO_ENABLE_IMAGES: false },
      }).images,
    ).toBe(false);
  });

  it("ignores query overrides unless they are explicitly allowed", () => {
    expect(resolveFeatureFlags({ search: "?ubImages=false" }).images).toBe(
      true,
    );
  });

  it("lets the query string override the env when allowed", () => {
    const flags = resolveFeatureFlags({
      env: { VITE_APP_UNOBRAVO_ENABLE_IMAGES: "false" },
      search: "?ubImages=true&ubAi=false",
      allowOverrides: true,
    });

    expect(flags.images).toBe(true);
    expect(flags.ai).toBe(false);
  });
});

describe("readUnobravoConfig", () => {
  it("is disabled unless a known mode is configured", () => {
    expect(readUnobravoConfig().mode).toBe("disabled");
    expect(
      readUnobravoConfig({ env: { VITE_APP_UNOBRAVO_AUTH_MODE: "bogus" } })
        .mode,
    ).toBe("disabled");
    expect(
      readUnobravoConfig({ env: { VITE_APP_UNOBRAVO_AUTH_MODE: " Parent " } })
        .mode,
    ).toBe("parent");
  });

  it("parses the parent origin allowlist", () => {
    expect(
      readUnobravoConfig({
        env: {
          VITE_APP_UNOBRAVO_PARENT_ORIGINS:
            "https://app.unobravo.com, https://staging.unobravo.com ,",
        },
      }).parentOrigins,
    ).toEqual(["https://app.unobravo.com", "https://staging.unobravo.com"]);

    expect(readUnobravoConfig().parentOrigins).toEqual([]);
  });

  it("falls back to a sane timeout", () => {
    expect(readUnobravoConfig().authTimeoutMs).toBe(10_000);
    expect(
      readUnobravoConfig({
        env: { VITE_APP_UNOBRAVO_AUTH_TIMEOUT_MS: "-1" },
      }).authTimeoutMs,
    ).toBe(10_000);
    expect(
      readUnobravoConfig({
        env: { VITE_APP_UNOBRAVO_AUTH_TIMEOUT_MS: "2500" },
      }).authTimeoutMs,
    ).toBe(2500);
  });

  it("allows query overrides in dev without an explicit opt-in", () => {
    expect(
      readUnobravoConfig({ env: { DEV: true }, search: "?ubAi=false" }).flags
        .ai,
    ).toBe(false);
  });

  it("allows query overrides in prod only behind the opt-in", () => {
    expect(
      readUnobravoConfig({
        env: { VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES: "true" },
        search: "?ubAi=false",
      }).flags.ai,
    ).toBe(false);

    expect(
      readUnobravoConfig({ env: {}, search: "?ubAi=false" }).flags.ai,
    ).toBe(true);
  });
});
