import { scrubSentryEvent } from "../observability/scrubSentryEvent";

const ROOM = "#room=abc123,secretkey";
const TOKEN = "?authToken=jwtsecret";
const ORIGIN = "https://whiteboard.unobravo.com/";

/** Nothing the app knows about its own URL is worth reporting. */
const assertClean = (event: unknown) => {
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain("secretkey");
  expect(serialized).not.toContain("jwtsecret");
};

describe("scrubSentryEvent", () => {
  it("strips the query and the fragment from the event URL", () => {
    const event = scrubSentryEvent({
      request: { url: `${ORIGIN}${TOKEN}${ROOM}` },
    });

    expect(event.request.url).toBe(ORIGIN);
  });

  it("strips a navigation breadcrumb, including an origin-relative one", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        { category: "navigation", data: { from: `/${TOKEN}`, to: `/${ROOM}` } },
      ],
    });

    expect(event.breadcrumbs[0].data).toEqual({ from: "/", to: "/" });
  });

  /**
   * The shape `captureConsoleIntegration` produces: no exception yet, the
   * caller's arguments verbatim. Upstream's hook looked at `request.url` only,
   * so this whole channel used to travel unscrubbed.
   */
  it("scrubs a console event's message and arguments", () => {
    const event = scrubSentryEvent({
      message: `failed to join ${ORIGIN}${ROOM}`,
      extra: { arguments: ["joining", `${ORIGIN}${TOKEN}`] },
    });

    assertClean(event);
    expect(event.message).toBe(`failed to join ${ORIGIN}`);
    expect(event.extra.arguments).toEqual(["joining", ORIGIN]);
  });

  it("scrubs an exception value and a non-navigation breadcrumb", () => {
    const event = scrubSentryEvent({
      exception: { values: [{ value: `fetch ${ORIGIN}${TOKEN} failed` }] },
      breadcrumbs: [{ category: "xhr", data: { url: `${ORIGIN}${TOKEN}` } }],
    });

    assertClean(event);
  });

  /**
   * The reason a URL is matched inside text rather than the string being cut
   * at its first `?`: a message is prose, and prose has question marks.
   */
  it("leaves text that is not a URL alone", () => {
    const event = scrubSentryEvent({
      message: "why did this fail? id=42#top",
    });

    expect(event.message).toBe("why did this fail? id=42#top");
  });

  it("survives a cyclic event rather than hanging the crash path", () => {
    const extra: Record<string, unknown> = { url: `${ORIGIN}${ROOM}` };
    extra.self = extra;

    const event = scrubSentryEvent({ extra });

    expect(event.extra.url).toBe(ORIGIN);
  });
});
