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
 *
 * The URL runs to the next whitespace, deliberately including any `)` or `]`.
 * Excluding them to spare a closing bracket in prose ends the match early, and
 * a match that stops before the `?` has nothing for `stripUrl` to cut — an
 * IPv6 host or a path with a bracket would keep its query string whole. A URL
 * with no query and no fragment is returned untouched, brackets and all; one
 * that has them loses whatever prose followed on the same token, which is the
 * cheaper mistake.
 */
const scrubText = (text: string) =>
  text.replace(/\bhttps?:\/\/\S+/gi, stripUrl);

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

  const keys: (string | number)[] = Array.isArray(container)
    ? container.map((_, index) => index)
    : Object.keys(container);

  const fields = container as Record<string | number, unknown>;

  for (const key of keys) {
    // One key at a time, each in its own try: `Object.entries` reads every
    // getter up front, so a single throwing one would cost the whole object
    // its scrub. A field that cannot be read cannot be scrubbed, but its
    // siblings still can.
    try {
      const value = fields[key];

      if (typeof value === "string") {
        fields[key] = scrubText(value);
      } else if (value && typeof value === "object") {
        scrubIn(value as Record<string, unknown> | unknown[], seen, depth + 1);
      }
    } catch {
      // as above: logging here would re-enter captureConsole
    }
  }
};

/**
 * Some fields hold a bare URL rather than prose, and a bare URL may be
 * origin-relative (`/#room=…`, `/api?authToken=…`) and so match no `https://`
 * prefix. Those are stripped whole rather than scanned.
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
/**
 * Each pass is guarded on its own. `beforeSend` throwing is worse than any of
 * them failing: Sentry drops the event that was being reported and captures
 * the scrubber's own error in its place, so the crash the user actually hit is
 * never seen — which is the state issue #16 existed to end. A pass that throws
 * halfway has still scrubbed what it reached, and the passes after it still
 * run.
 */
const attempt = (pass: () => void) => {
  try {
    pass();
  } catch {
    // nothing to log: console.error here would re-enter captureConsole
  }
};

export const scrubSentryEvent = <T extends object>(event: T): T => {
  attempt(() =>
    scrubIn(event as unknown as Record<string, unknown>, new WeakSet(), 0),
  );

  const shaped = event as {
    request?: Record<string, unknown>;
    breadcrumbs?: { category?: string; data?: Record<string, unknown> }[];
  };

  attempt(() => stripUrlField(shaped.request, "url"));

  for (const breadcrumb of shaped.breadcrumbs ?? []) {
    attempt(() => {
      // `url` on an xhr or fetch breadcrumb is whatever string the app passed
      // to `fetch()`, which the SDK records without resolving it
      stripUrlField(breadcrumb.data, "url");

      if (breadcrumb.category === "navigation") {
        stripUrlField(breadcrumb.data, "from");
        stripUrlField(breadcrumb.data, "to");
      }
    });
  }

  return event;
};
