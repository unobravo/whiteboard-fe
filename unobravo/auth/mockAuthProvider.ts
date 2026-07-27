import type { UnobravoAuthProvider } from "./types";

/**
 * Development-only provider: resolves a fixed user without any handshake, so
 * the app can be run locally with the layer enabled and no host page.
 */
export const createMockAuthProvider = (): UnobravoAuthProvider => ({
  authenticate: async () => ({
    status: "authenticated",
    user: {
      id: "mock-user",
      email: "mock@unobravo.com",
      displayName: "Mock User",
    },
    token: "mock-token",
  }),
});
