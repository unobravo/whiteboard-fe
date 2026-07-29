/**
 * The Unobravo gating layer.
 *
 * Deliberately dependency-free with respect to `excalidraw-app`: this package
 * only knows about flags, so the dependency runs one way (`excalidraw-app` →
 * `unobravo`) and never back. The components that consume the flags to reshape
 * the app shell live in `excalidraw-app/components/unobravo/`.
 *
 * See `unobravo/FORK.md` for the register of upstream files this layer
 * modifies and why.
 */
export {
  ALLOW_OVERRIDES_ENV_VAR,
  DEFAULT_FEATURES,
  FEATURE_NAMES,
  envVarForFeature,
  isUpstreamDefault,
  queryKeyForFeature,
  resolveFeatures,
} from "./config/features";
export type {
  ResolveFeaturesOptions,
  UnobravoFeature,
  UnobravoFeatures,
} from "./config/features";

export {
  RESOLVED_FEATURES,
  UnobravoFeaturesProvider,
  useUnobravoFeatures,
} from "./hooks/useUnobravoFeatures";
