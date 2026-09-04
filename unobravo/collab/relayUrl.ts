/**
 * Where to point the collaboration socket.
 *
 * The deploy pipeline builds once and promotes the identical bytes to staging
 * and production (see `unobravo-deploy.yml` / `unobravo-deploy-app.yml`), so
 * `VITE_APP_WS_SERVER_URL` — baked in at build time from `.env.production` —
 * cannot differ between the two: whichever value the build used ships to both
 * buckets. `unobravo-deploy-app.yml` writes a per-bucket `/ws-config.json`
 * instead, after the shared build, so each environment can point at its own
 * relay without a second build. This reads that file, falling back to the
 * build-time env var when it is missing — `vite preview`, `docker build`, a
 * `yarn build` run outside CI, or the request itself failing.
 */

let cached: Promise<string> | null = null;

const readConfiguredUrl = async (): Promise<string> => {
  const fallback = import.meta.env.VITE_APP_WS_SERVER_URL;

  // Local dev never gets a deployed `/ws-config.json` for its bucket — it
  // would only ever see `public/ws-config.json`'s baked-in default, silently
  // overriding `.env.development(.local)` (the documented way to point a
  // local checkout at a different relay, e.g. one running on localhost). Vite
  // env vars already are the per-environment mechanism here, so trust them.
  if (import.meta.env.DEV) {
    return fallback;
  }

  try {
    const response = await fetch("/ws-config.json");
    if (!response.ok) {
      return fallback;
    }

    const config = await response.json();
    return typeof config?.wsServerUrl === "string" && config.wsServerUrl
      ? config.wsServerUrl
      : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Memoized: every call in the same session asks for the same URL, and the
 * value cannot change without a page reload (there is no live-reconfigure of
 * a running collaboration socket).
 */
export const getRelayUrl = (): Promise<string> => {
  cached ??= readConfiguredUrl();
  return cached;
};

/** Test seam: `cached` outlives a single test otherwise. */
export const resetRelayUrlForTests = () => {
  cached = null;
};
