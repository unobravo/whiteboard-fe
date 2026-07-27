import type { UnobravoFeatureFlagName, UnobravoFeatureFlags } from "../types";

/**
 * Every feature is on by default, so that an unconfigured build behaves
 * exactly like upstream Excalidraw.
 */
export const DEFAULT_FEATURE_FLAGS: UnobravoFeatureFlags = {
  collaboration: true,
  shareLinks: true,
  export: true,
  saveAsImage: true,
  saveToDisk: true,
  loadFromFile: true,
  images: true,
  ai: true,
};

/** Env var that carries the build-time default of each flag. */
const ENV_VAR_BY_FLAG: Record<UnobravoFeatureFlagName, string> = {
  collaboration: "VITE_APP_UNOBRAVO_ENABLE_COLLABORATION",
  shareLinks: "VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS",
  export: "VITE_APP_UNOBRAVO_ENABLE_EXPORT",
  saveAsImage: "VITE_APP_UNOBRAVO_ENABLE_SAVE_AS_IMAGE",
  saveToDisk: "VITE_APP_UNOBRAVO_ENABLE_SAVE_TO_DISK",
  loadFromFile: "VITE_APP_UNOBRAVO_ENABLE_LOAD_FROM_FILE",
  images: "VITE_APP_UNOBRAVO_ENABLE_IMAGES",
  ai: "VITE_APP_UNOBRAVO_ENABLE_AI",
};

/** Query-string key that overrides each flag, e.g. `?ubExport=false`. */
const QUERY_KEY_BY_FLAG: Record<UnobravoFeatureFlagName, string> = {
  collaboration: "ubCollaboration",
  shareLinks: "ubShareLinks",
  export: "ubExport",
  saveAsImage: "ubSaveAsImage",
  saveToDisk: "ubSaveToDisk",
  loadFromFile: "ubLoadFromFile",
  images: "ubImages",
  ai: "ubAi",
};

export const FEATURE_FLAG_NAMES = Object.keys(
  DEFAULT_FEATURE_FLAGS,
) as UnobravoFeatureFlagName[];

/**
 * Parses a flag value. Only `true`/`false` (as a boolean, or as a string in
 * any casing) count — anything else, including an empty string, leaves the
 * flag untouched, mirroring how upstream treats its own env flags.
 */
const parseFlagValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return undefined;
};

export type ResolveFeatureFlagsOptions = {
  /** Usually `import.meta.env`. */
  env?: Record<string, unknown>;
  /** Usually `window.location.search`. */
  search?: string;
  /**
   * Whether query-string overrides are honoured. Callers pass `false` in
   * production so end users cannot re-enable gated features.
   */
  allowOverrides?: boolean;
};

/**
 * Resolves the effective flags. Precedence: defaults, then env, then (only
 * when explicitly allowed) the query string.
 */
export const resolveFeatureFlags = ({
  env = {},
  search = "",
  allowOverrides = false,
}: ResolveFeatureFlagsOptions = {}): UnobravoFeatureFlags => {
  const flags = { ...DEFAULT_FEATURE_FLAGS };

  const params = allowOverrides ? new URLSearchParams(search) : null;

  for (const flag of FEATURE_FLAG_NAMES) {
    const fromEnv = parseFlagValue(env[ENV_VAR_BY_FLAG[flag]]);

    if (fromEnv !== undefined) {
      flags[flag] = fromEnv;
    }

    if (params) {
      const fromQuery = parseFlagValue(
        params.get(QUERY_KEY_BY_FLAG[flag]) ?? undefined,
      );

      if (fromQuery !== undefined) {
        flags[flag] = fromQuery;
      }
    }
  }

  return flags;
};
