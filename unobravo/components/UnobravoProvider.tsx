import { useCallback, useMemo, useState } from "react";

import { createAuthProvider } from "../auth/createAuthProvider";
import { useAuthState } from "../auth/useAuthState";
import { getCurrentBoardId } from "../board/boardId";
import { readUnobravoConfigFromEnv } from "../config/integrationConfig";
import { UnobravoIntegrationContext } from "../hooks/useUnobravoIntegration";

import { AuthScreen } from "./AuthScreen";

import type { UnobravoIntegration } from "../types";
import type { ReactNode } from "react";

/**
 * Entry point of the integration layer: resolves configuration, board id and
 * session, and only then renders the app.
 *
 * With no configuration this is a pass-through, so an unconfigured build is
 * upstream Excalidraw.
 */
export const UnobravoProvider = ({ children }: { children: ReactNode }) => {
  const config = useMemo(
    () => readUnobravoConfigFromEnv(window.location.search),
    [],
  );

  const boardId = useMemo(() => getCurrentBoardId(), []);

  // held in state, and replaced on retry, so that retrying re-runs the
  // handshake without reloading the page
  const [authProvider, setAuthProvider] = useState(() =>
    createAuthProvider(config),
  );

  const authState = useAuthState(authProvider, config, boardId);

  const onRetry = useCallback(() => {
    setAuthProvider(createAuthProvider(config));
  }, [config]);

  const integration = useMemo<UnobravoIntegration>(
    () => ({
      enabled: config.mode !== "disabled",
      boardId,
      flags: config.flags,
      user: authState.status === "authenticated" ? authState.user : null,
    }),
    [config, boardId, authState],
  );

  if (authState.status === "loading" || authState.status === "error") {
    return <AuthScreen state={authState} onRetry={onRetry} />;
  }

  return (
    <UnobravoIntegrationContext.Provider value={integration}>
      {children}
    </UnobravoIntegrationContext.Provider>
  );
};
