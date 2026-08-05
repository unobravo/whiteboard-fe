/**
 * The credential the Unobravo collaboration relay wants on its socket
 * handshake.
 *
 * Upstream's collaboration server (`excalidraw/excalidraw-room`) is open: any
 * client that knows a room id may join it, and the end-to-end encryption is
 * what keeps the scene private. The Unobravo relay is not — it rejects the
 * handshake outright unless `auth.token` carries a Firebase ID token issued by
 * the Unobravo project:
 *
 *   no `auth.token`      → `connect_error: "Authentication required"`
 *   invalid `auth.token` → `connect_error: "Authentication failed"`
 *
 * The token arrives in the query string. That is the parent application's
 * decision, not ours: the whiteboard has no login of its own and no Firebase
 * SDK, so it cannot mint or refresh a token — it can only be handed one.
 *
 * See `unobravo/FORK.md` for what this costs the fork, and for the two known
 * gaps: the token is not refreshed when it expires, and it stays visible in the
 * URL.
 */

/**
 * Named `authToken` so it reads as what it is and does not collide with an
 * upstream parameter. Upstream reads `id`, `addLibrary` and `hash` from the
 * query string today and is free to add more; a bare `token` would be a name
 * worth arguing over on the next merge.
 */
export const RELAY_TOKEN_PARAM = "authToken";

/**
 * Pulled out of `getRelayAuth` so it can be tested without a `window`, and so
 * the parsing has no opinion about *when* it runs.
 */
export const readRelayToken = (search: string): string | null => {
  const token = new URLSearchParams(search).get(RELAY_TOKEN_PARAM);

  // an empty parameter is the same as no parameter: sending `token: ""` earns
  // "Authentication failed", which reads like a rejected credential rather
  // than a missing one.
  return token?.trim() ? token.trim() : null;
};

const currentToken = () =>
  typeof window === "undefined" ? null : readRelayToken(window.location.search);

/**
 * Read when this module is first imported, and remembered.
 *
 * Eagerly, and that is not a detail. Starting a *new* session rewrites the URL
 * before it opens the socket: `startCollaboration` in
 * `excalidraw-app/collab/Collab.tsx` pushes `getCollaborationLink(…)`, which is
 * `origin + pathname + #room=…` and carries no query string, and only then
 * constructs the `socketIOClient`. A lazy read would find the token gone — and
 * gone only on that path, so joining an existing `#room=` link would work and
 * creating a room would not, which is a worse bug than either.
 *
 * (`initializeScene` in `excalidraw-app/App.tsx` also blanks the URL, but only
 * for `?id=` / `#json=` / `#url=` scenes and when the user declines the
 * overwrite prompt — never on a plain load, and never when a `#room=` link is
 * present.)
 *
 * The consequence to know: on a plain load the token stays in the address bar
 * until a session starts, and after one starts a reload has no token at all and
 * collaboration stops connecting. The parent application has to re-open the app
 * with a fresh one.
 */
let cached: string | null = currentToken();

/**
 * The `auth` payload for `socket.io-client`, or `undefined` when there is no
 * token.
 *
 * `undefined` rather than `{ token: "" }`: without it the relay answers
 * "Authentication required", which says what is actually wrong, and against an
 * upstream `excalidraw-room` — which ignores `auth` — the connection behaves
 * exactly as upstream. Sending an empty token would break the second case and
 * mislabel the first.
 */
export const getRelayAuth = (): { token: string } | undefined =>
  cached === null ? undefined : { token: cached };

/**
 * Test seam: re-reads the current URL, which the module itself only does once.
 * Nothing in the app should need this.
 */
export const resetRelayAuthForTests = () => {
  cached = currentToken();
};
