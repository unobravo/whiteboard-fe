import fs from "fs";
import path from "path";

import {
  ALLOW_OVERRIDES_ENV_VAR,
  FEATURE_NAMES,
  envVarForFeature,
  queryKeyForFeature,
  resolveFeatures,
} from "../config/features";

/**
 * The gating fails open: every flag defaults to `true`, so a deleted or
 * mistyped line in `.env.production` silently reopens a feature and no other
 * test in the repo notices — they all run against `.env.test`, where nothing is
 * configured.
 *
 * This is the test that notices.
 */
const ENV_PRODUCTION = path.resolve(__dirname, "../../.env.production");

/** Minimal dotenv parse: enough for the flag lines, which are plain `K=V`. */
const parseEnvFile = (contents: string): Record<string, string> => {
  const env: Record<string, string> = {};

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator === -1) {
      continue;
    }

    env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }

  return env;
};

describe(".env.production", () => {
  const env = parseEnvFile(fs.readFileSync(ENV_PRODUCTION, "utf8"));

  it("turns every feature off", () => {
    for (const feature of FEATURE_NAMES) {
      expect(
        `${envVarForFeature(feature)}=${env[envVarForFeature(feature)]}`,
      ).toBe(`${envVarForFeature(feature)}=false`);
    }
  });

  it("refuses query-string overrides", () => {
    expect(env[ALLOW_OVERRIDES_ENV_VAR]).toBe("false");
  });

  it("resolves to an all-off set, overrides included", () => {
    const resolved = resolveFeatures({
      env,
      // a user trying to talk their way back into the gated features. The keys
      // come from `queryKeyForFeature`, not from the feature name — deriving
      // them by hand produced `ubplus` instead of `ubPlus`, which matches
      // nothing and made this assertion pass for the wrong reason.
      search: FEATURE_NAMES.map(
        (feature) => `${queryKeyForFeature(feature)}=true`,
      ).join("&"),
      allowOverrides: env[ALLOW_OVERRIDES_ENV_VAR] === "true",
    });

    for (const feature of FEATURE_NAMES) {
      expect(`${feature}=${resolved[feature]}`).toBe(`${feature}=false`);
    }
  });

  it("keeps Sentry from reporting to Excalidraw's project", () => {
    // excalidraw-app/sentry.ts treats any *.vercel.app host as Excalidraw
    // staging and enables the upstream DSN
    expect(env.VITE_APP_DISABLE_SENTRY).toBe("true");
  });
});
