import { getSentryEnvironment } from "../observability/sentryEnv";

describe("getSentryEnvironment", () => {
  it("maps the two deployed hostnames", () => {
    expect(getSentryEnvironment("whiteboard.unobravo.com")).toBe("production");
    expect(getSentryEnvironment("whiteboard.unobravo.xyz")).toBe("staging");
  });

  it("ignores case, since a hostname is case-insensitive", () => {
    expect(getSentryEnvironment("Whiteboard.Unobravo.COM")).toBe("production");
  });

  /**
   * The map decides whether anything is sent at all — `excalidraw-app/sentry.ts`
   * only reads the DSN once this returns a value — so an unknown host has to
   * stay silent rather than fall back to an environment.
   */
  it("returns undefined for every host that is not a deployment", () => {
    for (const hostname of [
      "localhost",
      "127.0.0.1",
      "d111111abcdef8.cloudfront.net",
      "whiteboard-fe-production.s3.amazonaws.com",
      "excalidraw.com",
      "unobravo.com",
      // a suffix check on `.unobravo.com` would call this production
      "whiteboard.unobravo.com.evil.example",
    ]) {
      expect(getSentryEnvironment(hostname)).toBeUndefined();
    }
  });
});
