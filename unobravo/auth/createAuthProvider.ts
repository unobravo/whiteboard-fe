import { createMockAuthProvider } from "./mockAuthProvider";
import { createParentAuthProvider } from "./parentAuthProvider";

import type { UnobravoAuthProvider } from "./types";
import type { UnobravoConfig } from "../config/integrationConfig";

/**
 * Builds the provider matching the configured mode. `disabled` has no
 * provider: the layer renders its children immediately.
 */
export const createAuthProvider = (
  config: UnobravoConfig,
): UnobravoAuthProvider | null => {
  switch (config.mode) {
    case "mock":
      return createMockAuthProvider();
    case "parent":
      return createParentAuthProvider({
        parentOrigins: config.parentOrigins,
        timeoutMs: config.authTimeoutMs,
      });
    case "disabled":
    default:
      return null;
  }
};
