/**
 * The single source of truth for which upstream features this fork ships.
 *
 * Every flag defaults to `true`, so a build that configures nothing behaves
 * exactly like upstream Excalidraw. That keeps the upstream test suites and
 * snapshots green without a `test:update`, and makes a merge that breaks the
 * gating layer fail loudly instead of degrading in silence.
 *
 * Because the defaults are permissive, a missing or mistyped env var reopens
 * the feature rather than closing it. `unobravo/tests/envProduction.test.ts`
 * exists precisely to catch that: it asserts the production env file really
 * does turn every flag off.
 */
export type UnobravoFeature =
  | "plus"
  | "ai"
  | "library"
  | "socials"
  | "shareLinks";

export type UnobravoFeatures = Record<UnobravoFeature, boolean>;

export const DEFAULT_FEATURES: UnobravoFeatures = {
  /** Excalidraw+ upsells: promo banner, promo sidebar, sign-up links, export to Plus. */
  plus: true,
  /** Text-to-diagram, diagram-to-code, magic frame. Not Mermaid, which is local. */
  ai: true,
  /** The Library tab of the default sidebar, and everything reachable from it. */
  library: true,
  /** Links out to third-party properties: socials, Excalidraw's blog and docs. */
  socials: true,
  /**
   * Offering to publish a shareable link. Not the ability to open one: a
   * `#json=` link someone sends still loads, exactly as upstream.
   */
  shareLinks: true,
};

export const FEATURE_NAMES = Object.keys(DEFAULT_FEATURES) as UnobravoFeature[];

/** Env var carrying the build-time value of each flag. */
const ENV_VAR_BY_FEATURE: Record<UnobravoFeature, string> = {
  plus: "VITE_APP_UNOBRAVO_ENABLE_PLUS",
  ai: "VITE_APP_UNOBRAVO_ENABLE_AI",
  library: "VITE_APP_UNOBRAVO_ENABLE_LIBRARY",
  socials: "VITE_APP_UNOBRAVO_ENABLE_SOCIALS",
  shareLinks: "VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS",
};

/** Query-string key overriding each flag, e.g. `?ubPlus=true`. */
const QUERY_KEY_BY_FEATURE: Record<UnobravoFeature, string> = {
  plus: "ubPlus",
  ai: "ubAi",
  library: "ubLibrary",
  socials: "ubSocials",
  shareLinks: "ubShareLinks",
};

export const envVarForFeature = (feature: UnobravoFeature): string =>
  ENV_VAR_BY_FEATURE[feature];

export const queryKeyForFeature = (feature: UnobravoFeature): string =>
  QUERY_KEY_BY_FEATURE[feature];

/** Env var that opts a build into honouring the query-string overrides. */
export const ALLOW_OVERRIDES_ENV_VAR = "VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES";

/**
 * Only `true`/`false` count, as a boolean or as a string in any casing.
 * Anything else — including an empty string — leaves the flag untouched,
 * mirroring how upstream treats its own env flags.
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

export type ResolveFeaturesOptions = {
  /** Usually `import.meta.env`. */
  env?: Record<string, unknown>;
  /** Usually `window.location.search`. */
  search?: string;
  /**
   * Whether query-string overrides are honoured. Production passes `false` so
   * end users cannot re-enable a gated feature by editing the URL.
   */
  allowOverrides?: boolean;
};

/** Precedence: defaults, then env, then — only when allowed — the query string. */
export const resolveFeatures = ({
  env = {},
  search = "",
  allowOverrides = false,
}: ResolveFeaturesOptions = {}): UnobravoFeatures => {
  const features = { ...DEFAULT_FEATURES };

  const params = allowOverrides ? new URLSearchParams(search) : null;

  for (const feature of FEATURE_NAMES) {
    const fromEnv = parseFlagValue(env[ENV_VAR_BY_FEATURE[feature]]);

    if (fromEnv !== undefined) {
      features[feature] = fromEnv;
    }

    const fromQuery = params
      ? parseFlagValue(params.get(QUERY_KEY_BY_FEATURE[feature]) ?? undefined)
      : undefined;

    if (fromQuery !== undefined) {
      features[feature] = fromQuery;
    }
  }

  return features;
};

/** True when the resolved set matches upstream, i.e. nothing is gated off. */
export const isUpstreamDefault = (features: UnobravoFeatures): boolean =>
  FEATURE_NAMES.every((feature) => features[feature] === true);
