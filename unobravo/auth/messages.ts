import type { UnobravoAuthErrorCode, UnobravoUser } from "../types";

/** Sent by the whiteboard to ask the embedding page for the session. */
export const AUTH_REQUEST_TYPE = "unobravo:auth-request";
/** Sent by the embedding page in response. */
export const AUTH_RESPONSE_TYPE = "unobravo:auth-response";
/** Sent by the whiteboard when the session could not be established. */
export const AUTH_ERROR_TYPE = "unobravo:auth-error";

export type AuthRequestMessage = {
  type: typeof AUTH_REQUEST_TYPE;
  boardId: string | null;
  /** Echoed back by the host so late/stale replies can be discarded. */
  requestId: string;
};

export type AuthErrorMessage = {
  type: typeof AUTH_ERROR_TYPE;
  code: UnobravoAuthErrorCode;
};

export type AuthResponseMessage =
  | {
      type: typeof AUTH_RESPONSE_TYPE;
      ok: true;
      token: string;
      user: UnobravoUser;
      requestId?: string;
    }
  | {
      type: typeof AUTH_RESPONSE_TYPE;
      ok: false;
      code?: UnobravoAuthErrorCode;
      requestId?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isUser = (value: unknown): value is UnobravoUser => {
  if (!isRecord(value)) {
    return false;
  }

  const { id, email, displayName } = value;

  return (
    typeof id === "string" &&
    id !== "" &&
    (email === undefined || typeof email === "string") &&
    (displayName === undefined || typeof displayName === "string")
  );
};

/**
 * Validates a message received from the embedding page. Everything crossing
 * the iframe boundary is untrusted, so the shape is checked explicitly rather
 * than cast.
 */
export const parseAuthResponse = (
  data: unknown,
): AuthResponseMessage | null => {
  if (!isRecord(data) || data.type !== AUTH_RESPONSE_TYPE) {
    return null;
  }

  const requestId =
    typeof data.requestId === "string" ? data.requestId : undefined;

  if (data.ok === true) {
    return typeof data.token === "string" &&
      data.token !== "" &&
      isUser(data.user)
      ? {
          type: AUTH_RESPONSE_TYPE,
          ok: true,
          token: data.token,
          user: data.user,
          requestId,
        }
      : null;
  }

  if (data.ok === false) {
    return {
      type: AUTH_RESPONSE_TYPE,
      ok: false,
      code: data.code === "unauthorized" ? "unauthorized" : undefined,
      requestId,
    };
  }

  return null;
};
