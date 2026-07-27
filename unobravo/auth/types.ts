import type { UnobravoAuthState } from "../types";

export type AuthenticateParams = {
  /** Board the user is trying to open, `null` when the URL carries none. */
  boardId: string | null;
  /** Aborted when the provider is torn down (unmount, StrictMode remount). */
  signal: AbortSignal;
};

/**
 * Resolves the current session.
 *
 * Implementations must never throw: they report failures as an `error` state
 * so the UI can show something actionable. They must also stop all work when
 * `signal` is aborted.
 */
export type UnobravoAuthProvider = {
  authenticate: (params: AuthenticateParams) => Promise<UnobravoAuthState>;
};
