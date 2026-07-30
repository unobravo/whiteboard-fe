import {
  DEFAULT_FEATURES,
  FEATURE_NAMES,
  isUpstreamDefault,
  resolveFeatures,
} from "../config/features";

describe("resolveFeatures", () => {
  it("enables everything when nothing is configured", () => {
    expect(resolveFeatures()).toEqual(DEFAULT_FEATURES);
    expect(isUpstreamDefault(resolveFeatures())).toBe(true);
  });

  it("reads each flag from its own env var", () => {
    expect(
      resolveFeatures({
        env: {
          VITE_APP_UNOBRAVO_ENABLE_PLUS: "false",
          VITE_APP_UNOBRAVO_ENABLE_AI: "false",
          VITE_APP_UNOBRAVO_ENABLE_LIBRARY: "false",
          VITE_APP_UNOBRAVO_ENABLE_SOCIALS: "false",
          VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS: "false",
        },
      }),
    ).toEqual({
      plus: false,
      ai: false,
      library: false,
      socials: false,
      shareLinks: false,
    });
  });

  it("leaves the other flags alone when only one is set", () => {
    expect(
      resolveFeatures({ env: { VITE_APP_UNOBRAVO_ENABLE_PLUS: "false" } }),
    ).toEqual({ ...DEFAULT_FEATURES, plus: false });
  });

  it("accepts booleans and any casing, ignores everything else", () => {
    const cases: [unknown, boolean][] = [
      [false, false],
      [true, true],
      ["FALSE", false],
      ["  false  ", false],
      ["True", true],
    ];

    for (const [value, expected] of cases) {
      expect(
        resolveFeatures({ env: { VITE_APP_UNOBRAVO_ENABLE_PLUS: value } }).plus,
      ).toBe(expected);
    }

    // an unset or malformed var must not silently disable a feature
    for (const value of ["", "0", "no", "off", undefined, null, 0]) {
      expect(
        resolveFeatures({ env: { VITE_APP_UNOBRAVO_ENABLE_PLUS: value } }).plus,
      ).toBe(true);
    }
  });

  it("ignores the query string unless overrides are allowed", () => {
    expect(resolveFeatures({ search: "?ubPlus=false" }).plus).toBe(true);
    expect(
      resolveFeatures({ search: "?ubPlus=false", allowOverrides: true }).plus,
    ).toBe(false);
  });

  it("lets an allowed query-string override beat the env", () => {
    const env = { VITE_APP_UNOBRAVO_ENABLE_PLUS: "false" };

    expect(resolveFeatures({ env, search: "?ubPlus=true" }).plus).toBe(false);
    expect(
      resolveFeatures({ env, search: "?ubPlus=true", allowOverrides: true })
        .plus,
    ).toBe(true);
  });

  it("keeps env, query key and default in sync for every flag", () => {
    for (const feature of FEATURE_NAMES) {
      const envVar = `VITE_APP_UNOBRAVO_ENABLE_${feature
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toUpperCase()}`;

      expect(resolveFeatures({ env: { [envVar]: "false" } })[feature]).toBe(
        false,
      );

      const queryKey = `ub${feature[0].toUpperCase()}${feature.slice(1)}`;

      expect(
        resolveFeatures({
          search: `?${queryKey}=false`,
          allowOverrides: true,
        })[feature],
      ).toBe(false);
    }
  });

  it("reports a partially gated set as non-default", () => {
    expect(isUpstreamDefault({ ...DEFAULT_FEATURES, ai: false })).toBe(false);
  });
});
