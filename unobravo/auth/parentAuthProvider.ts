import {
  AUTH_ERROR_TYPE,
  AUTH_REQUEST_TYPE,
  parseAuthResponse,
} from "./messages";

import type { AuthErrorMessage, AuthRequestMessage } from "./messages";
import type { UnobravoAuthProvider } from "./types";
import type { UnobravoAuthError, UnobravoAuthState } from "../types";

/**
 * The host page may attach its `message` listener after the iframe has loaded,
 * so a single request can be missed. The request is re-sent on this interval
 * until the host answers (or the overall timeout elapses).
 */
const RETRY_INTERVAL_MS = 250;

export type ParentAuthProviderOptions = {
  /** Origins allowed to provide the session. Must not be empty. */
  parentOrigins: readonly string[];
  timeoutMs: number;
};

const error = (
  code: UnobravoAuthError["code"],
  message: string,
): UnobravoAuthState => ({ status: "error", error: { code, message } });

/**
 * Posts a message to every configured origin. The browser delivers it only to
 * the one that actually matches the parent, so this stays safe while letting a
 * single build serve several hosts (e.g. staging and production).
 *
 * `"*"` is deliberately never used as target origin: a wildcard would expose
 * the message — and the board id it carries — to any page framing us.
 */
const postToParent = (
  message: AuthRequestMessage | AuthErrorMessage,
  parentOrigins: readonly string[],
): void => {
  for (const origin of parentOrigins) {
    window.parent.postMessage(message, origin);
  }
};

/**
 * Tells the embedding page that the session could not be established, so it
 * can react (re-login, redirect, close the iframe).
 *
 * Sent only when there is a trusted target to send it to.
 */
export const notifyHostOfAuthError = (
  code: UnobravoAuthError["code"],
  parentOrigins: readonly string[],
): void => {
  if (window.parent === window || parentOrigins.length === 0) {
    return;
  }

  postToParent({ type: AUTH_ERROR_TYPE, code }, parentOrigins);
};

let requestCounter = 0;

/**
 * Obtains the session from the embedding Unobravo page over `postMessage`.
 *
 * The whiteboard has no login UI of its own: the host already knows who the
 * user is, so it answers the handshake with a token and a user.
 */
export const createParentAuthProvider = ({
  parentOrigins,
  timeoutMs,
}: ParentAuthProviderOptions): UnobravoAuthProvider => ({
  authenticate: ({ boardId, signal }) =>
    new Promise<UnobravoAuthState>((resolve) => {
      if (parentOrigins.length === 0) {
        resolve(
          error(
            "internal",
            "VITE_APP_UNOBRAVO_PARENT_ORIGINS is not configured.",
          ),
        );
        return;
      }

      if (window.parent === window) {
        resolve(
          error(
            "not-embedded",
            "The whiteboard is not embedded in a host page.",
          ),
        );
        return;
      }

      const allowedOrigins = new Set(parentOrigins);
      const requestId = `unobravo-auth-${(requestCounter += 1)}`;
      const request: AuthRequestMessage = {
        type: AUTH_REQUEST_TYPE,
        boardId,
        requestId,
      };

      let settled = false;

      const settle = (state: UnobravoAuthState) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        window.clearInterval(retryId);
        window.removeEventListener("message", onMessage);
        signal.removeEventListener("abort", onAbort);
        resolve(state);
      };

      const onMessage = (event: MessageEvent) => {
        // everything crossing the iframe boundary is untrusted: only the
        // configured host, and only the window we actually asked, may answer
        if (
          !allowedOrigins.has(event.origin) ||
          event.source !== window.parent
        ) {
          return;
        }

        const response = parseAuthResponse(event.data);

        // an absent requestId keeps simpler hosts working; a mismatching one
        // is a stale reply to a previous request and must be ignored
        if (!response || (response.requestId ?? requestId) !== requestId) {
          return;
        }

        settle(
          response.ok
            ? {
                status: "authenticated",
                user: response.user,
                token: response.token,
              }
            : error(
                response.code ?? "unauthorized",
                "The host denied access to this board.",
              ),
        );
      };

      const onAbort = () => {
        // the caller is gone (unmount); the state is discarded either way
        settle({ status: "loading" });
      };

      const timeoutId = window.setTimeout(() => {
        settle(error("timeout", "The host did not answer in time."));
      }, timeoutMs);

      const retryId = window.setInterval(() => {
        postToParent(request, parentOrigins);
      }, RETRY_INTERVAL_MS);

      window.addEventListener("message", onMessage);
      signal.addEventListener("abort", onAbort, { once: true });

      if (signal.aborted) {
        onAbort();
        return;
      }

      postToParent(request, parentOrigins);
    }),
});
