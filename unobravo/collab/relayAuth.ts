/**
 * The credentials the Unobravo collaboration relay wants on its socket
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
 * Alongside the token it wants to know which session this is, as `patientId`
 * and `doctorId`. The token alone cannot say: it carries the *caller's*
 * `unbv_id`, so it identifies one of the two participants and never the pair.
 * The relay is the only party that can check the pair against the token, so
 * nothing here tries to.
 *
 * All three arrive in the query string. That is the parent application's
 * decision, not ours: the whiteboard has no login of its own and no Firebase
 * SDK, so it cannot mint or refresh a token — it can only be handed one. See
 * `unobravo/url.md` for the URL the parent has to build.
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
export const RELAY_PATIENT_ID_PARAM = "patientId";
export const RELAY_DOCTOR_ID_PARAM = "doctorId";

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

/**
 * The same rule as `readRelayToken`, for the numeric ids: blank is absent.
 *
 * Anything that is not an integer is absent too, and that is forced rather
 * than chosen. The relay wants numbers, and `Number("whatever")` is `NaN`,
 * which `JSON.stringify` writes as `null` — so a malformed id would not arrive
 * as the string it was, it would arrive as a corrupt value the relay has to
 * guess about. Dropping the key says the same thing honestly.
 *
 * `isSafeInteger` rather than `isFinite`, and the choice is the whole point of
 * the function. `2100013138.5` is finite, and `Number("9007199254740993")` is
 * already rounded to `…92` by the time anything can look at it and is a
 * perfectly good integer afterwards. Either would sail through and reach the
 * relay as an id that is nobody's — the one failure mode worse than a missing
 * key, because a dropped id is visible and a wrong one is not. `isSafeInteger`
 * rules out `NaN` and `Infinity` on the way past.
 *
 * The blank check runs before the coercion on purpose: `Number("")` is `0`,
 * which is a perfectly plausible id.
 */
export const readRelayId = (search: string, param: string): number | null => {
  const raw = new URLSearchParams(search).get(param)?.trim();

  if (!raw) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) ? id : null;
};

export type RelayAuth = {
  token?: string;
  patientId?: number;
  doctorId?: number;
};

const currentAuth = (): RelayAuth => {
  if (typeof window === "undefined") {
    return {};
  }

  const { search } = window.location;
  const token = readRelayToken(search);
  const patientId = readRelayId(search, RELAY_PATIENT_ID_PARAM);
  const doctorId = readRelayId(search, RELAY_DOCTOR_ID_PARAM);

  // present only when the URL supplied it, rather than an explicit `null`:
  // what the parent left out and what it sent empty are the same thing to the
  // relay, and neither is a value.
  return {
    ...(token === null ? null : { token }),
    ...(patientId === null ? null : { patientId }),
    ...(doctorId === null ? null : { doctorId }),
  };
};

/**
 * Read when this module is first imported, and remembered.
 *
 * Eagerly, and that is not a detail. Starting a *new* session rewrites the URL
 * before it opens the socket: `startCollaboration` in
 * `excalidraw-app/collab/Collab.tsx` pushes `getCollaborationLink(…)`, which is
 * `origin + pathname + #room=…` and carries no query string, and only then
 * constructs the `socketIOClient`. A lazy read would find all three gone — and
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
let cached: RelayAuth = currentAuth();

/**
 * The `auth` payload for `socket.io-client`, or `undefined` when the URL
 * carried none of the three.
 *
 * `undefined` rather than `{}`: without it the relay answers "Authentication
 * required", which says what is actually wrong, and against an upstream
 * `excalidraw-room` — which ignores `auth` — the connection behaves exactly as
 * upstream. Sending an empty object would break the second case and mislabel
 * the first.
 *
 * Note for callers gating on this: it is truthy on ids alone, which is *not* a
 * credential. `excalidraw-app/App.tsx` checks `?.token` for that reason.
 */
export const getRelayAuth = (): RelayAuth | undefined =>
  Object.keys(cached).length === 0 ? undefined : cached;

/**
 * Test seam: re-reads the current URL, which the module itself only does once.
 * Nothing in the app should need this.
 */
export const resetRelayAuthForTests = () => {
  cached = currentAuth();
};
