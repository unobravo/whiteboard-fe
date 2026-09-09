/**
 * Removes the two credentials this app puts in its own URL from an event on
 * its way to Sentry.
 *
 * `#room=<id>,<key>` carries the key that decrypts the scene, and `?authToken=`
 * the relay's Firebase token (see `unobravo/collab/relayAuth.ts`). Neither is
 * ever worth reporting, and both used to travel: upstream's `beforeSend`
 * scrubbed the fragment off `event.request.url` and nothing else, while
 * passing `integrations` to `Sentry.init` *adds to* the SDK's defaults rather
 * than replacing them — so `breadcrumbsIntegration` stays on and records every
 * `history.pushState` with the whole URL, and `captureConsoleIntegration`
 * turns a `console.error` into an event whose message and arguments are
 * whatever the caller passed.
 *
 * Rather than enumerate the fields that carry a URL today, this walks the
 * event and scrubs every string in it. The alternative ages badly: the leak
 * that prompted this was a field nobody thought of, and the next SDK upgrade
 * or `console.error` call is free to add another.
 */

/** Everything from the first `?` or `#` on. Both hide a credential here. */
const stripUrl = (url: string) => url.replace(/[?#].*$/, "");

/**
 * A URL *inside* free text, so a message keeps its punctuation: `stripUrl` on
 * a sentence would cut it at the first question mark.
 */
const scrubText = (text: string) =>
  text.replace(/\bhttps?:\/\/[^\s"'<>)\]]+/gi, stripUrl);

/**
 * Depth-limited because an event is data from elsewhere, not a shape we
 * control, and `beforeSend` runs inside the crash path — the one place where
 * failing to return is worse than reporting a little less. Cycles are the
 * reason for the seen set: Sentry serializes events to JSON, so a cycle should
 * not survive to here, but "should not" is not a guarantee worth a hang.
 */
const MAX_DEPTH = 8;

const scrubIn = (
  container: Record<string, unknown> | unknown[],
  seen: WeakSet<object>,
  depth: number,
) => {
  if (depth > MAX_DEPTH || seen.has(container)) {
    return;
  }
  seen.add(container);

  const entries: [string | number, unknown][] = Array.isArray(container)
    ? container.map((value, index) => [index, value])
    : Object.entries(container);

  for (const [key, value] of entries) {
    if (typeof value === "string") {
      (container as Record<string | number, unknown>)[key] = scrubText(value);
    } else if (value && typeof value === "object") {
      scrubIn(value as Record<string, unknown> | unknown[], seen, depth + 1);
    }
  }
};

/**
 * `event.request.url` and a navigation breadcrumb's `from`/`to` hold a bare
 * URL, which may be origin-relative (`/#room=…`) and so match no `https://`
 * prefix. They are the fields the leak actually travelled in, so they are
 * stripped whole rather than scanned.
 */
const stripUrlField = (
  holder: Record<string, unknown> | undefined,
  key: string,
) => {
  if (holder && typeof holder[key] === "string") {
    holder[key] = stripUrl(holder[key]);
  }
};

/**
 * `T extends object` rather than a shape: the caller is Sentry's `ErrorEvent`,
 * which is an interface and would not satisfy an index signature, while the
 * tests build plain literals. The two fields this reads are picked back out
 * below.
 */
export const scrubSentryEvent = <T extends object>(event: T): T => {
  scrubIn(event as unknown as Record<string, unknown>, new WeakSet(), 0);

  const shaped = event as {
    request?: Record<string, unknown>;
    breadcrumbs?: { category?: string; data?: Record<string, unknown> }[];
  };

  stripUrlField(shaped.request, "url");

  for (const breadcrumb of shaped.breadcrumbs ?? []) {
    if (breadcrumb.category !== "navigation") {
      continue;
    }
    stripUrlField(breadcrumb.data, "from");
    stripUrlField(breadcrumb.data, "to");
  }

  return event;
};
