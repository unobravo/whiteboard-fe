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
 * Mutates the event and returns the same reference: that is the shape Sentry
 * documents for `beforeSend`, and a breadcrumb object is held by reference in
 * the scope's buffer, so scrubbing it in place also sanitizes it for whatever
 * later event reuses it.
 *
 * Rather than enumerate the fields that carry a URL today, this walks the
 * event and scrubs every string in it. The alternative ages badly: the leak
 * that prompted this was a field nobody thought of, and the next SDK upgrade
 * or `console.error` call is free to add another.
 */

import { RELAY_TOKEN_PARAM } from "../collab/relayAuth";

/** Everything from the first `?` or `#` on. Both hide a credential here. */
const stripUrl = (url: string) => url.replace(/[?#].*$/, "");

/**
 * The two parameters by name, for a URL the other passes cannot recognise as
 * one: a relative `/api?authToken=…` handed to `console.error` as a bare
 * string has no `https://` for the free-text scan and no known field name for
 * the bare-URL strip. Redacting the value rather than truncating keeps the
 * rest of whatever string it appeared in.
 */
const CREDENTIAL_PARAMS = new RegExp(
  `\\b(${RELAY_TOKEN_PARAM}|room)=[^\\s&"'<>]*`,
  "gi",
);

/**
 * A URL *inside* free text, so a message keeps its punctuation: `stripUrl` on
 * a sentence would cut it at the first question mark.
 *
 * The URL runs to the next whitespace or quote, deliberately including any
 * `)` or `]`: excluding those to spare a closing bracket in prose ends the
 * match early, and a match that stops before the `?` has nothing for
 * `stripUrl` to cut — an IPv6 host or a path with a bracket would keep its
 * query string whole. Quotes and angle brackets are different: they cannot
 * appear literally in a URL, and stopping at them is what keeps a URL inside
 * a serialized object from swallowing the fields that follow it.
 */
const scrubText = (text: string) =>
  text
    .replace(/\bhttps?:\/\/[^\s"'<>`]+/gi, stripUrl)
    .replace(CREDENTIAL_PARAMS, (_match, name: string) => `${name}=<redacted>`);

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

  // The iteration is inside the guard, not around it: `breadcrumbs` is only
  // ever an array or absent under the SDK, but `?? []` covers neither a
  // non-iterable value nor a throwing iterator, and this function's whole
  // point is that it returns.
  attempt(() => {
    for (const breadcrumb of shaped.breadcrumbs ?? []) {
      attempt(() => {
        // `url` on an xhr or fetch breadcrumb is whatever string the app
        // passed to `fetch()`, which the SDK records without resolving it
        stripUrlField(breadcrumb.data, "url");

        if (breadcrumb.category === "navigation") {
          stripUrlField(breadcrumb.data, "from");
          stripUrlField(breadcrumb.data, "to");
        }
      });
    }
  });

  return event;
};
