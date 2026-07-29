/**
 * Env vars owned by the Unobravo gating layer.
 *
 * Declared here rather than in `excalidraw-app/vite-env.d.ts` so that no
 * upstream file has to change: both are global scripts, so TypeScript merges
 * the two `ImportMetaEnv` declarations.
 *
 * Every key is optional. An unset flag is a real, supported state — it means
 * "behave like upstream" — and `.env.development` deliberately omits
 * `VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES` because dev honours the query-string
 * overrides regardless.
 */
interface ImportMetaEnv {
  /** Excalidraw+ upsells. `"false"` to hide them. Anything else keeps upstream behaviour. */
  VITE_APP_UNOBRAVO_ENABLE_PLUS?: string;

  /** Text-to-diagram, diagram-to-code, magic frame. */
  VITE_APP_UNOBRAVO_ENABLE_AI?: string;

  /** The Library tab of the default sidebar and everything reachable from it. */
  VITE_APP_UNOBRAVO_ENABLE_LIBRARY?: string;

  /** Links out to third-party properties: socials, Excalidraw's blog and docs. */
  VITE_APP_UNOBRAVO_ENABLE_SOCIALS?: string;

  /** Live collaboration: the websocket server and the Firebase scene/file store. */
  VITE_APP_UNOBRAVO_ENABLE_COLLABORATION?: string;

  /** Shareable links: uploading and fetching scenes from the share backend. */
  VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS?: string;

  /**
   * Allows overriding the flags via the query string outside of dev. Off by
   * default so end users cannot flip them in production.
   */
  VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES?: string;
}
