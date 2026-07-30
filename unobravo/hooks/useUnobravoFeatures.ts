import React, { useContext, useMemo } from "react";

import { isDevEnv } from "@excalidraw/common";

import { ALLOW_OVERRIDES_ENV_VAR, resolveFeatures } from "../config/features";

import type { UnobravoFeatures } from "../config/features";

/**
 * Resolved once at module load: env vars are build-time constants and the
 * query string does not change without a reload, so a single frozen object
 * gives every consumer a referentially stable value for the whole session.
 *
 * That stability matters — the editor's memo comparator in
 * `packages/excalidraw/index.tsx` compares `UIOptions.tools` by reference, so
 * a features object with a fresh identity on every render would re-render the
 * entire editor.
 */
export const RESOLVED_FEATURES: UnobravoFeatures = Object.freeze(
  resolveFeatures({
    env: import.meta.env as unknown as Record<string, unknown>,
    search: typeof window === "undefined" ? "" : window.location.search,
    // dev always honours `?ubPlus=true` and friends; production only does so
    // when the build explicitly opts in, otherwise any end user could re-enable
    // a gated feature from the URL bar
    allowOverrides:
      isDevEnv() || import.meta.env[ALLOW_OVERRIDES_ENV_VAR] === "true",
  }),
);

/**
 * Only used to inject a different set — tests, and a future host app that
 * embeds the editor. Production never mounts a provider and reads
 * `RESOLVED_FEATURES` through the context default.
 */
const UnobravoFeaturesContext =
  React.createContext<UnobravoFeatures>(RESOLVED_FEATURES);

export const UnobravoFeaturesProvider = ({
  features,
  children,
}: {
  features: Partial<UnobravoFeatures>;
  children: React.ReactNode;
}) => {
  // omitted flags fall back to what the build resolved, not to the permissive
  // defaults — a host that overrides one flag must not silently reopen the five
  // it did not mention
  const {
    plus = RESOLVED_FEATURES.plus,
    ai = RESOLVED_FEATURES.ai,
    library = RESOLVED_FEATURES.library,
    socials = RESOLVED_FEATURES.socials,
    shareLinks = RESOLVED_FEATURES.shareLinks,
  } = features;

  // depends on the individual flags rather than on `features`, which callers
  // pass as an object literal — memoising on the object would hand every
  // consumer a new value on each parent render
  const value = useMemo(
    () => ({ plus, ai, library, socials, shareLinks }),
    [plus, ai, library, socials, shareLinks],
  );

  return React.createElement(
    UnobravoFeaturesContext.Provider,
    { value },
    children,
  );
};

export const useUnobravoFeatures = (): UnobravoFeatures =>
  useContext(UnobravoFeaturesContext);
