import { getFeatureFlag } from "@excalidraw/common";
import * as Sentry from "@sentry/browser";
import callsites from "callsites";

// UNOBRAVO: Unobravo hostnames and DSN, not Excalidraw's; see unobravo/FORK.md
import { getSentryEnvironment } from "../unobravo/observability/sentryEnv";

const SENTRY_DISABLED = import.meta.env.VITE_APP_DISABLE_SENTRY === "true";

// Disable Sentry locally or inside the Docker to avoid noise/respect privacy
const onlineEnv = SENTRY_DISABLED
  ? undefined
  : getSentryEnvironment(window.location.hostname);

const dsn = onlineEnv
  ? import.meta.env.VITE_SENTRY_DSN || undefined
  : undefined;

// UNOBRAVO: the room key rides in the fragment, the relay token in the query;
// see unobravo/FORK.md
const stripCredentials = (url: string) => url.replace(/[?#].*$/, "");

/**
 * UNOBRAVO: whether errors are actually transmitted anywhere.
 *
 * `Sentry.captureException` still returns a synthetic event id when the DSN is
 * undefined, so the crash screen has to ask this rather than assume the id it
 * holds means something.
 */
export const isErrorReportingEnabled = !!dsn;

Sentry.init({
  dsn,
  environment: dsn ? onlineEnv : undefined,
  release: import.meta.env.VITE_APP_GIT_SHA,
  ignoreErrors: [
    "undefined is not an object (evaluating 'window.__pad.performLoop')", // Only happens on Safari, but spams our servers. Doesn't break anything
    "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", // Not much we can do about the IndexedDB closing error
    /(Failed to fetch|(fetch|loading) dynamically imported module)/i, // This is happening when a service worker tries to load an old asset
    /QuotaExceededError: (The quota has been exceeded|.*setItem.*Storage)/i, // localStorage quota exceeded
    "Internal error opening backing store for indexedDB.open", // Private mode and disabled indexedDB
  ],
  integrations: [
    Sentry.captureConsoleIntegration({
      levels: ["error"],
    }),
    Sentry.featureFlagsIntegration(),
  ],
  beforeSend(event) {
    if (event.request?.url) {
      event.request.url = stripCredentials(event.request.url);
    }

    // UNOBRAVO: navigation breadcrumbs carry the same URL; see unobravo/FORK.md
    for (const breadcrumb of event.breadcrumbs ?? []) {
      const data = breadcrumb.data;
      if (breadcrumb.category !== "navigation" || !data) {
        continue;
      }
      for (const key of ["from", "to"] as const) {
        if (typeof data[key] === "string") {
          data[key] = stripCredentials(data[key]);
        }
      }
    }

    if (!event.exception) {
      event.exception = {
        values: [
          {
            type: "ConsoleError",
            value: event.message ?? "Unknown error",
            stacktrace: {
              frames: callsites()
                .slice(1)
                .filter(
                  (frame) =>
                    frame.getFileName() &&
                    !frame.getFileName()?.includes("@sentry_browser.js"),
                )
                .map((frame) => ({
                  filename: frame.getFileName() ?? undefined,
                  function: frame.getFunctionName() ?? undefined,
                  in_app: !(
                    frame.getFileName()?.includes("node_modules") ?? false
                  ),
                  lineno: frame.getLineNumber() ?? undefined,
                  colno: frame.getColumnNumber() ?? undefined,
                })),
            },
            mechanism: {
              type: "instrument",
              handled: true,
              data: {
                function: "console.error",
                handler: "Sentry.beforeSend",
              },
            },
          },
        ],
      };
    }

    return event;
  },
});

const flagsIntegration =
  Sentry.getClient()?.getIntegrationByName<Sentry.FeatureFlagsIntegration>(
    "FeatureFlags",
  );
if (flagsIntegration) {
  flagsIntegration.addFeatureFlag(
    "COMPLEX_BINDINGS",
    getFeatureFlag("COMPLEX_BINDINGS"),
  );
}
