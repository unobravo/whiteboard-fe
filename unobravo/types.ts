/**
 * Public types of the Unobravo integration layer.
 *
 * This layer is intentionally self-contained: nothing under `packages/` may
 * import from it, and `excalidraw-app` only imports from `unobravo/index.ts`.
 */

/** Feature gates the host app can flip per environment. */
export type UnobravoFeatureFlags = {
  /** Live collaboration (sessions, room links, collaborators). */
  collaboration: boolean;
  /** Uploading the scene to the Excalidraw backend to get a shareable link. */
  shareLinks: boolean;
  /** The JSON export dialog ("Export"). */
  export: boolean;
  /** The image export dialog ("Export image"). */
  saveAsImage: boolean;
  /** Saving the scene as a file on the user's disk. */
  saveToDisk: boolean;
  /** Loading a scene from a file on the user's disk. */
  loadFromFile: boolean;
  /** The image tool (insert image, paste & drop images). */
  images: boolean;
  /** AI affordances (text-to-diagram, diagram-to-code, magic frame). */
  ai: boolean;
};

export type UnobravoFeatureFlagName = keyof UnobravoFeatureFlags;

/** How the layer obtains the current user. */
export type UnobravoAuthMode =
  /** Layer is off: the app behaves exactly like upstream Excalidraw. */
  | "disabled"
  /** Local development: a fixed user is returned without any handshake. */
  | "mock"
  /** The embedding Unobravo page provides the session via `postMessage`. */
  | "parent";

export type UnobravoUser = {
  id: string;
  email?: string;
  displayName?: string;
};

export type UnobravoAuthErrorCode =
  /** The layer is configured for `parent` but the app is not embedded. */
  | "not-embedded"
  /** The host never answered within the configured timeout. */
  | "timeout"
  /** The host answered, but denied access (missing/expired session). */
  | "unauthorized"
  /** The host answered with a malformed payload, or the config is invalid. */
  | "internal";

export type UnobravoAuthError = {
  code: UnobravoAuthErrorCode;
  message: string;
};

export type UnobravoAuthState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "authenticated"; user: UnobravoUser; token: string }
  | { status: "error"; error: UnobravoAuthError };

/** Value exposed by `useUnobravoIntegration()`. */
export type UnobravoIntegration = {
  /** `false` when the layer is inert (no provider mounted, or mode disabled). */
  enabled: boolean;
  /** Board id parsed from the URL, `null` when the URL carries none. */
  boardId: string | null;
  flags: UnobravoFeatureFlags;
  /** `null` unless authenticated. */
  user: UnobravoUser | null;
};
