import type {
  ErrorEvent as SentryErrorEvent,
  init as sentryInit,
} from "@sentry/browser";

/**
 * `excalidraw-app/sentry.ts` decides two things at import time: whether to
 * report at all, and under which environment. `sentryEnv.test.ts` covers the
 * hostname map on its own; this covers what the upstream file does with it,
 * which is the part issue #16 was actually about — a DSN that never resolved.
 *
 * The module calls `Sentry.init` as a side effect of being imported, so every
 * case re-imports it against a fresh module registry rather than calling a
 * function.
 */
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureConsoleIntegration: vi.fn(() => ({ name: "CaptureConsole" })),
  featureFlagsIntegration: vi.fn(() => ({ name: "FeatureFlags" })),
  getClient: vi.fn(() => undefined),
}));

vi.mock("@sentry/browser", () => sentry);

const DSN = "https://examplePublicKey@o0.ingest.de.sentry.io/0";

const initOptions = () => {
  const [options] = sentry.init.mock.calls[0] as Parameters<typeof sentryInit>;
  return options ?? {};
};

const loadSentry = async (hostname: string) => {
  vi.stubGlobal("location", { ...window.location, hostname });
  vi.resetModules();

  const module = await import("../../excalidraw-app/sentry");

  expect(sentry.init).toHaveBeenCalledTimes(1);

  return module;
};

describe("excalidraw-app/sentry.ts", () => {
  beforeEach(() => {
    sentry.init.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    vi.stubEnv("VITE_APP_DISABLE_SENTRY", "false");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports to the configured DSN from the production hostname", async () => {
    const { isErrorReportingEnabled } = await loadSentry(
      "whiteboard.unobravo.com",
    );

    expect(initOptions()).toMatchObject({
      dsn: DSN,
      environment: "production",
    });
    expect(isErrorReportingEnabled).toBe(true);
  });

  it("labels staging as staging, from the same build", async () => {
    const { isErrorReportingEnabled } = await loadSentry(
      "whiteboard.unobravo.xyz",
    );

    expect(initOptions()).toMatchObject({ dsn: DSN, environment: "staging" });
    expect(isErrorReportingEnabled).toBe(true);
  });

  /**
   * The one that matters for privacy: a developer's crashes, and anything a
   * `vite preview` or the bare CloudFront domain produces, must not reach the
   * project. No environment means no DSN, so `Sentry.init` has nothing to send
   * to — and no environment either, since a labelled event with no DSN would
   * only be misleading if the DSN ever came back.
   */
  it("sends nothing from a hostname that is not a deployment", async () => {
    const { isErrorReportingEnabled } = await loadSentry("localhost");

    expect(initOptions()).toMatchObject({
      dsn: undefined,
      environment: undefined,
    });
    expect(isErrorReportingEnabled).toBe(false);
  });

  it("stays off when the build was given no DSN", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");

    const { isErrorReportingEnabled } = await loadSentry(
      "whiteboard.unobravo.com",
    );

    // an empty string would make Sentry.init look configured while reporting
    // nothing, and the crash screen would offer an event id that means nothing
    expect(initOptions()).toMatchObject({
      dsn: undefined,
      environment: undefined,
    });
    expect(isErrorReportingEnabled).toBe(false);
  });

  /**
   * `#room=<id>,<key>` carries the key that decrypts the scene, `?authToken=`
   * the relay credential, and Sentry's default breadcrumb integration records
   * every navigation with the full URL — passing `integrations` adds to the
   * defaults rather than replacing them. Scrubbing only `request.url` would
   * leave both in the breadcrumb trail of the same event.
   */
  it("strips query and fragment from the URL and from navigation breadcrumbs", async () => {
    await loadSentry("whiteboard.unobravo.com");

    const { beforeSend } = initOptions();
    const event = beforeSend?.(
      {
        // `ErrorEvent` distinguishes itself from a transaction with this
        type: undefined,
        request: {
          url: "https://whiteboard.unobravo.com/?authToken=jwtsecret#room=abc,secretkey",
        },
        breadcrumbs: [
          {
            category: "navigation",
            data: {
              from: "https://whiteboard.unobravo.com/?authToken=jwtsecret",
              to: "https://whiteboard.unobravo.com/#room=abc,secretkey",
            },
          },
          // scrubbed as well: every string in the event is, since the leak
          // that prompted this was a field nobody had thought of
          { category: "fetch", data: { url: "https://example.com/x#y" } },
        ],
        exception: { values: [{ type: "Error", value: "boom" }] },
      },
      {},
    );

    expect(JSON.stringify(event)).not.toContain("secretkey");
    expect(JSON.stringify(event)).not.toContain("jwtsecret");
    expect(event).toMatchObject({
      request: { url: "https://whiteboard.unobravo.com/" },
      breadcrumbs: [
        {
          data: {
            from: "https://whiteboard.unobravo.com/",
            to: "https://whiteboard.unobravo.com/",
          },
        },
        { data: { url: "https://example.com/x" } },
      ],
    });
  });

  /**
   * `captureConsoleIntegration` sends an event with no exception, which this
   * hook then gives a synthetic one built from the message. The message is
   * scrubbed first, so the copy cannot reintroduce what the scrub removed.
   */
  it("builds the synthetic ConsoleError from the scrubbed message", async () => {
    await loadSentry("whiteboard.unobravo.com");

    const event = (await initOptions().beforeSend?.(
      {
        type: undefined,
        message: "console.error at https://whiteboard.unobravo.com/#room=a,key",
      },
      {},
    )) as SentryErrorEvent | null | undefined;

    expect(JSON.stringify(event)).not.toContain("room=");
    expect(event?.exception?.values?.[0]).toMatchObject({
      type: "ConsoleError",
      value: "console.error at https://whiteboard.unobravo.com/",
    });
  });

  it("honours VITE_APP_DISABLE_SENTRY, which build:app:docker sets", async () => {
    vi.stubEnv("VITE_APP_DISABLE_SENTRY", "true");

    const { isErrorReportingEnabled } = await loadSentry(
      "whiteboard.unobravo.com",
    );

    expect(initOptions()).toMatchObject({
      dsn: undefined,
      environment: undefined,
    });
    expect(isErrorReportingEnabled).toBe(false);
  });
});
