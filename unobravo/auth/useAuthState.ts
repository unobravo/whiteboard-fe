import { useEffect, useState } from "react";

import { notifyHostOfAuthError } from "./parentAuthProvider";

import type { UnobravoAuthProvider } from "./types";
import type { UnobravoConfig } from "../config/integrationConfig";
import type { UnobravoAuthState } from "../types";

const DISABLED_STATE: UnobravoAuthState = { status: "disabled" };

/**
 * Drives the configured auth provider.
 *
 * Safe under StrictMode's double-invoked effects: each run gets its own
 * `AbortController`, the stale run is aborted on cleanup, and an aborted run
 * never commits state.
 */
export const useAuthState = (
  provider: UnobravoAuthProvider | null,
  config: UnobravoConfig,
  boardId: string | null,
): UnobravoAuthState => {
  const [state, setState] = useState<UnobravoAuthState>(() =>
    provider ? { status: "loading" } : DISABLED_STATE,
  );

  useEffect(() => {
    if (!provider) {
      setState(DISABLED_STATE);
      return;
    }

    const controller = new AbortController();

    setState({ status: "loading" });

    const commit = (nextState: UnobravoAuthState) => {
      if (controller.signal.aborted) {
        return;
      }

      setState(nextState);

      if (nextState.status === "error") {
        notifyHostOfAuthError(nextState.error.code, config.parentOrigins);
      }
    };

    provider
      .authenticate({ boardId, signal: controller.signal })
      .then(commit)
      // providers are contracted never to throw, but a rejection here would
      // otherwise leave the user on an unrecoverable loading screen
      .catch(() =>
        commit({
          status: "error",
          error: {
            code: "internal",
            message: "The session could not be established.",
          },
        }),
      );

    return () => {
      controller.abort();
    };
  }, [provider, config.parentOrigins, boardId]);

  return state;
};
