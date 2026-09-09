/**
 * Which Sentry environment a hostname belongs to.
 *
 * Runtime, not build time. The pipeline builds once and promotes the identical
 * bytes to staging and then production (`unobravo-deploy.yml` /
 * `unobravo-deploy-app.yml`), so an `import.meta.env` value baked in at build
 * time cannot differ between the two — whichever value the build used would
 * ship to both buckets and label every production error as staging. The
 * hostname is the only thing that differs once the bytes are served. This is
 * the same constraint that produced `unobravo/collab/relayUrl.ts`, solved
 * without a second file to deploy because the answer is derivable from the
 * URL.
 *
 * Exact hostnames rather than a `.unobravo.com` suffix check: the map is also
 * what decides whether errors are sent at all, and an unrecognised host —
 * `localhost`, a `vite preview`, the CloudFront distribution domain, anyone
 * who points a hostname of their own at the bucket — should stay silent rather
 * than file its errors under a guessed environment.
 */
const SENTRY_ENV_BY_HOSTNAME: Readonly<Record<string, string>> = {
  "whiteboard.unobravo.com": "production",
  "whiteboard.unobravo.xyz": "staging",
};

export const getSentryEnvironment = (hostname: string): string | undefined =>
  SENTRY_ENV_BY_HOSTNAME[hostname.toLowerCase()];
