/**
 * Env vars owned by the Unobravo integration layer.
 *
 * Declared here rather than in `excalidraw-app/vite-env.d.ts` so that no
 * upstream file has to change: both files are global scripts, so TypeScript
 * merges the two `ImportMetaEnv` declarations.
 */
interface ImportMetaEnv {
  /** `disabled` (default) | `mock` | `parent` — see `UnobravoAuthMode`. */
  VITE_APP_UNOBRAVO_AUTH_MODE: string;

  /**
   * Comma-separated list of origins allowed to provide the session via
   * `postMessage`. Required when the auth mode is `parent`.
   */
  VITE_APP_UNOBRAVO_PARENT_ORIGINS: string;

  /** How long to wait for the host's auth response, in ms (default 10000). */
  VITE_APP_UNOBRAVO_AUTH_TIMEOUT_MS: string;

  /**
   * Allows overriding feature flags via the query string outside of dev.
   * Off by default so flags cannot be flipped by end users in production.
   */
  VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES: string;

  VITE_APP_UNOBRAVO_ENABLE_COLLABORATION: string;
  VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS: string;
  VITE_APP_UNOBRAVO_ENABLE_EXPORT: string;
  VITE_APP_UNOBRAVO_ENABLE_SAVE_AS_IMAGE: string;
  VITE_APP_UNOBRAVO_ENABLE_SAVE_TO_DISK: string;
  VITE_APP_UNOBRAVO_ENABLE_LOAD_FROM_FILE: string;
  VITE_APP_UNOBRAVO_ENABLE_IMAGES: string;
  VITE_APP_UNOBRAVO_ENABLE_AI: string;
}
