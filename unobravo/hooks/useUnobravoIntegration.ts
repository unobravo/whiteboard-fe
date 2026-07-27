import { createContext, useContext } from "react";

import { DEFAULT_FEATURE_FLAGS } from "../config/featureFlags";

import type { UnobravoIntegration } from "../types";

/**
 * Value used when no provider is mounted. The layer is inert by default, so
 * mounting the app without `<UnobravoProvider>` (as the existing app tests do)
 * behaves exactly like upstream Excalidraw.
 */
export const INERT_INTEGRATION: UnobravoIntegration = {
  enabled: false,
  boardId: null,
  flags: DEFAULT_FEATURE_FLAGS,
  user: null,
};

export const UnobravoIntegrationContext =
  createContext<UnobravoIntegration>(INERT_INTEGRATION);

/** Reads the integration state. Safe to call without a provider. */
export const useUnobravoIntegration = (): UnobravoIntegration =>
  useContext(UnobravoIntegrationContext);
